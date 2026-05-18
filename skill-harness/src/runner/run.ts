/**
 * Tier-2 orchestrator.
 *
 * Given a set of fixtures + a live `Client`, runs each fixture N times
 * (N varies by tier, per the plan), evaluates rubrics, aggregates
 * pass-rates per prompt, then computes the headline composite.
 *
 * Concurrency: at most 4 requests in flight at a time. The plan treats
 * the bench as a 1–3 minute job with prompt caching; heavier concurrency
 * risks 429s and doesn't save meaningful time on a caching-friendly
 * workload. The `CONCURRENCY` constant is the single knob.
 */

import { execSync } from 'node:child_process';

import type { Fixture } from '../fixtureSchema.js';
import { evaluateRubric, type RubricFailure } from '../rubric.js';
import type { SchemaArtifact } from '../schemaArtifact.js';
import type { CompositeResult } from './aggregate.js';
import { aggregate, weightedComposite } from './aggregate.js';
import { filterArtifactForSkill } from './audienceFilter.js';
import type { Client } from './client.js';
import type { Turn } from './conversation.js';
import { runConversation } from './conversation.js';
import { extractYamlFromCaptures } from './extract.js';
import { hasSaveCall } from './mcpStubLauncher.js';
import { buildSystemPromptBlocks } from './systemPrompt.js';

const CONCURRENCY = 4;

export type TierFilter = 'required' | 'aspirational' | 'all';

export type PromptRun = {
  passed: boolean;
  failures: RubricFailure[];
  yaml: string | null;
  askedClarifying: boolean;
  turns: Turn[];
  gaveUpAtTurn?: number;
};

export type PromptResult = {
  id: string;
  tier: 'required' | 'aspirational';
  passed: boolean;
  runs: PromptRun[];
  clarifyingQuestionExpected?: boolean;
  /** Total samples collected for this prompt. Equals `runs.length`. */
  samples: number;
  /** Number of samples whose rubric verdict was `passed=true`. */
  passes: number;
  /** `passes / samples` — the pass-rate on a 0–1 scale. */
  passAtK: number;
  /** Lower bound of the 95% Wilson CI on `passAtK`. */
  wilsonLower: number;
  /** Upper bound of the 95% Wilson CI on `passAtK`. */
  wilsonUpper: number;
};

export type SummaryMetrics = CompositeResult;

export type RunMetadata = {
  temperature: number;
  samples: number;
  model: string;
  provider: string;
  seed: number | null;
};

export type RunResults = {
  runId: string;
  model: string;
  commit?: string;
  tier: TierFilter;
  summary: SummaryMetrics;
  prompts: PromptResult[];
  metadata: RunMetadata;
};

function gitCommit(): string | undefined {
  try {
    const out = execSync('git rev-parse HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function runInPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, idx: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers: Promise<void>[] = [];
  const launch = async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      await worker(items[idx], idx);
    }
  };
  const limit = Math.min(concurrency, items.length);
  for (let i = 0; i < limit; i++) workers.push(launch());
  await Promise.all(workers);
}

export async function runBench(params: {
  fixtures: Fixture[];
  artifact: SchemaArtifact;
  skillBundle: string;
  client: Client;
  model: string;
  runsPerRequired: number;
  runsPerAspirational: number;
  temperature?: number;
  maxTurns?: number;
  tierFilter?: TierFilter;
  runId?: string;
  /**
   * When false, the harness omits the schema-artifact block from the
   * system prompt so the bench measures the skill under production-
   * equivalent context (SKILL.md only, no auto-injected references).
   * Default `true` preserves the existing baseline behavior.
   */
  injectArtifact?: boolean;
  /** Metadata fields — `samples`, `provider`, `seed` — stamped into the report. */
  metadata?: Partial<RunMetadata>;
}): Promise<RunResults> {
  const tier = params.tierFilter ?? 'all';
  const runId = params.runId ?? new Date().toISOString();

  const filtered = filterArtifactForSkill(params.artifact);
  const systemBlocks = buildSystemPromptBlocks({
    skillBundle: params.skillBundle,
    filteredArtifact: filtered,
    injectArtifact: params.injectArtifact,
  });

  const promptResults: PromptResult[] = [];

  for (const fixture of params.fixtures) {
    const n = fixture.tier === 'required' ? params.runsPerRequired : params.runsPerAspirational;
    const runs: PromptRun[] = new Array(n);

    await runInPool(
      Array.from({ length: n }, (_, i) => i),
      CONCURRENCY,
      async i => {
        // Per-sample error isolation: a single CLI timeout or transport
        // error must not abort the whole fixture's pool. The failing
        // sample gets recorded as a `runner_error` run; the remaining
        // samples continue. Without this, `Promise.all` short-circuits
        // on the first rejection and the fixture produces no data at all.
        try {
          const conv = await runConversation({
            client: params.client,
            model: params.model,
            systemBlocks,
            userPrompt: fixture.user_prompt,
            followups: fixture.followups,
            maxTurns: params.maxTurns,
            temperature: params.temperature,
          });

          // Captured-YAML (from `dtwo-validate-gateway-config` /
          // `dtwo-save-gateway-draft-config`) is the canonical output path
          // when the MCP stub is in play. Prefer it over text-extracted
          // YAML; fall back to text when no captures exist.
          const capturedYaml = extractYamlFromCaptures(conv.captures);
          if (capturedYaml !== null && conv.yaml !== null && capturedYaml !== conv.yaml) {
            process.stderr.write(
              `[runBench] ${fixture.id} run ${i}: captured YAML differs from text-extracted YAML; using captured.\n`,
            );
          }
          const yaml = capturedYaml ?? conv.yaml;

          // A successful save call counts as a "skill completed its flow"
          // signal even if the assistant's final message didn't produce a
          // YAML fence. Suppress gaveUpAtTurn in that case — the skill
          // followed its documented flow.
          const completedViaSave = hasSaveCall(conv.captures);
          const gaveUpAtTurn = completedViaSave ? undefined : conv.gaveUpAtTurn;

          let passed = false;
          let failures: RubricFailure[] = [];
          if (yaml === null) {
            failures = [
              {
                check: 'runner_no_yaml',
                message:
                  gaveUpAtTurn !== undefined
                    ? `runner gave up at turn ${gaveUpAtTurn} without producing YAML`
                    : 'runner produced no YAML',
              },
            ];
          } else {
            const rubric = evaluateRubric(fixture, yaml, params.artifact);
            passed = rubric.passed;
            failures = rubric.failures;
          }

          runs[i] = {
            passed,
            failures,
            yaml,
            askedClarifying: conv.askedClarifying,
            turns: conv.turns,
            gaveUpAtTurn,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          process.stderr.write(`[runBench] ${fixture.id} run ${i}: runner error — ${message.slice(0, 200)}\n`);
          runs[i] = {
            passed: false,
            failures: [{ check: 'runner_error', message }],
            yaml: null,
            askedClarifying: false,
            turns: [],
            gaveUpAtTurn: undefined,
          };
        }
      },
    );

    const agg = aggregate(runs);
    promptResults.push({
      id: fixture.id,
      tier: fixture.tier,
      runs,
      clarifyingQuestionExpected: fixture.clarifying_question_expected,
      ...agg,
    });
  }

  const summary = weightedComposite(promptResults);

  const metadata: RunMetadata = {
    temperature: params.temperature ?? 0.2,
    samples: params.metadata?.samples ?? 1,
    model: params.metadata?.model ?? params.model,
    provider: params.metadata?.provider ?? 'anthropic',
    seed: params.metadata?.seed ?? null,
  };

  return {
    runId,
    model: params.model,
    commit: gitCommit(),
    tier,
    summary,
    prompts: promptResults,
    metadata,
  };
}
