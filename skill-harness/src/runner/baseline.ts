/**
 * Baseline snapshotting + regression comparison.
 *
 * Pure module (no filesystem I/O inside `buildBaseline` / `compareBaseline`).
 * Callers in `bin/bench.ts` handle disk I/O and pass `Fixture[]` in.
 *
 * Design decisions (see Phase 2 brief):
 *   - Dual-tag gating (Option C): fixtures tagged `schema_gap_flagged` are
 *     excluded at both seed time and compare time. This lets authors demote
 *     a gating fixture by adding the tag without editing baseline.json.
 *   - Regression criterion: a baseline-entered, non-tag-excluded fixture
 *     regresses if EITHER passAtK < min_pass_at_k OR wilsonLower <
 *     min_wilson_lower. Both catch different failure modes (point-estimate
 *     drop vs same-mean-wider-CI).
 *   - Improvement criterion: strictly dual — BOTH passAtK and wilsonLower
 *     must exceed their baseline + EPSILON. Informational only; never
 *     affects exit code. EPSILON = 0.05 to avoid noisy flags on sub-variance
 *     fluctuation.
 *   - Missing (baseline entry, no current result): warn, don't fail.
 *   - Unexpected (current result, no baseline entry): notice, don't fail.
 */

import { z } from 'zod';

import type { Fixture } from '../fixtureSchema.js';
import type { PromptResult, RunResults } from './run.js';

/** Minimum meaningful improvement threshold. Tuned to ignore single-sample noise at N=10. */
export const BASELINE_EPSILON = 0.05;

/** Tag that demotes a fixture out of baseline gating. */
export const SCHEMA_GAP_TAG = 'schema_gap_flagged';

const BaselineFixtureEntrySchema = z.object({
  min_pass_at_k: z.number().min(0).max(1),
  min_wilson_lower: z.number().min(0).max(1),
  note: z.string().min(1),
});

const BaselineSchema = z.object({
  $schema_version: z.literal(1),
  generated_at: z.string().min(1),
  source_run: z.object({
    commit: z.string(),
    samples: z.number().int().nonnegative(),
    model: z.string(),
    provider: z.string(),
    temperature: z.number(),
  }),
  fixtures: z.record(z.string(), BaselineFixtureEntrySchema),
});

export type BaselineFixtureEntry = z.infer<typeof BaselineFixtureEntrySchema>;
export type Baseline = z.infer<typeof BaselineSchema>;

export type RegressionEntry = {
  id: string;
  tier: 'required' | 'aspirational';
  passAtK: number;
  minPassAtK: number;
  wilsonLower: number;
  minWilsonLower: number;
  /** One or both of 'passAtK' / 'wilsonLower' — the axes that fell below baseline. */
  axes: Array<'passAtK' | 'wilsonLower'>;
};

export type ImprovementEntry = {
  id: string;
  tier: 'required' | 'aspirational';
  passAtK: number;
  minPassAtK: number;
  wilsonLower: number;
  minWilsonLower: number;
};

export type ComparisonRow = {
  id: string;
  tier: 'required' | 'aspirational';
  passAtK: number;
  minPassAtK: number;
  wilsonLower: number;
  minWilsonLower: number;
  status: 'ok' | 'regression' | 'improvement' | 'excluded';
};

export type BaselineComparison = {
  regressions: RegressionEntry[];
  improvements: ImprovementEntry[];
  /** Baseline entries with no corresponding current result. */
  missing: string[];
  /** Current results with no baseline entry (ignoring tag-excluded fixtures). */
  unexpected: string[];
  /** Per-compared-fixture row for report rendering. Excludes tag-excluded fixtures. */
  rows: ComparisonRow[];
};

/**
 * Compare current results to a baseline snapshot.
 *
 * Pure — does not touch disk. The `fixtures` argument is used only to look
 * up the `tags` array for the dual-tag gating rule.
 */
export function compareBaseline(baseline: Baseline, results: RunResults, fixtures: Fixture[]): BaselineComparison {
  const tagsById = new Map<string, readonly string[]>();
  for (const f of fixtures) {
    tagsById.set(f.id, f.tags ?? []);
  }
  const isTagExcluded = (id: string): boolean => tagsById.get(id)?.includes(SCHEMA_GAP_TAG) === true;

  const resultsById = new Map<string, PromptResult>();
  for (const p of results.prompts) resultsById.set(p.id, p);

  const regressions: RegressionEntry[] = [];
  const improvements: ImprovementEntry[] = [];
  const missing: string[] = [];
  const unexpected: string[] = [];
  const rows: ComparisonRow[] = [];

  // Pass 1: walk baseline entries.
  for (const [id, entry] of Object.entries(baseline.fixtures)) {
    if (isTagExcluded(id)) continue; // demoted since baseline was seeded
    const current = resultsById.get(id);
    if (!current) {
      missing.push(id);
      continue;
    }
    const axes: Array<'passAtK' | 'wilsonLower'> = [];
    if (current.passAtK < entry.min_pass_at_k) axes.push('passAtK');
    if (current.wilsonLower < entry.min_wilson_lower) axes.push('wilsonLower');

    const isRegression = axes.length > 0;
    const isImprovement =
      !isRegression &&
      current.passAtK > entry.min_pass_at_k + BASELINE_EPSILON &&
      current.wilsonLower > entry.min_wilson_lower + BASELINE_EPSILON;

    if (isRegression) {
      regressions.push({
        id,
        tier: current.tier,
        passAtK: current.passAtK,
        minPassAtK: entry.min_pass_at_k,
        wilsonLower: current.wilsonLower,
        minWilsonLower: entry.min_wilson_lower,
        axes,
      });
    } else if (isImprovement) {
      improvements.push({
        id,
        tier: current.tier,
        passAtK: current.passAtK,
        minPassAtK: entry.min_pass_at_k,
        wilsonLower: current.wilsonLower,
        minWilsonLower: entry.min_wilson_lower,
      });
    }
    rows.push({
      id,
      tier: current.tier,
      passAtK: current.passAtK,
      minPassAtK: entry.min_pass_at_k,
      wilsonLower: current.wilsonLower,
      minWilsonLower: entry.min_wilson_lower,
      status: isRegression ? 'regression' : isImprovement ? 'improvement' : 'ok',
    });
  }

  // Pass 2: walk current results to find unexpected entries.
  for (const p of results.prompts) {
    if (isTagExcluded(p.id)) continue;
    if (!(p.id in baseline.fixtures)) unexpected.push(p.id);
  }

  return { regressions, improvements, missing, unexpected, rows };
}

/**
 * Round down to `precision` decimal places. Used by `buildBaseline` to seed
 * a defensive floor that tolerates one-sample variance below the observed
 * pass@k.
 */
function floorTo(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.floor(value * factor) / factor;
}

/**
 * Derive a baseline snapshot from current results.
 *
 * Skips fixtures tagged `schema_gap_flagged` and fixtures with fewer than
 * 5 samples (writes a stderr warning for the latter — we don't want noisy
 * per-fixture floors from a thin run).
 *
 * Seeded floors are defensive: `min_pass_at_k = floor(passAtK * 0.9, 2)`,
 * `min_wilson_lower = floor(wilsonLower * 0.8, 2)`. Note field records the
 * run id and sample count.
 */
export function buildBaseline(
  results: RunResults,
  fixtures: Fixture[],
  options: { warn?: (msg: string) => void } = {},
): Baseline {
  const warn = options.warn ?? (msg => process.stderr.write(`${msg}\n`));
  const tagsById = new Map<string, readonly string[]>();
  for (const f of fixtures) tagsById.set(f.id, f.tags ?? []);

  const entries: Record<string, BaselineFixtureEntry> = {};
  // Alphabetical ordering for reviewability.
  const sorted = [...results.prompts].sort((a, b) => a.id.localeCompare(b.id));
  for (const p of sorted) {
    const tags = tagsById.get(p.id) ?? [];
    if (tags.includes(SCHEMA_GAP_TAG)) continue;
    if (p.samples < 5) {
      warn(`refusing to seed baseline from <5 samples for ${p.id}`);
      continue;
    }
    entries[p.id] = {
      min_pass_at_k: floorTo(p.passAtK * 0.9, 2),
      min_wilson_lower: floorTo(p.wilsonLower * 0.8, 2),
      note: `seeded from run ${results.runId} at ${p.samples} samples`,
    };
  }

  return {
    $schema_version: 1,
    generated_at: new Date().toISOString(),
    source_run: {
      commit: results.commit ?? '',
      samples: results.metadata.samples,
      model: results.metadata.model,
      provider: results.metadata.provider,
      temperature: results.metadata.temperature,
    },
    fixtures: entries,
  };
}

/** Stable, pretty-printed JSON form of a baseline snapshot. */
export function serializeBaseline(baseline: Baseline): string {
  return `${JSON.stringify(baseline, null, 2)}\n`;
}

/**
 * Parse + validate a JSON string into a Baseline. Throws on shape errors
 * with zod's formatted message — matches the style of `fixtures.ts`.
 */
export function parseBaseline(raw: string): Baseline {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Failed to parse baseline JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const result = BaselineSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Baseline JSON does not match schema: ${result.error.toString()}`);
  }
  return result.data;
}
