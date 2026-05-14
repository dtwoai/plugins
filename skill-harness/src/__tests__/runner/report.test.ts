import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { renderHtml, renderJson, renderMarkdown } from '../../runner/report.js';
import type { RunResults } from '../../runner/run.js';

const RESULTS: RunResults = {
  runId: '2026-04-22T09:00:00Z',
  model: 'claude-sonnet-4-6',
  commit: 'deadbeefcafebabe',
  tier: 'all',
  summary: {
    headline: 0.9,
    metrics: {
      hallucinationRate: 0.95,
      reservedAdvancedCompliance: 1,
      schemaValidityRate: 0.85,
      safeDefaultPreservation: 0.9,
      secretPlaceholderCompliance: 1,
      clarificationAppropriateness: 0.75,
    },
    gates: { reservedAdvancedViolation: false, requiredPromptBelowThreshold: false },
  },
  metadata: {
    temperature: 0.2,
    samples: 5,
    model: 'claude-sonnet-4-6',
    provider: 'anthropic',
    seed: null,
  },
  prompts: [
    {
      id: 'bearer-token-simple',
      tier: 'required',
      passed: true,
      runs: [],
      samples: 5,
      passes: 5,
      passAtK: 1,
      wilsonLower: 0.565,
      wilsonUpper: 1,
    },
    {
      id: 'ambiguous-missing-audience',
      tier: 'required',
      passed: true,
      runs: [],
      clarifyingQuestionExpected: true,
      samples: 5,
      passes: 4,
      passAtK: 0.8,
      wilsonLower: 0.376,
      wilsonUpper: 0.964,
    },
  ],
};

describe('renderJson', () => {
  it('produces valid JSON that round-trips', () => {
    const json = renderJson(RESULTS);
    const parsed = JSON.parse(json) as RunResults;
    assert.equal(parsed.model, RESULTS.model);
    assert.equal(parsed.prompts.length, 2);
    assert.equal(parsed.summary.headline, 0.9);
  });
});

describe('renderMarkdown', () => {
  it('starts with a recognizable header', () => {
    const md = renderMarkdown(RESULTS);
    assert.match(md, /^# Gateway-config skill bench/);
  });

  it('includes every prompt id', () => {
    const md = renderMarkdown(RESULTS);
    for (const p of RESULTS.prompts) {
      assert.match(md, new RegExp(`\\b${p.id}\\b`));
    }
  });

  it('shows the five headline metrics by name', () => {
    const md = renderMarkdown(RESULTS);
    for (const name of [
      'hallucinationRate',
      'reservedAdvancedCompliance',
      'schemaValidityRate',
      'safeDefaultPreservation',
      'secretPlaceholderCompliance',
    ]) {
      assert.ok(md.includes(name), `expected ${name} in markdown`);
    }
  });

  it('includes a run-metadata block covering the 5 required fields', () => {
    const md = renderMarkdown(RESULTS);
    assert.ok(md.includes('Run metadata'), 'expected a Run metadata section');
    // Values — temperature + samples + provider + seed placeholder.
    assert.match(md, /temperature\s*\|\s*0\.2/);
    assert.match(md, /samples\s*\|\s*5/);
    assert.match(md, /provider\s*\|\s*anthropic/);
    assert.match(md, /seed\s*\|\s*—/);
  });

  it('shows pass@k plus a Wilson CI per prompt row', () => {
    const md = renderMarkdown(RESULTS);
    assert.match(md, /pass@k/);
    assert.match(md, /95% CI/);
    // Spot-check a CI formatted output from the baseline fixture.
    assert.ok(md.includes('[37.6%, 96.4%]'), 'expected Wilson CI for ambiguous-missing-audience row');
  });
});

describe('renderHtml', () => {
  it('is well-formed HTML', () => {
    const html = renderHtml(RESULTS);
    assert.ok(html.startsWith('<!doctype html>'));
    assert.ok(html.includes('</html>'));
    assert.ok(html.includes('<style>'));
  });

  it('includes every prompt id', () => {
    const html = renderHtml(RESULTS);
    for (const p of RESULTS.prompts) {
      assert.ok(html.includes(p.id), `expected ${p.id} in html`);
    }
  });

  it('stays under 10 KB for a 2-prompt run', () => {
    const html = renderHtml(RESULTS);
    assert.ok(html.length < 10_000, `html length ${html.length} > 10000`);
  });

  it('renders the run-metadata block and per-fixture Wilson CI cells', () => {
    const html = renderHtml(RESULTS);
    assert.ok(html.includes('Run metadata'), 'expected Run metadata heading');
    assert.ok(html.includes('>samples<'), 'expected metadata field label');
    assert.ok(html.includes('pass@k'), 'expected pass@k column header');
    // CI bracket characters get HTML-escaped, but digit/percent spans survive.
    assert.ok(html.includes('37.6%'));
    assert.ok(html.includes('96.4%'));
  });
});
