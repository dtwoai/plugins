#!/usr/bin/env node
/**
 * CLI entry point for the Tier-2 live-LLM runner.
 *
 * Invoked via `pnpm bench` from the `skill-harness/` directory. The
 * package script routes to this file via tsx — no transpile step, no
 * separate `bin` entry in package.json.
 *
 * Flags (all optional):
 *   --prompts=<glob>       default: `*`   (tiny glob: `*` → `.*`, `?` → `.`)
 *   --tier=<required|aspirational|all>  default: `all`
 *   --n=<int>              override both required and aspirational counts
 *   --output=<dir>         default: `./bench-results/`
 *   --model=<id>           default: `claude-sonnet-4-6`
 *   --temperature=<float>  default: `0.2`
 *   --dry-run              print filtered fixtures + prompt stats, exit 0
 *
 * Exit code: 0 when every required-tier fixture passes (or --dry-run).
 * 1 otherwise. Aspirational failures are non-blocking.
 *
 * Refuses to start when `ANTHROPIC_API_KEY` is unset unless --dry-run is
 * passed. That mirrors the workflow's gating so a local smoke matches CI
 * behavior.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadFixtures } from '../fixtures.js';
import { filterArtifactForSkill } from '../runner/audienceFilter.js';
import {
  type BaselineComparison,
  buildBaseline,
  compareBaseline,
  parseBaseline,
  serializeBaseline,
} from '../runner/baseline.js';
import { createAnthropicClient, createCliClient } from '../runner/client.js';
import { renderHtml, renderJson, renderMarkdown } from '../runner/report.js';
import { runBench } from '../runner/run.js';
import { buildSystemPromptBlocks, loadSkillBundle } from '../runner/systemPrompt.js';
import { loadSchemaArtifact } from '../schemaArtifact.js';

type Provider = 'anthropic' | 'claude-cli';
const VALID_PROVIDERS: readonly Provider[] = ['anthropic', 'claude-cli'];

type Args = {
  prompts: string;
  tier: 'required' | 'aspirational' | 'all';
  n?: number;
  /**
   * Per-fixture sample count when the user passes `--samples=<N>`. Optional —
   * undefined means "fall back to --n or per-tier defaults". Distinct from
   * the metadata sample count: a user passing `--samples=1` is honored as
   * 1 here (was previously conflated with default).
   */
  samples?: number;
  output: string;
  model: string;
  temperature: number;
  provider: Provider;
  dryRun: boolean;
  help: boolean;
  compareBaseline?: string;
  appendHistory?: string;
  writeBaseline?: string;
  /**
   * Absolute or cwd-relative path to a skill bundle directory containing
   * SKILL.md (and optional `references/` / `examples/` subdirs). Required
   * because the skill lives in this same plugin repo at
   * `dtwo/skills/dtwo-gateway-config/`. Fallback chain: this flag, then DTWO_SKILL_BUNDLE_PATH
   * env, then well-known sibling-checkout paths.
   */
  skillBundle?: string;
  /**
   * When true, the harness drops the schema-artifact block from the
   * cached system prompt so the bench measures the skill under
   * production-equivalent context (SKILL.md only). Production Claude
   * Code does not auto-load `references/` files; this flag lets the
   * bench match that. Default false preserves existing baselines.
   */
  skipInjectedSchema: boolean;
};

function parseArgs(argv: string[]): Args {
  const out: Args = {
    prompts: '*',
    tier: 'all',
    output: './bench-results/',
    model: 'claude-sonnet-4-6',
    temperature: 0.2,
    provider: 'anthropic',
    dryRun: false,
    help: false,
    skipInjectedSchema: false,
  };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      out.help = true;
      continue;
    }
    if (arg === '--dry-run') {
      out.dryRun = true;
      continue;
    }
    if (arg === '--skip-injected-schema') {
      out.skipInjectedSchema = true;
      continue;
    }
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq === -1) continue;
    const key = arg.slice(2, eq);
    const val = arg.slice(eq + 1);
    switch (key) {
      case 'prompts':
        out.prompts = val;
        break;
      case 'tier':
        if (val !== 'required' && val !== 'aspirational' && val !== 'all') {
          throw new Error(`--tier must be one of required|aspirational|all (got "${val}")`);
        }
        out.tier = val;
        break;
      case 'n':
        out.n = Number.parseInt(val, 10);
        if (!Number.isFinite(out.n) || out.n <= 0) {
          throw new Error(`--n must be a positive integer (got "${val}")`);
        }
        break;
      case 'samples': {
        // Parse strictly — a float like "1.5" would otherwise parseInt to 1
        // and silently accept bad input. Require /^\d+$/ for integer form.
        if (!/^\d+$/.test(val)) {
          throw new Error(`--samples must be an integer >= 1 (got "${val}")`);
        }
        const parsed = Number.parseInt(val, 10);
        if (parsed < 1) {
          throw new Error(`--samples must be an integer >= 1 (got "${val}")`);
        }
        out.samples = parsed;
        break;
      }
      case 'output':
        out.output = val;
        break;
      case 'model':
        out.model = val;
        break;
      case 'temperature':
        out.temperature = Number.parseFloat(val);
        if (!Number.isFinite(out.temperature)) {
          throw new Error(`--temperature must be a float (got "${val}")`);
        }
        break;
      case 'provider':
        if (!VALID_PROVIDERS.includes(val as Provider)) {
          throw new Error(`--provider must be one of ${VALID_PROVIDERS.join('|')} (got "${val}")`);
        }
        out.provider = val as Provider;
        break;
      case 'compare-baseline':
        out.compareBaseline = val;
        break;
      case 'append-history':
        out.appendHistory = val;
        break;
      case 'write-baseline':
        out.writeBaseline = val;
        break;
      case 'skill-bundle':
        out.skillBundle = val;
        break;
      default:
        // Unknown flag: noisy but non-fatal so a future flag addition
        // doesn't break older CI invocations.
        process.stderr.write(`warn: unknown flag --${key}\n`);
    }
  }
  return out;
}

/**
 * Resolve the skill-bundle directory. Priority:
 *   1. `--skill-bundle=<path>` (cwd-relative or absolute).
 *   2. `DTWO_SKILL_BUNDLE_PATH` env var.
 *   3. The in-tree default: `dtwo/skills/dtwo-gateway-config/` at the plugin
 *      repo root (this harness lives in `skill-harness/`, alongside `dtwo/`).
 *
 * Throws an actionable error when none resolve. The error names the flag,
 * the env var, and the in-tree default so a developer can self-serve.
 */
function resolveSkillBundlePath(args: Args, here: string): string {
  const validate = (label: string, raw: string): string => {
    const abs = resolve(process.cwd(), raw);
    if (!existsSync(join(abs, 'SKILL.md'))) {
      throw new Error(`${label}=${raw} does not contain SKILL.md (resolved ${abs})`);
    }
    return abs;
  };
  if (args.skillBundle) return validate('--skill-bundle', args.skillBundle);
  if (process.env.DTWO_SKILL_BUNDLE_PATH) {
    return validate('DTWO_SKILL_BUNDLE_PATH', process.env.DTWO_SKILL_BUNDLE_PATH);
  }
  // here = .../skill-harness/src/bin; plugin root is 3 hops up; skill is
  // dtwo/skills/dtwo-gateway-config alongside skill-harness/.
  const pluginRoot = resolve(here, '../../..');
  const inTree = resolve(pluginRoot, 'dtwo/skills/dtwo-gateway-config');
  if (existsSync(join(inTree, 'SKILL.md'))) return inTree;
  throw new Error(
    [
      'Could not locate the dtwo-gateway-config skill bundle in-tree.',
      'Options:',
      '  - Pass --skill-bundle=<path>/dtwo/skills/dtwo-gateway-config',
      '  - Set DTWO_SKILL_BUNDLE_PATH=<path>/dtwo/skills/dtwo-gateway-config',
      `Expected in-tree at: ${inTree}`,
    ].join('\n'),
  );
}

/** Tiny glob: `*` -> `.*`, `?` -> `.`. Nothing else is interpreted. */
function globToRegex(glob: string): RegExp {
  const escaped = glob.replace(/[.+^$(){}|[\]\\]/g, '\\$&');
  const pattern = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${pattern}$`);
}

function printHelp(): void {
  process.stdout.write(
    [
      'Usage: pnpm bench [flags]',
      '',
      'Flags:',
      '  --prompts=<glob>        fixture-id glob (default: *)',
      '  --tier=<tier>           required | aspirational | all (default: all)',
      '  --n=<int>               override runs-per-fixture for both tiers',
      '  --samples=<int>         runs per fixture (integer >= 1, default: 1).',
      '                          Overrides --n and per-tier defaults when passed.',
      '  --output=<dir>          results output directory (default: ./bench-results/)',
      '  --model=<id>            Anthropic model id (default: claude-sonnet-4-6)',
      '  --temperature=<float>   sampling temperature (default: 0.2)',
      '  --provider=<name>       anthropic | claude-cli (default: anthropic)',
      '  --compare-baseline=<path>  compare current run to a baseline.json; exits 1 on regression',
      '  --append-history=<path>    append a one-line JSON summary to <path> (created if missing)',
      '  --write-baseline=<path>    derive a fresh baseline from the current run (atomic write)',
      '  --skill-bundle=<path>      path to the dtwo-gateway-config skill dir (contains SKILL.md).',
      '                             Defaults to the in-tree ../dtwo/skills/dtwo-gateway-config.',
      '                             Falls back to DTWO_SKILL_BUNDLE_PATH env.',
      '  --skip-injected-schema  drop the schema-artifact block from the cached system',
      '                          prompt so the bench measures the skill under production-',
      '                          equivalent context (SKILL.md only).',
      '  --dry-run               print filtered fixtures + prompt stats, exit 0',
      '  --help                  this message',
      '',
      'Provider notes:',
      '  anthropic  — Anthropic SDK. Requires ANTHROPIC_API_KEY unless --dry-run.',
      '  claude-cli — shells out to `claude -p`; reuses the local OAuth login.',
      '               Temperature is forwarded via --settings inline JSON.',
      '               max_tokens is silently ignored (CLI has no settings key).',
      '',
    ].join('\n'),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (args.compareBaseline && args.writeBaseline) {
    process.stderr.write('--compare-baseline and --write-baseline are mutually exclusive.\n');
    process.exit(1);
  }

  const fixtures = loadFixtures();
  const promptRe = globToRegex(args.prompts);
  const selected = fixtures.filter(f => {
    if (!promptRe.test(f.id)) return false;
    if (args.tier !== 'all' && f.tier !== args.tier) return false;
    return true;
  });

  if (selected.length === 0) {
    process.stderr.write(
      `no fixtures matched --prompts=${args.prompts} --tier=${args.tier} (loaded ${fixtures.length} total)\n`,
    );
    process.exit(1);
  }

  const artifact = loadSchemaArtifact();
  const HERE = dirname(fileURLToPath(import.meta.url));
  const skillDir = resolveSkillBundlePath(args, HERE);
  const skillBundle = loadSkillBundle(skillDir);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (args.provider === 'anthropic' && !apiKey && !args.dryRun) {
    process.stderr.write('ANTHROPIC_API_KEY is not set. Pass --dry-run for an offline smoke.\n');
    process.exit(1);
  }

  // --samples, when supplied, governs the runs-per-fixture count for both
  // tiers and supersedes --n and the per-tier defaults. When absent, fall
  // back to --n if present, else the tier-asymmetric defaults (5/3) that
  // predated this flag. Nullish coalescing — `--samples=1` is honored as 1.
  const runsPerRequired = args.samples ?? args.n ?? 5;
  const runsPerAspirational = args.samples ?? args.n ?? 3;
  const bannerSamplesLine =
    args.samples !== undefined
      ? `  samples:           ${args.samples}`
      : `  samples:           per-tier defaults (${runsPerRequired} required / ${runsPerAspirational} aspirational)`;

  if (args.dryRun) {
    // Dry-run builds the system blocks here purely to report stats. The live
    // path lets `runBench` build them internally to avoid double work.
    const filteredArtifact = filterArtifactForSkill(artifact);
    const systemBlocks = buildSystemPromptBlocks({
      skillBundle,
      filteredArtifact,
      injectArtifact: !args.skipInjectedSchema,
    });
    const systemChars = systemBlocks.reduce((acc, b) => acc + b.text.length, 0);
    const temperatureLine =
      args.provider === 'claude-cli'
        ? `  temperature:       ${args.temperature} (forwarded via --settings)`
        : `  temperature:       ${args.temperature}`;
    process.stdout.write(
      [
        `bench dry-run`,
        `  fixtures:          ${selected.length} of ${fixtures.length} (tier=${args.tier}, prompts=${args.prompts})`,
        `  provider:          ${args.provider}`,
        `  model:             ${args.model}`,
        temperatureLine,
        bannerSamplesLine,
        `  output:            ${args.output}`,
        `  system blocks:     ${systemBlocks.length} (${systemChars.toLocaleString()} chars total)`,
        `  artifact sections: ${filteredArtifact.sections.length} (filtered to audience=user)`,
        `  artifact reserved: ${filteredArtifact.reservedKeys.length}`,
        `  inject artifact:   ${!args.skipInjectedSchema}`,
        '',
        'Selected fixtures:',
        ...selected.map(f => `  - [${f.tier}] ${f.id}`),
        '',
      ].join('\n'),
    );
    return;
  }

  // Startup banner: mirror the key dry-run fields so a live run's log shows
  // the same at-a-glance summary. Keep temperature + samples adjacent.
  const bannerTemperatureLine =
    args.provider === 'claude-cli'
      ? `  temperature:       ${args.temperature} (forwarded via --settings)`
      : `  temperature:       ${args.temperature}`;
  process.stdout.write(
    [
      `bench run`,
      `  fixtures:          ${selected.length} of ${fixtures.length} (tier=${args.tier}, prompts=${args.prompts})`,
      `  provider:          ${args.provider}`,
      `  model:             ${args.model}`,
      bannerTemperatureLine,
      bannerSamplesLine,
      `  inject artifact:   ${!args.skipInjectedSchema}`,
      '',
    ].join('\n'),
  );

  const client = args.provider === 'claude-cli' ? createCliClient() : createAnthropicClient({ apiKey });
  const results = await runBench({
    fixtures: selected,
    artifact,
    skillBundle,
    client,
    model: args.model,
    runsPerRequired,
    runsPerAspirational,
    temperature: args.temperature,
    tierFilter: args.tier,
    injectArtifact: !args.skipInjectedSchema,
    metadata: {
      temperature: args.temperature,
      // Record the user's explicit --samples request when given. When absent,
      // record `runsPerRequired` so downstream consumers (baseline source_run,
      // history.jsonl) see the actual required-tier sample count rather than
      // a confusing 1 default. Per-fixture sample counts remain authoritative
      // for analysis; this field is the headline summary.
      samples: args.samples ?? runsPerRequired,
      model: args.model,
      provider: args.provider,
      seed: null,
    },
  });

  // Optional baseline compare: load + parse first so we don't lose the run
  // if the baseline file is malformed.
  let comparison: BaselineComparison | undefined;
  if (args.compareBaseline) {
    const path = resolve(process.cwd(), args.compareBaseline);
    const raw = readFileSync(path, 'utf8');
    const baseline = parseBaseline(raw);
    comparison = compareBaseline(baseline, results, fixtures);
  }

  const outputDir = resolve(process.cwd(), args.output);
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, 'results.json'), renderJson(results));
  const md = renderMarkdown(results, comparison);
  writeFileSync(resolve(outputDir, 'results.md'), `${md}\n`);
  writeFileSync(resolve(outputDir, 'results.html'), renderHtml(results, comparison));

  process.stdout.write(`${md}\n`);

  // Optional history append: one JSON object per line, \n-terminated.
  if (args.appendHistory) {
    const historyPath = resolve(process.cwd(), args.appendHistory);
    mkdirSync(dirname(historyPath), { recursive: true });
    const entry = {
      timestamp: new Date().toISOString(),
      commit: results.commit ?? '',
      tier: results.tier,
      prompt_filter: args.prompts,
      provider: results.metadata.provider,
      model: results.metadata.model,
      temperature: results.metadata.temperature,
      samples: results.metadata.samples,
      headline: results.summary.headline,
      per_fixture: results.prompts.map(p => ({
        id: p.id,
        tier: p.tier,
        passes: p.passes,
        samples: p.samples,
        passAtK: p.passAtK,
        wilsonLower: p.wilsonLower,
        wilsonUpper: p.wilsonUpper,
      })),
    };
    appendFileSync(historyPath, `${JSON.stringify(entry)}\n`);
  }

  // Optional baseline seed (mutually exclusive with --compare-baseline at
  // parse time). Atomic write via <path>.tmp + rename.
  if (args.writeBaseline) {
    const target = resolve(process.cwd(), args.writeBaseline);
    const requiredFailedForSeed = results.prompts.some(p => p.tier === 'required' && !p.passed);
    if (requiredFailedForSeed) {
      process.stderr.write(
        'warning: required-tier fixtures failed in this run; baseline may capture a degraded state — consider re-running after fixes\n',
      );
    }
    mkdirSync(dirname(target), { recursive: true });
    const baseline = buildBaseline(results, fixtures);
    const tmp = `${target}.tmp`;
    writeFileSync(tmp, serializeBaseline(baseline));
    renameSync(tmp, target);
    process.stderr.write(`wrote baseline to ${target}\n`);
  }

  // Exit code: 1 if any required-tier prompt failed OR (when comparing) any
  // regression was detected. Preserve the required-tier gate independent of
  // the baseline gate.
  const requiredFailed = results.prompts.some(p => p.tier === 'required' && !p.passed);
  const baselineRegressed = comparison ? comparison.regressions.length > 0 : false;
  process.exit(requiredFailed || baselineRegressed ? 1 : 0);
}

main().catch(err => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
