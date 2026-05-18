import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { aggregate, type PromptResultLite, weightedComposite, wilsonInterval } from '../../runner/aggregate.js';

describe('aggregate', () => {
  it('returns a zeroed result on empty input', () => {
    const r = aggregate([]);
    assert.equal(r.passed, false);
    assert.equal(r.samples, 0);
    assert.equal(r.passes, 0);
    assert.equal(r.passAtK, 0);
    assert.equal(r.wilsonLower, 0);
    assert.equal(r.wilsonUpper, 0);
  });

  it('passes at exactly 80%', () => {
    const runs = Array.from({ length: 5 }, (_, i) => ({ passed: i !== 0 })); // 4/5
    const r = aggregate(runs);
    assert.equal(r.passAtK, 0.8);
    assert.equal(r.passed, true);
    assert.equal(r.samples, 5);
    assert.equal(r.passes, 4);
  });

  it('fails at 3/5 (60%)', () => {
    const runs = [true, true, true, false, false].map(passed => ({ passed }));
    const r = aggregate(runs);
    assert.equal(r.passed, false);
    assert.ok(Math.abs(r.passAtK - 0.6) < 1e-9);
    assert.equal(r.samples, 5);
    assert.equal(r.passes, 3);
  });

  it('emits a sensible Wilson CI at samples=1, all pass', () => {
    const r = aggregate([{ passed: true }]);
    assert.equal(r.samples, 1);
    assert.equal(r.passAtK, 1);
    // With one pass out of one sample the 95% CI is roughly [0.21, 1.0];
    // the upper bound is clipped to 1.
    assert.equal(r.wilsonUpper, 1);
    assert.ok(r.wilsonLower > 0 && r.wilsonLower < 0.5, `expected wide lower bound, got ${r.wilsonLower}`);
  });

  it('emits a sensible Wilson CI at samples=1, all fail', () => {
    const r = aggregate([{ passed: false }]);
    assert.equal(r.samples, 1);
    assert.equal(r.passAtK, 0);
    assert.equal(r.wilsonLower, 0);
    assert.ok(r.wilsonUpper > 0.5 && r.wilsonUpper < 1, `expected wide upper bound, got ${r.wilsonUpper}`);
  });

  it('narrows the Wilson CI as samples grow', () => {
    // 8 of 10 passes → pass@k = 0.8; CI narrows meaningfully relative to n=1.
    const runs = Array.from({ length: 10 }, (_, i) => ({ passed: i < 8 }));
    const r = aggregate(runs);
    assert.equal(r.samples, 10);
    assert.equal(r.passes, 8);
    assert.ok(Math.abs(r.passAtK - 0.8) < 1e-9);
    // Known Wilson 95% CI for 8/10 ≈ [0.4902, 0.9433].
    assert.ok(Math.abs(r.wilsonLower - 0.4902) < 1e-3, `lower=${r.wilsonLower}`);
    assert.ok(Math.abs(r.wilsonUpper - 0.9433) < 1e-3, `upper=${r.wilsonUpper}`);
  });
});

describe('wilsonInterval', () => {
  it('pins the known textbook case: 7/10 passes', () => {
    // Independent fixture: Wilson 95% CI for 7/10 ≈ [0.3968, 0.8922].
    const { lower, upper } = wilsonInterval(7, 10);
    assert.ok(Math.abs(lower - 0.3968) < 1e-3, `lower=${lower}`);
    assert.ok(Math.abs(upper - 0.8922) < 1e-3, `upper=${upper}`);
  });

  it('returns [0, 1] at 0/0 (samples=0 edge case)', () => {
    const { lower, upper } = wilsonInterval(0, 0);
    assert.equal(lower, 0);
    assert.equal(upper, 0);
  });

  it('clamps the upper bound to 1 and the lower bound to 0', () => {
    // All-pass at n=3 would otherwise have an upper > 1 if you naively
    // computed center + margin without clamping.
    const full = wilsonInterval(3, 3);
    assert.equal(full.upper, 1);
    assert.ok(full.lower > 0);
    // All-fail at n=3 — lower must clip to 0.
    const none = wilsonInterval(0, 3);
    assert.equal(none.lower, 0);
    assert.ok(none.upper < 1);
  });

  it('narrows as n grows for a fixed p̂', () => {
    const wide = wilsonInterval(5, 10);
    const narrow = wilsonInterval(50, 100);
    const veryNarrow = wilsonInterval(500, 1000);
    assert.ok(wide.upper - wide.lower > narrow.upper - narrow.lower);
    assert.ok(narrow.upper - narrow.lower > veryNarrow.upper - veryNarrow.lower);
  });
});

function lite(
  id: string,
  tier: 'required' | 'aspirational',
  passAtK: number,
  runs: Array<{ passed: boolean; failures: Array<{ check: string; message: string }>; askedClarifying?: boolean }>,
  clarifyingQuestionExpected?: boolean,
): PromptResultLite {
  return {
    id,
    tier,
    passAtK,
    passed: passAtK >= 0.8,
    runs,
    clarifyingQuestionExpected,
  };
}

describe('weightedComposite', () => {
  it('gives a perfect-ish headline on all-clean runs', () => {
    const prompts: PromptResultLite[] = [
      lite('a', 'required', 1, [
        { passed: true, failures: [] },
        { passed: true, failures: [] },
      ]),
    ];
    const c = weightedComposite(prompts);
    assert.equal(c.headline, 1);
    assert.equal(c.gates.reservedAdvancedViolation, false);
    assert.equal(c.gates.requiredPromptBelowThreshold, false);
    assert.equal(c.metrics.hallucinationRate, 1);
    assert.equal(c.metrics.reservedAdvancedCompliance, 1);
  });

  it('zeros the headline when a reserved-advanced violation is present', () => {
    const prompts: PromptResultLite[] = [
      lite('a', 'required', 1, [
        {
          passed: false,
          failures: [{ check: 'must_validate', message: 'reserved key rejected: PORT' }],
        },
      ]),
    ];
    const c = weightedComposite(prompts);
    assert.equal(c.headline, 0);
    assert.equal(c.gates.reservedAdvancedViolation, true);
    assert.equal(c.metrics.reservedAdvancedCompliance, 0);
  });

  it('zeros the headline when any required-tier prompt is below 80%', () => {
    const prompts: PromptResultLite[] = [
      lite('a', 'required', 0.6, [
        { passed: true, failures: [] },
        { passed: false, failures: [{ check: 'no_hallucinated_keys', message: 'bogus' }] },
      ]),
    ];
    const c = weightedComposite(prompts);
    assert.equal(c.headline, 0);
    assert.equal(c.gates.requiredPromptBelowThreshold, true);
  });

  it('counts hallucinationRate and gives it 2x the weight of other metrics', () => {
    // One failing run with a hallucination; one clean. hallucinationRate = 0.5.
    // All other metrics = 1. Expected headline (no gate, aspirational):
    //   (0.5*2 + 1 + 1 + 1 + 1 + 1) / 7 = 6/7 ≈ 0.857
    const prompts: PromptResultLite[] = [
      lite('a', 'aspirational', 1, [
        { passed: true, failures: [] },
        { passed: false, failures: [{ check: 'no_hallucinated_keys', message: 'bogus' }] },
      ]),
    ];
    const c = weightedComposite(prompts);
    assert.ok(Math.abs(c.headline - 6 / 7) < 1e-9, `got ${c.headline}`);
  });

  it('scores clarificationAppropriateness against the fixture flag', () => {
    // Fixture expects a clarifying question and the runner asked one.
    const prompts: PromptResultLite[] = [
      lite(
        'a',
        'required',
        1,
        [
          { passed: true, failures: [], askedClarifying: true },
          { passed: true, failures: [], askedClarifying: true },
        ],
        true,
      ),
    ];
    const c = weightedComposite(prompts);
    assert.equal(c.metrics.clarificationAppropriateness, 1);
  });

  it('penalizes clarificationAppropriateness when expectation mismatches actual', () => {
    // Fixture expects NO clarifying question but runner asked one.
    const prompts: PromptResultLite[] = [
      lite('a', 'aspirational', 1, [{ passed: true, failures: [], askedClarifying: true }], false),
    ];
    const c = weightedComposite(prompts);
    assert.equal(c.metrics.clarificationAppropriateness, 0);
  });
});
