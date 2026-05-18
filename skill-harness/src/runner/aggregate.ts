/**
 * Pass-rate aggregation + the weighted-composite headline.
 *
 * The plan's §"Metrics (ranked)" enumerates six scored metrics plus
 * clarification appropriateness. We operationalize five of them as
 * per-prompt rates (counting how many of the N runs failed each check),
 * plus the binary clarification metric. Semantic fidelity is deferred to
 * v1.1 LLM-judge per the plan and not scored here.
 *
 * Metrics shape: each metric is a rate in [0, 1] where 1.0 = perfect
 * (zero failures across every run × every required-tier prompt).
 *
 *   - hallucinationRate           — 1.0 = no `no_hallucinated_keys`
 *                                   failures anywhere.
 *   - reservedAdvancedCompliance  — 1.0 = no reserved-advanced rejection
 *                                   detected. Binary gate: any violation
 *                                   zeros the headline.
 *   - schemaValidityRate          — 1.0 = every required-tier run's
 *                                   `parseConfig` succeeded.
 *   - safeDefaultPreservation     — 1.0 = no `safe_defaults_preserved`
 *                                   failures.
 *   - secretPlaceholderCompliance — 1.0 = no `secrets_are_placeholders`
 *                                   failures.
 *   - clarificationAppropriateness — fraction of prompts where the
 *                                   runner's `askedClarifying` matched the
 *                                   fixture's `clarifying_question_expected`.
 *
 * Headline composite: weighted sum (hallucinationRate counts 2×, every
 * other scored metric counts 1×, divided by total weight). Then hard
 * gates kick in:
 *   - Any reserved-advanced violation → headline = 0.
 *   - Any required-tier prompt with passAtK < 0.8 → headline = 0.
 *
 * The second gate enforces the plan's per-prompt CI-block rule without
 * short-circuiting the per-metric breakdown — the user still sees which
 * metric dragged the run down.
 */

import type { RubricFailure } from '../rubric.js';

export type RunOutcome = { passed: boolean; failures: RubricFailure[]; askedClarifying?: boolean };

export type AggregateResult = {
  /** True when `passAtK >= 0.8` (the plan's "Pass = pass-rate@N ≥ 80%" gate). */
  passed: boolean;
  /** Total number of samples that were evaluated. */
  samples: number;
  /** Number of samples whose rubric verdict was `passed=true`. */
  passes: number;
  /** `passes / samples` — the pass-rate on a 0–1 scale. */
  passAtK: number;
  /** Lower bound of the 95% Wilson score confidence interval on `passAtK`. */
  wilsonLower: number;
  /** Upper bound of the 95% Wilson score confidence interval on `passAtK`. */
  wilsonUpper: number;
};

/** z-score for a two-sided 95% confidence interval. */
const WILSON_Z = 1.96;

/**
 * Wilson score interval (95% CI) on a binomial proportion.
 *
 * Preferred over the normal-approximation (a.k.a. Wald) interval because it
 * stays inside [0, 1], handles the small-n edge cases (n=1 → [0, 0.975] for
 * one pass; [0.025, 1] for one fail), and doesn't degenerate to a zero-width
 * interval at p̂=0 or p̂=1.
 */
export function wilsonInterval(passes: number, samples: number): { lower: number; upper: number } {
  if (samples <= 0) return { lower: 0, upper: 0 };
  const z = WILSON_Z;
  const n = samples;
  const pHat = passes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (pHat + z2 / (2 * n)) / denom;
  const margin = (z * Math.sqrt((pHat * (1 - pHat) + z2 / (4 * n)) / n)) / denom;
  return {
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin),
  };
}

/**
 * Per-prompt pass-rate math: pass-rate = passes / total, `passed` at ≥ 80%.
 * Matches the plan's "Pass = pass-rate@N ≥ 80%" rule. Also emits pass@k and
 * a Wilson 95% CI so downstream reports can show statistical uncertainty
 * when `samples > 1` (and, loose as it is, an honest CI at `samples = 1`).
 */
export function aggregate(runs: Array<{ passed: boolean }>): AggregateResult {
  const samples = runs.length;
  if (samples === 0) {
    return {
      passed: false,
      samples: 0,
      passes: 0,
      passAtK: 0,
      wilsonLower: 0,
      wilsonUpper: 0,
    };
  }
  const passes = runs.filter(r => r.passed).length;
  const passAtK = passes / samples;
  const { lower, upper } = wilsonInterval(passes, samples);
  return {
    passed: passAtK >= 0.8,
    samples,
    passes,
    passAtK,
    wilsonLower: lower,
    wilsonUpper: upper,
  };
}

export type PromptResultLite = {
  id: string;
  tier: 'required' | 'aspirational';
  passAtK: number;
  passed: boolean;
  runs: Array<{ passed: boolean; failures: RubricFailure[]; askedClarifying?: boolean }>;
  clarifyingQuestionExpected?: boolean;
  /** Total samples collected for the prompt. Equals `runs.length`. */
  samples?: number;
  /** Number of samples whose rubric verdict was `passed=true`. */
  passes?: number;
  /** Lower bound of the 95% Wilson CI on `passAtK`. */
  wilsonLower?: number;
  /** Upper bound of the 95% Wilson CI on `passAtK`. */
  wilsonUpper?: number;
};

export type CompositeResult = {
  headline: number;
  metrics: {
    hallucinationRate: number;
    reservedAdvancedCompliance: number;
    schemaValidityRate: number;
    safeDefaultPreservation: number;
    secretPlaceholderCompliance: number;
    clarificationAppropriateness: number;
  };
  gates: {
    reservedAdvancedViolation: boolean;
    requiredPromptBelowThreshold: boolean;
  };
};

/**
 * Return true if a rubric failure implies a reserved-advanced rejection.
 * Detected via the check name (`must_validate`) plus a phrase match in the
 * message — `parseConfig`'s `.superRefine` on `gateway.advanced` emits
 * "reserved" in its rejection reason. This is a tolerant match: a future
 * rewording of the error still passes as long as "reserved" appears.
 */
function isReservedAdvancedFailure(f: RubricFailure): boolean {
  if (f.check !== 'must_validate') return false;
  return /reserved/i.test(f.message);
}

/**
 * Count failing runs matched by a predicate, across every run of every
 * prompt. Returns (failingRunCount, totalRunCount). A failing run is one
 * that has at least one failure satisfying the predicate.
 */
function checkFailureRate(
  prompts: PromptResultLite[],
  predicate: (f: RubricFailure) => boolean,
): { failing: number; total: number } {
  let failing = 0;
  let total = 0;
  for (const p of prompts) {
    for (const run of p.runs) {
      total += 1;
      if (run.failures.some(predicate)) failing += 1;
    }
  }
  return { failing, total };
}

function rateFromCount(failing: number, total: number): number {
  if (total === 0) return 1;
  return 1 - failing / total;
}

export function weightedComposite(prompts: PromptResultLite[]): CompositeResult {
  const hallucination = checkFailureRate(prompts, f => f.check === 'no_hallucinated_keys');
  const reservedViolations = checkFailureRate(prompts, isReservedAdvancedFailure);
  // schemaValidity: count any must_validate failure EXCEPT reserved-advanced
  // ones so reserved violations don't double-dip.
  const schemaValidity = checkFailureRate(prompts, f => f.check === 'must_validate' && !isReservedAdvancedFailure(f));
  const safeDefault = checkFailureRate(prompts, f => f.check === 'safe_defaults_preserved');
  const secret = checkFailureRate(prompts, f => f.check === 'secrets_are_placeholders');

  // Clarification appropriateness: per-prompt binary. If the fixture sets
  // clarifying_question_expected=true, at least one run must have asked;
  // otherwise no run should have asked. Prompts without the flag default
  // to "did not expect a question".
  let clarifyHits = 0;
  let clarifyTotal = 0;
  for (const p of prompts) {
    const expected = p.clarifyingQuestionExpected === true;
    clarifyTotal += 1;
    const askedAny = p.runs.some(r => r.askedClarifying === true);
    if (askedAny === expected) clarifyHits += 1;
  }

  const metrics = {
    hallucinationRate: rateFromCount(hallucination.failing, hallucination.total),
    reservedAdvancedCompliance: rateFromCount(reservedViolations.failing, reservedViolations.total),
    schemaValidityRate: rateFromCount(schemaValidity.failing, schemaValidity.total),
    safeDefaultPreservation: rateFromCount(safeDefault.failing, safeDefault.total),
    secretPlaceholderCompliance: rateFromCount(secret.failing, secret.total),
    clarificationAppropriateness: clarifyTotal === 0 ? 1 : clarifyHits / clarifyTotal,
  };

  // Weighted composite: hallucinationRate × 2, everything else × 1.
  // Clarification is included with weight 1 — it's a scored metric per the
  // plan, just not a hard gate.
  const weights = {
    hallucinationRate: 2,
    reservedAdvancedCompliance: 1,
    schemaValidityRate: 1,
    safeDefaultPreservation: 1,
    secretPlaceholderCompliance: 1,
    clarificationAppropriateness: 1,
  };
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
  let headline =
    (metrics.hallucinationRate * weights.hallucinationRate +
      metrics.reservedAdvancedCompliance * weights.reservedAdvancedCompliance +
      metrics.schemaValidityRate * weights.schemaValidityRate +
      metrics.safeDefaultPreservation * weights.safeDefaultPreservation +
      metrics.secretPlaceholderCompliance * weights.secretPlaceholderCompliance +
      metrics.clarificationAppropriateness * weights.clarificationAppropriateness) /
    totalWeight;

  const reservedAdvancedViolation = reservedViolations.failing > 0;
  const requiredPromptBelowThreshold = prompts.some(p => p.tier === 'required' && p.passAtK < 0.8);

  if (reservedAdvancedViolation || requiredPromptBelowThreshold) {
    headline = 0;
  }

  return {
    headline,
    metrics,
    gates: { reservedAdvancedViolation, requiredPromptBelowThreshold },
  };
}
