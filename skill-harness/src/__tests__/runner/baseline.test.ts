import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Fixture } from '../../fixtureSchema.js';
import {
  BASELINE_EPSILON,
  type Baseline,
  buildBaseline,
  compareBaseline,
  parseBaseline,
  serializeBaseline,
} from '../../runner/baseline.js';
import type { PromptResult, RunResults } from '../../runner/run.js';

function fixture(id: string, opts: Partial<Fixture> = {}): Fixture {
  return {
    id,
    tier: 'aspirational',
    user_prompt: 'irrelevant for baseline tests',
    expect: { must_validate: true },
    clarifying_question_expected: false,
    ...opts,
  };
}

function prompt(id: string, passAtK: number, wilsonLower: number, opts: Partial<PromptResult> = {}): PromptResult {
  const samples = opts.samples ?? 10;
  const passes = Math.round(passAtK * samples);
  return {
    id,
    tier: 'aspirational',
    passed: passAtK >= 0.8,
    runs: [],
    samples,
    passes,
    passAtK,
    wilsonLower,
    wilsonUpper: Math.min(1, wilsonLower + 0.25),
    ...opts,
  };
}

function results(prompts: PromptResult[]): RunResults {
  return {
    runId: '2026-04-23T00:00:00Z',
    model: 'claude-sonnet-4-6',
    commit: 'deadbeef',
    tier: 'all',
    summary: {
      headline: 0.9,
      metrics: {
        hallucinationRate: 1,
        reservedAdvancedCompliance: 1,
        schemaValidityRate: 1,
        safeDefaultPreservation: 1,
        secretPlaceholderCompliance: 1,
        clarificationAppropriateness: 1,
      },
      gates: { reservedAdvancedViolation: false, requiredPromptBelowThreshold: false },
    },
    metadata: {
      temperature: 0,
      samples: 10,
      model: 'claude-sonnet-4-6',
      provider: 'claude-cli',
      seed: null,
    },
    prompts,
  };
}

function baseline(
  fixtures: Record<string, { min_pass_at_k: number; min_wilson_lower: number; note?: string }>,
): Baseline {
  const entries: Baseline['fixtures'] = {};
  for (const [id, e] of Object.entries(fixtures)) {
    entries[id] = {
      min_pass_at_k: e.min_pass_at_k,
      min_wilson_lower: e.min_wilson_lower,
      note: e.note ?? 'test entry',
    };
  }
  return {
    $schema_version: 1,
    generated_at: '2026-04-23T00:00:00Z',
    source_run: {
      commit: 'deadbeef',
      samples: 10,
      model: 'claude-sonnet-4-6',
      provider: 'claude-cli',
      temperature: 0,
    },
    fixtures: entries,
  };
}

describe('buildBaseline', () => {
  it('skips fixtures tagged schema_gap_flagged', () => {
    const fixtures: Fixture[] = [fixture('alpha'), fixture('beta', { tags: ['schema_gap_flagged'] })];
    const run = results([prompt('alpha', 1, 0.72), prompt('beta', 1, 0.72)]);
    const warnings: string[] = [];
    const b = buildBaseline(run, fixtures, { warn: m => warnings.push(m) });
    assert.ok('alpha' in b.fixtures);
    assert.ok(!('beta' in b.fixtures));
    assert.deepEqual(warnings, []);
  });

  it('refuses to seed fixtures with fewer than 5 samples and warns', () => {
    const fixtures: Fixture[] = [fixture('alpha'), fixture('thin')];
    const run = results([
      prompt('alpha', 0.9, 0.55, { samples: 10, passes: 9 }),
      prompt('thin', 1, 0.21, { samples: 3, passes: 3 }),
    ]);
    const warnings: string[] = [];
    const b = buildBaseline(run, fixtures, { warn: m => warnings.push(m) });
    assert.ok('alpha' in b.fixtures);
    assert.ok(!('thin' in b.fixtures));
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /refusing to seed baseline from <5 samples for thin/);
  });

  it('applies defensive flooring to seeded values', () => {
    const fixtures: Fixture[] = [fixture('alpha')];
    // passAtK = 1.0 -> min_pass_at_k = floor(0.9, 2) = 0.9
    // wilsonLower = 0.5 -> min_wilson_lower = floor(0.4, 2) = 0.4
    const run = results([prompt('alpha', 1, 0.5)]);
    const b = buildBaseline(run, fixtures);
    assert.equal(b.fixtures.alpha.min_pass_at_k, 0.9);
    assert.equal(b.fixtures.alpha.min_wilson_lower, 0.4);
    assert.match(b.fixtures.alpha.note, /seeded from run .* at 10 samples/);
  });
});

describe('compareBaseline', () => {
  it('detects regression on passAtK drop below min_pass_at_k', () => {
    const fixtures: Fixture[] = [fixture('alpha')];
    const run = results([prompt('alpha', 0.5, 0.5)]); // passAtK below floor
    const b = baseline({ alpha: { min_pass_at_k: 0.8, min_wilson_lower: 0.4 } });
    const cmp = compareBaseline(b, run, fixtures);
    assert.equal(cmp.regressions.length, 1);
    assert.equal(cmp.regressions[0].id, 'alpha');
    assert.ok(cmp.regressions[0].axes.includes('passAtK'));
  });

  it('detects regression on wilsonLower drop when passAtK is above min', () => {
    const fixtures: Fixture[] = [fixture('alpha')];
    // passAtK = 0.9 >= 0.8 (fine), wilsonLower = 0.3 < 0.5 (regression).
    const run = results([prompt('alpha', 0.9, 0.3)]);
    const b = baseline({ alpha: { min_pass_at_k: 0.8, min_wilson_lower: 0.5 } });
    const cmp = compareBaseline(b, run, fixtures);
    assert.equal(cmp.regressions.length, 1);
    assert.equal(cmp.regressions[0].axes.length, 1);
    assert.equal(cmp.regressions[0].axes[0], 'wilsonLower');
  });

  it('skips schema_gap_flagged fixtures at compare time even if baseline has an entry', () => {
    const fixtures: Fixture[] = [fixture('alpha', { tags: ['schema_gap_flagged'] })];
    // Would otherwise be a regression.
    const run = results([prompt('alpha', 0.1, 0.0)]);
    const b = baseline({ alpha: { min_pass_at_k: 0.8, min_wilson_lower: 0.5 } });
    const cmp = compareBaseline(b, run, fixtures);
    assert.equal(cmp.regressions.length, 0);
    assert.equal(cmp.missing.length, 0);
    assert.equal(cmp.unexpected.length, 0);
    assert.equal(cmp.rows.length, 0);
  });

  it('returns missing entries when baseline has a fixture not in results', () => {
    const fixtures: Fixture[] = [fixture('alpha'), fixture('ghost')];
    const run = results([prompt('alpha', 1, 0.8)]);
    const b = baseline({
      alpha: { min_pass_at_k: 0.8, min_wilson_lower: 0.4 },
      ghost: { min_pass_at_k: 0.8, min_wilson_lower: 0.4 },
    });
    const cmp = compareBaseline(b, run, fixtures);
    assert.deepEqual(cmp.missing, ['ghost']);
    assert.equal(cmp.regressions.length, 0);
  });

  it('returns unexpected entries when results have a fixture not in baseline', () => {
    const fixtures: Fixture[] = [fixture('alpha'), fixture('newcomer')];
    const run = results([prompt('alpha', 1, 0.8), prompt('newcomer', 1, 0.8)]);
    const b = baseline({ alpha: { min_pass_at_k: 0.8, min_wilson_lower: 0.4 } });
    const cmp = compareBaseline(b, run, fixtures);
    assert.deepEqual(cmp.unexpected, ['newcomer']);
    assert.equal(cmp.regressions.length, 0);
  });

  it('flags regression on BOTH axes simultaneously and records both in axes[]', () => {
    const fixtures: Fixture[] = [fixture('alpha')];
    // Both passAtK and wilsonLower fall below their respective floors.
    const run = results([prompt('alpha', 0.5, 0.2)]);
    const b = baseline({ alpha: { min_pass_at_k: 0.8, min_wilson_lower: 0.5 } });
    const cmp = compareBaseline(b, run, fixtures);
    assert.equal(cmp.regressions.length, 1);
    const axes = [...cmp.regressions[0].axes].sort();
    assert.deepEqual(axes, ['passAtK', 'wilsonLower']);
  });

  it('does not apply EPSILON slack to regressions — any drop below min is a regression', () => {
    const fixtures: Fixture[] = [fixture('alpha')];
    // passAtK = 0.79 is just below 0.8; wilsonLower safely above its floor.
    // If EPSILON were applied to regressions, 0.79 > 0.8 - 0.05 would hide this.
    const run = results([prompt('alpha', 0.79, 0.6)]);
    const b = baseline({ alpha: { min_pass_at_k: 0.8, min_wilson_lower: 0.5 } });
    const cmp = compareBaseline(b, run, fixtures);
    assert.equal(cmp.regressions.length, 1);
    assert.deepEqual(cmp.regressions[0].axes, ['passAtK']);
  });

  it('flags an improvement only when BOTH passAtK and wilsonLower exceed baseline + EPSILON', () => {
    const fixtures: Fixture[] = [fixture('dual'), fixture('single'), fixture('flat')];
    const run = results([
      // dual: passAtK = 0.9 (baseline 0.8 + 0.1 > EPSILON), wilsonLower = 0.55 (baseline 0.4 + 0.15 > EPSILON)
      prompt('dual', 0.9, 0.55),
      // single: passAtK exceeds, wilsonLower only by 0.02 (< EPSILON)
      prompt('single', 0.9, 0.42),
      // flat: both exactly at threshold — no improvement
      prompt('flat', 0.8, 0.4),
    ]);
    const b = baseline({
      dual: { min_pass_at_k: 0.8, min_wilson_lower: 0.4 },
      single: { min_pass_at_k: 0.8, min_wilson_lower: 0.4 },
      flat: { min_pass_at_k: 0.8, min_wilson_lower: 0.4 },
    });
    const cmp = compareBaseline(b, run, fixtures);
    assert.equal(cmp.improvements.length, 1);
    assert.equal(cmp.improvements[0].id, 'dual');
    assert.equal(cmp.regressions.length, 0);
    // Sanity — our EPSILON is still the documented value.
    assert.equal(BASELINE_EPSILON, 0.05);
  });
});

describe('parseBaseline', () => {
  it('round-trips a valid baseline through serialize + parse', () => {
    const b = baseline({
      alpha: { min_pass_at_k: 0.8, min_wilson_lower: 0.5, note: 'a note' },
    });
    const parsed = parseBaseline(serializeBaseline(b));
    assert.deepEqual(parsed, b);
  });

  it('throws a clear error on malformed JSON', () => {
    assert.throws(() => parseBaseline('{not json'), /Failed to parse baseline JSON/);
  });

  it('throws a clear error when JSON is shaped wrongly', () => {
    const bad = JSON.stringify({ $schema_version: 2, fixtures: {} });
    assert.throws(() => parseBaseline(bad), /Baseline JSON does not match schema/);
  });

  it('throws when a fixture entry is missing required keys', () => {
    const bad = JSON.stringify({
      $schema_version: 1,
      generated_at: '2026-04-23T00:00:00Z',
      source_run: { commit: '', samples: 10, model: 'm', provider: 'p', temperature: 0 },
      fixtures: { alpha: { min_pass_at_k: 0.8 } }, // missing min_wilson_lower + note
    });
    assert.throws(() => parseBaseline(bad), /Baseline JSON does not match schema/);
  });
});
