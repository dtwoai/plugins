/**
 * Filesystem loader for `fixtures/*.yaml`. Each file is a single fixture
 * document validated against `FixtureSchema`.
 *
 * Parse failures throw with the offending file path for fast triage —
 * the Tier-1 harness treats fixture shape as CI-blocking.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

import { type Fixture, FixtureSchema } from './fixtureSchema.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Default directory: the flat `fixtures/` sibling of `src/`. Phase-1
 * binding decision #1 — no `v1/` subdirectory.
 */
export const DEFAULT_FIXTURES_DIR = resolve(HERE, '../fixtures');

export function loadFixtures(dir: string = DEFAULT_FIXTURES_DIR): Fixture[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const out: Fixture[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.yaml')) continue;
    const filePath = join(dir, entry.name);
    let doc: unknown;
    try {
      doc = yaml.load(readFileSync(filePath, 'utf8'));
    } catch (e) {
      throw new Error(`Failed to parse fixture YAML ${filePath}: ${e instanceof Error ? e.message : String(e)}`);
    }
    const result = FixtureSchema.safeParse(doc);
    if (!result.success) {
      throw new Error(`Fixture ${filePath} does not match FixtureSchema: ${result.error.toString()}`);
    }
    out.push(result.data);
  }
  // Sort for deterministic ordering — readdir order is filesystem-dependent.
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}
