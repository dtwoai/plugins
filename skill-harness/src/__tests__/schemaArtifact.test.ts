import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { DEFAULT_SCHEMA_ARTIFACT_PATH, loadSchemaArtifact, SCHEMA_ARTIFACT_VERSION } from '../schemaArtifact.js';

describe('schemaArtifact', () => {
  it('pins generatorVersion to 1.0.0 exactly', () => {
    assert.equal(SCHEMA_ARTIFACT_VERSION, '1.0.0');
  });

  it('loads the committed artifact from dtwo/skills/dtwo-gateway-config/', () => {
    const artifact = loadSchemaArtifact();
    assert.equal(artifact.generatorVersion, '1.0.0');
    assert.ok(Array.isArray(artifact.sections));
    assert.ok(artifact.sections.length > 0);
    assert.ok(Array.isArray(artifact.reservedKeys));
    assert.ok(artifact.reservedKeys.length > 0);
  });

  it('throws when a tweaked copy carries a different generatorVersion', () => {
    const artifact = loadSchemaArtifact();
    const tweaked = { ...artifact, generatorVersion: '1.0.1' };
    const dir = mkdtempSync(join(tmpdir(), 'skill-harness-'));
    const path = join(dir, 'schema-reference.json');
    writeFileSync(path, JSON.stringify(tweaked));
    assert.throws(() => loadSchemaArtifact(path), /generatorVersion .* != expected/);
  });

  it('exposes a stable default path', () => {
    assert.ok(DEFAULT_SCHEMA_ARTIFACT_PATH.endsWith('schema-reference.json'));
  });
});
