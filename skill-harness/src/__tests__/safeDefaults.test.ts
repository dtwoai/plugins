import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildSafeDefaults,
  findWeakenedDefaults,
  GATEWAY_OWNED_SAFE_DEFAULTS,
  SAFE_DEFAULT_SEEDS,
} from '../safeDefaults.js';
import { loadSchemaArtifact, type SchemaArtifact } from '../schemaArtifact.js';

const artifact = loadSchemaArtifact();

/** Deep clone so a mutation probe cannot leak into the shared artifact. */
function cloneArtifact(): SchemaArtifact {
  return structuredClone(artifact);
}

function fieldAt(clone: SchemaArtifact, sectionPath: string, fieldName: string) {
  const section = clone.sections.find(s => s.path === sectionPath);
  assert.ok(section, `probe setup: no section ${sectionPath}`);
  const field = section.fields.find(f => f.name === fieldName);
  assert.ok(field, `probe setup: no field ${sectionPath}.${fieldName}`);
  return field;
}

describe('safeDefaults', () => {
  it('resolves every seed cleanly against the real artifact', () => {
    const map = buildSafeDefaults(artifact);
    assert.equal(map.size, SAFE_DEFAULT_SEEDS.length + GATEWAY_OWNED_SAFE_DEFAULTS.length);
    for (const seed of SAFE_DEFAULT_SEEDS) {
      assert.ok(map.has(seed), `missing seed resolution: ${seed}`);
    }
    for (const { path } of GATEWAY_OWNED_SAFE_DEFAULTS) {
      assert.ok(map.has(path), `missing GATEWAY_OWNED_SAFE_DEFAULTS seed resolution: ${path}`);
    }
    // Spot-check native coercion.
    assert.equal(map.get('gateway.authentication.enabled'), true);
    assert.equal(map.get('gateway.ssrf.dns_fail_closed'), true);
    assert.equal(map.get('gateway.ssrf.allow_localhost'), false);
    assert.equal(map.get('gateway.ssrf.allow_private_networks'), false);
    assert.deepEqual(map.get('gateway.ssrf.allowed_networks'), []);
    // Gateway-owned value the artifact declares nowhere.
    assert.equal(map.get('gateway.authentication.jwt_issuer_verification'), true);
  });

  it('throws when a SAFE_DEFAULT_SEEDS field declares no default at all', () => {
    const clone = cloneArtifact();
    const field = fieldAt(clone, 'gateway.ssrf', 'allow_localhost');
    field.schemaDefault = null;
    field.deployDefault = null;
    assert.throws(() => buildSafeDefaults(clone), /no schemaDefault and no deployDefault/);
  });

  it('throws when a GATEWAY_OWNED_SAFE_DEFAULTS entry would shadow a default the artifact declares', () => {
    const clone = cloneArtifact();
    fieldAt(clone, 'gateway.authentication', 'jwt_issuer_verification').schemaDefault = false;
    assert.throws(() => buildSafeDefaults(clone), /would shadow a default the artifact now declares/);
  });

  it('flags a weakened SSRF setting', () => {
    const map = buildSafeDefaults(artifact);
    const parsed = {
      gateway: {
        ssrf: {
          allow_localhost: true,
        },
      },
    };
    const w = findWeakenedDefaults(parsed, map);
    assert.equal(w.length, 1);
    assert.equal(w[0].path, 'gateway.ssrf.allow_localhost');
    assert.equal(w[0].expected, false);
    assert.equal(w[0].actual, true);
  });

  it('accepts omission of a safe-default field', () => {
    const map = buildSafeDefaults(artifact);
    const parsed = { gateway: {} };
    const w = findWeakenedDefaults(parsed, map);
    assert.deepEqual(w, []);
  });

  it('accepts an explicit match of the safe default', () => {
    const map = buildSafeDefaults(artifact);
    const parsed = {
      gateway: {
        ssrf: {
          allow_localhost: false,
          dns_fail_closed: true,
        },
      },
    };
    const w = findWeakenedDefaults(parsed, map);
    assert.deepEqual(w, []);
  });

  it('honors opt-out for a specific path', () => {
    const map = buildSafeDefaults(artifact);
    const parsed = {
      gateway: {
        ssrf: {
          allow_localhost: true,
        },
      },
    };
    const optOut = new Set(['gateway.ssrf.allow_localhost']);
    const w = findWeakenedDefaults(parsed, map, optOut);
    assert.deepEqual(w, []);
  });
});
