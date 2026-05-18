import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildSafeDefaults, findWeakenedDefaults, SAFE_DEFAULT_SEEDS } from '../safeDefaults.js';
import { loadSchemaArtifact } from '../schemaArtifact.js';

const artifact = loadSchemaArtifact();

describe('safeDefaults', () => {
  it('resolves every seed cleanly against the real artifact', () => {
    const map = buildSafeDefaults(artifact);
    assert.equal(map.size, SAFE_DEFAULT_SEEDS.length);
    for (const seed of SAFE_DEFAULT_SEEDS) {
      assert.ok(map.has(seed), `missing seed resolution: ${seed}`);
    }
    // Spot-check native coercion.
    assert.equal(map.get('gateway.authentication.enabled'), true);
    assert.equal(map.get('gateway.ssrf.dns_fail_closed'), true);
    assert.equal(map.get('gateway.ssrf.allow_localhost'), false);
    assert.equal(map.get('gateway.ssrf.allow_private_networks'), false);
    assert.deepEqual(map.get('gateway.ssrf.allowed_networks'), []);
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
