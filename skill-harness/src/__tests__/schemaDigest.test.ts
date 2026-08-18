/**
 * The drift check that nothing was running.
 *
 * `scripts/generate-schema-digest.mjs --check` already existed and already
 * exited 1 on a stale digest — but no test, hook, or CI job invoked it, so a
 * refresh of `schema-reference.json` that dropped seven user-facing fields
 * left the whole suite green. This file makes `pnpm test` the thing that runs
 * it, and re-asserts coverage against the *committed* SKILL.md so the gate
 * still holds if someone edits the generator's renderers.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { DEFAULT_SCHEMA_ARTIFACT_PATH, loadSchemaArtifact } from '../schemaArtifact.js';
import {
  EXPECTED_VALIDATOR_BUNDLE_SHA256,
  EXPECTED_VALIDATOR_BUNDLE_VERSION,
  VALIDATOR_BUNDLE_PATH,
  VALIDATOR_BUNDLE_VERSION,
} from '../validatorBundle.js';

const HERE = dirname(fileURLToPath(import.meta.url));
// skill-harness/src/__tests__ → skill-harness/src → skill-harness → repo root
const REPO_ROOT = resolve(HERE, '../../..');
const GENERATOR = resolve(REPO_ROOT, 'scripts/generate-schema-digest.mjs');
const SKILL_MD = resolve(REPO_ROOT, 'dtwo/skills/dtwo-gateway-config/SKILL.md');

const BEGIN_MARKER = '<!-- BEGIN SCHEMA DIGEST';
const END_MARKER = '<!-- END SCHEMA DIGEST -->';

const artifact = loadSchemaArtifact();

/** Same conservative transform the generator applies to constraint messages. */
function tickQuotes(s: string): string {
  return s.replace(/"([A-Za-z0-9_]+)"/g, '`$1`');
}

function digestRegion(): string {
  const body = readFileSync(SKILL_MD, 'utf8');
  const begin = body.indexOf(BEGIN_MARKER);
  const end = body.indexOf(END_MARKER);
  assert.ok(begin !== -1, 'SKILL.md has no BEGIN SCHEMA DIGEST marker');
  assert.ok(end > begin, 'SKILL.md has no END SCHEMA DIGEST marker after the BEGIN marker');
  return body.slice(begin, end + END_MARKER.length);
}

function sha256OfFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

describe('schemaDigest', () => {
  it('regenerates byte-identically — the generator --check mode passes', () => {
    // Spawn rather than import: the .mjs calls main() at import time.
    const out = execFileSync(process.execPath, [GENERATOR, '--check'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    assert.match(out, /in sync with schema-reference\.json/);
  });

  it('renders every user-audience field target', () => {
    const region = digestRegion();
    const missing: string[] = [];
    for (const section of artifact.sections) {
      for (const field of section.fields) {
        if (field.audience !== 'user' || !field.target) continue;
        // Backtick-delimited on purpose: `JWT_ISSUER` is a proper substring of
        // `JWT_ISSUER_VERIFICATION`, `JWT_AUDIENCE` of
        // `JWT_AUDIENCE_VERIFICATION`, and `sotw.auth_headers` of
        // `sotw.auth_headers[].key`. A bare substring test false-passes on
        // exactly the fields this assertion exists to protect. Keying on
        // `target` rather than field name matters for the same reason —
        // `enabled` appears in four different sections.
        if (!region.includes(`\`${field.target}\``)) {
          missing.push(`${section.path} → ${field.name} (target ${field.target})`);
        }
      }
    }
    assert.deepEqual(missing, [], `user-audience field targets missing from the digest:\n${missing.join('\n')}`);
  });

  it('renders every cross-field constraint message', () => {
    const region = digestRegion();
    const missing: string[] = [];
    for (const section of artifact.sections) {
      for (const constraint of section.crossFieldConstraints ?? []) {
        if (!region.includes(tickQuotes(constraint.message))) missing.push(`${section.path}: ${constraint.message}`);
      }
    }
    assert.deepEqual(missing, [], `cross-field constraints missing from the digest:\n${missing.join('\n')}`);
  });

  it('documents every targetKind the artifact emits for user-audience fields', () => {
    const region = digestRegion();
    const kinds = new Set<string>();
    for (const section of artifact.sections) {
      for (const field of section.fields) {
        if (field.audience === 'user' && field.targetKind) kinds.add(field.targetKind);
      }
    }
    assert.ok(kinds.size > 0, 'artifact declares no targetKind at all — shape drift');
    const missing = [...kinds].filter(k => !region.includes(`\`targetKind: ${k}\``));
    assert.deepEqual(missing, [], `targetKind values with no prose in the digest: ${missing.join(', ')}`);
  });

  it('embeds the sha256 of the artifact it was generated from', () => {
    const region = digestRegion();
    const match = region.match(/schema-reference\.json sha256:([0-9a-f]{64})/);
    assert.ok(match, 'digest carries no `schema-reference.json sha256:` provenance line');
    assert.equal(match[1], sha256OfFile(DEFAULT_SCHEMA_ARTIFACT_PATH));
  });

  // The two validator-bundle assertions are deliberately separate. See the
  // docstring on src/validatorBundle.ts: the version is a shape pin that would
  // NOT have caught the drift recorded in known-defects.md as
  // `validator-bundle-drift`; the sha256 is the part that does.
  it('pins the vendored validator bundle version', () => {
    assert.equal(VALIDATOR_BUNDLE_VERSION, EXPECTED_VALIDATOR_BUNDLE_VERSION);
  });

  it('pins the vendored validator bundle bytes', () => {
    assert.equal(
      sha256OfFile(VALIDATOR_BUNDLE_PATH),
      EXPECTED_VALIDATOR_BUNDLE_SHA256,
      'vendor/config-validator.bundle.mjs changed. Bump EXPECTED_VALIDATOR_BUNDLE_SHA256 (and the version pin) ' +
        'in src/validatorBundle.ts, and re-audit the divergences listed in known-defects.md.',
    );
  });
});
