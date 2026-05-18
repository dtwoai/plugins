/**
 * Report renderers for Tier-2 results.
 *
 * Three formats:
 *   - `renderJson`     — the full `RunResults` as pretty-printed JSON.
 *                        Machine-readable canonical record.
 *   - `renderMarkdown` — compact summary: 5-row metric table + per-prompt
 *                        table. Designed to fit in a GitHub step-summary
 *                        and PR comment.
 *   - `renderHtml`     — self-contained HTML (no external CSS/JS) with
 *                        the same tables, uploaded as a workflow
 *                        artifact.
 */

import type { BaselineComparison } from './baseline.js';
import type { RunResults } from './run.js';

function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

/** `[lo, hi]` formatted as percentages; used for the Wilson CI column. */
function formatCi(lower: number, upper: number): string {
  return `[${(lower * 100).toFixed(1)}%, ${(upper * 100).toFixed(1)}%]`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

export function renderJson(results: RunResults): string {
  return `${JSON.stringify(results, null, 2)}\n`;
}

/** Signed-percent delta for the vs-baseline columns. */
function formatDelta(current: number, baseline: number): string {
  const diff = (current - baseline) * 100;
  const sign = diff >= 0 ? '+' : '';
  return `${sign}${diff.toFixed(1)}%`;
}

export function renderMarkdown(results: RunResults, comparison?: BaselineComparison): string {
  const { summary, prompts, runId, model, commit, metadata } = results;
  const commitLine = commit ? ` · commit \`${commit.slice(0, 7)}\`` : '';
  const gates: string[] = [];
  if (summary.gates.reservedAdvancedViolation) gates.push('reserved-advanced violation');
  if (summary.gates.requiredPromptBelowThreshold) gates.push('required-tier below 80%');
  const gateLine = gates.length > 0 ? ` · gates: ${gates.join(', ')}` : '';

  const lines: string[] = [];
  lines.push('# Gateway-config skill bench');
  lines.push('');
  lines.push(`Run \`${runId}\` · model \`${model}\` · tier \`${results.tier}\`${commitLine}${gateLine}`);
  lines.push('');
  lines.push(`**Headline:** ${formatRate(summary.headline)}`);
  lines.push('');
  lines.push('## Run metadata');
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('| --- | --- |');
  lines.push(`| provider | ${metadata.provider} |`);
  lines.push(`| model | ${metadata.model} |`);
  lines.push(`| temperature | ${metadata.temperature} |`);
  lines.push(`| samples | ${metadata.samples} |`);
  lines.push(`| seed | ${metadata.seed === null ? '—' : String(metadata.seed)} |`);
  lines.push('');
  lines.push('## Metrics');
  lines.push('');
  lines.push('| Metric | Score |');
  lines.push('| --- | --- |');
  lines.push(`| hallucinationRate (×2 weight) | ${formatRate(summary.metrics.hallucinationRate)} |`);
  lines.push(
    `| reservedAdvancedCompliance (binary gate) | ${formatRate(summary.metrics.reservedAdvancedCompliance)} |`,
  );
  lines.push(`| schemaValidityRate | ${formatRate(summary.metrics.schemaValidityRate)} |`);
  lines.push(`| safeDefaultPreservation | ${formatRate(summary.metrics.safeDefaultPreservation)} |`);
  lines.push(`| secretPlaceholderCompliance | ${formatRate(summary.metrics.secretPlaceholderCompliance)} |`);
  lines.push(`| clarificationAppropriateness | ${formatRate(summary.metrics.clarificationAppropriateness)} |`);
  lines.push('');
  lines.push('## Prompts');
  lines.push('');
  lines.push('| id | tier | pass@k | 95% CI | samples | passed |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const p of prompts) {
    lines.push(
      `| \`${p.id}\` | ${p.tier} | ${formatRate(p.passAtK)} | ${formatCi(p.wilsonLower, p.wilsonUpper)} | ${p.samples} | ${p.passed ? 'yes' : 'no'} |`,
    );
  }
  lines.push('');

  if (comparison) {
    lines.push('## vs baseline');
    lines.push('');
    lines.push(
      '| id | tier | passAtK | baseline passAtK min | Δ | wilsonLower | baseline wilsonLower min | Δ | status |',
    );
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const row of comparison.rows) {
      const status = row.status === 'regression' ? '**regression**' : row.status;
      lines.push(
        `| \`${row.id}\` | ${row.tier} | ${formatRate(row.passAtK)} | ${formatRate(row.minPassAtK)} | ${formatDelta(
          row.passAtK,
          row.minPassAtK,
        )} | ${formatRate(row.wilsonLower)} | ${formatRate(row.minWilsonLower)} | ${formatDelta(
          row.wilsonLower,
          row.minWilsonLower,
        )} | ${status} |`,
      );
    }
    lines.push('');
    lines.push(
      `Summary: ${comparison.regressions.length} regressions, ${comparison.improvements.length} improvements, ${comparison.missing.length} missing, ${comparison.unexpected.length} unexpected.`,
    );
    lines.push('');
  }

  return lines.join('\n');
}

export function renderHtml(results: RunResults, comparison?: BaselineComparison): string {
  const { summary, prompts, runId, model, commit, tier, metadata } = results;
  const metricRows = [
    ['hallucinationRate (×2 weight)', summary.metrics.hallucinationRate],
    ['reservedAdvancedCompliance (binary gate)', summary.metrics.reservedAdvancedCompliance],
    ['schemaValidityRate', summary.metrics.schemaValidityRate],
    ['safeDefaultPreservation', summary.metrics.safeDefaultPreservation],
    ['secretPlaceholderCompliance', summary.metrics.secretPlaceholderCompliance],
    ['clarificationAppropriateness', summary.metrics.clarificationAppropriateness],
  ] as const;
  const metadataRows: ReadonlyArray<readonly [string, string]> = [
    ['provider', metadata.provider],
    ['model', metadata.model],
    ['temperature', String(metadata.temperature)],
    ['samples', String(metadata.samples)],
    ['seed', metadata.seed === null ? '—' : String(metadata.seed)],
  ];
  const gates: string[] = [];
  if (summary.gates.reservedAdvancedViolation) gates.push('reserved-advanced violation');
  if (summary.gates.requiredPromptBelowThreshold) gates.push('required-tier below 80%');

  const style = `
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 2rem; color: #222; }
    h1 { margin-bottom: 0; } .meta { color: #666; font-size: 0.9rem; margin-bottom: 1rem; }
    table { border-collapse: collapse; margin: 0.5rem 0 1rem 0; }
    th, td { border: 1px solid #ccc; padding: 0.3rem 0.6rem; text-align: left; font-size: 0.9rem; }
    th { background: #f4f4f4; }
    .pass { color: #0a6b24; } .fail { color: #b4231d; }
    .headline { font-size: 1.3rem; font-weight: 600; }
    .gate { background: #fff3cd; border-left: 4px solid #d98e00; padding: 0.4rem 0.6rem; font-size: 0.9rem; }
  `.trim();

  const metricTable = metricRows
    .map(([name, val]) => `<tr><td>${escapeHtml(name)}</td><td>${formatRate(val)}</td></tr>`)
    .join('');
  const metadataTable = metadataRows
    .map(([name, val]) => `<tr><td>${escapeHtml(name)}</td><td>${escapeHtml(val)}</td></tr>`)
    .join('');
  const promptRows = prompts
    .map(
      p =>
        `<tr><td><code>${escapeHtml(p.id)}</code></td><td>${escapeHtml(p.tier)}</td><td>${formatRate(
          p.passAtK,
        )}</td><td>${escapeHtml(formatCi(p.wilsonLower, p.wilsonUpper))}</td><td>${p.samples}</td><td class="${p.passed ? 'pass' : 'fail'}">${p.passed ? 'yes' : 'no'}</td></tr>`,
    )
    .join('');

  const gateBlock = gates.length > 0 ? `<p class="gate">Gates triggered: ${gates.map(escapeHtml).join(', ')}</p>` : '';

  let baselineBlock = '';
  if (comparison) {
    const baselineRows = comparison.rows
      .map(row => {
        const statusHtml =
          row.status === 'regression' ? '<strong class="fail">regression</strong>' : escapeHtml(row.status);
        return `<tr><td><code>${escapeHtml(row.id)}</code></td><td>${escapeHtml(
          row.tier,
        )}</td><td>${formatRate(row.passAtK)}</td><td>${formatRate(
          row.minPassAtK,
        )}</td><td>${escapeHtml(formatDelta(row.passAtK, row.minPassAtK))}</td><td>${formatRate(
          row.wilsonLower,
        )}</td><td>${formatRate(row.minWilsonLower)}</td><td>${escapeHtml(
          formatDelta(row.wilsonLower, row.minWilsonLower),
        )}</td><td>${statusHtml}</td></tr>`;
      })
      .join('');
    const summaryLine = `Summary: ${comparison.regressions.length} regressions, ${comparison.improvements.length} improvements, ${comparison.missing.length} missing, ${comparison.unexpected.length} unexpected.`;
    baselineBlock = `
<h2>vs baseline</h2>
<table>
<thead><tr><th>id</th><th>tier</th><th>passAtK</th><th>baseline passAtK min</th><th>Δ</th><th>wilsonLower</th><th>baseline wilsonLower min</th><th>Δ</th><th>status</th></tr></thead>
<tbody>${baselineRows}</tbody>
</table>
<p>${escapeHtml(summaryLine)}</p>`;
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Gateway-config skill bench — ${escapeHtml(runId)}</title>
<style>${style}</style>
</head>
<body>
<h1>Gateway-config skill bench</h1>
<p class="meta">Run <code>${escapeHtml(runId)}</code> · model <code>${escapeHtml(model)}</code> · tier <code>${escapeHtml(
    tier,
  )}</code>${commit ? ` · commit <code>${escapeHtml(commit.slice(0, 7))}</code>` : ''}</p>
<p class="headline">Headline: ${formatRate(summary.headline)}</p>
${gateBlock}
<h2>Run metadata</h2>
<table>
<thead><tr><th>Field</th><th>Value</th></tr></thead>
<tbody>${metadataTable}</tbody>
</table>
<h2>Metrics</h2>
<table>
<thead><tr><th>Metric</th><th>Score</th></tr></thead>
<tbody>${metricTable}</tbody>
</table>
<h2>Prompts</h2>
<table>
<thead><tr><th>id</th><th>tier</th><th>pass@k</th><th>95% CI</th><th>samples</th><th>passed</th></tr></thead>
<tbody>${promptRows}</tbody>
</table>${baselineBlock}
</body>
</html>
`;
}
