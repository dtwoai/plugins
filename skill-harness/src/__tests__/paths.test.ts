import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildAllowedPathSet, normalizeYamlPath, splitVariantSuffix, stripVariantParentheticals } from '../paths.js';
import { loadSchemaArtifact } from '../schemaArtifact.js';

describe('paths', () => {
  const artifact = loadSchemaArtifact();
  const allowed = buildAllowedPathSet(artifact);

  it('includes the discriminator at the bare variant base path', () => {
    assert.ok(allowed.has('mcp_servers[].authentication.type'));
  });

  it('includes variant-specific fields under the bare base path', () => {
    // bearer variant
    assert.ok(allowed.has('mcp_servers[].authentication.token'));
    // oauth variant
    assert.ok(allowed.has('mcp_servers[].authentication.issuer'));
    assert.ok(allowed.has('mcp_servers[].authentication.pkce_enabled'));
    // basic variant
    assert.ok(allowed.has('mcp_servers[].authentication.username'));
    assert.ok(allowed.has('mcp_servers[].authentication.password'));
    // query_param variant
    assert.ok(allowed.has('mcp_servers[].authentication.param_key'));
    // cert variant
    assert.ok(allowed.has('mcp_servers[].authentication.ca_cert'));
  });

  it('treats extra_authorize_params as a terminal record leaf', () => {
    assert.ok(allowed.has('mcp_servers[].authentication.extra_authorize_params'));
    // No path should be walked *inside* the record leaf.
    for (const p of allowed) {
      assert.ok(
        !p.startsWith('mcp_servers[].authentication.extra_authorize_params.'),
        `unexpected descent into record leaf: ${p}`,
      );
    }
  });

  it('includes top-level gateway + SSRF fields', () => {
    assert.ok(allowed.has('gateway.authentication.enabled'));
    assert.ok(allowed.has('gateway.ssrf.dns_fail_closed'));
    assert.ok(allowed.has('gateway.ssrf.allow_localhost'));
    assert.ok(allowed.has('gateway.ssrf.allowed_networks'));
    assert.ok(allowed.has('gateway.authentication.jwks_info.jwt_issuer'));
  });

  it('does not emit paths from the parent union section itself', () => {
    // The parent discriminator section (path `mcp_servers[].authentication`)
    // owns variants[] but has an empty fields[] — it must not contribute
    // any field paths itself. We check by making sure no synthetic
    // `<path>.<discriminator-name>` leaks into the set.
    assert.ok(!allowed.has('mcp_servers[].authentication.bearer'));
    assert.ok(!allowed.has('mcp_servers[].authentication.oauth'));
  });

  it('normalizes concrete array indices to []', () => {
    assert.equal(normalizeYamlPath('mcp_servers[0].authentication.type'), 'mcp_servers[].authentication.type');
    assert.equal(normalizeYamlPath('a[12][3].b'), 'a[][].b');
    // Idempotent.
    assert.equal(normalizeYamlPath('mcp_servers[].authentication.type'), 'mcp_servers[].authentication.type');
  });

  it('splits variant suffixes', () => {
    assert.deepEqual(splitVariantSuffix('mcp_servers[].authentication (oauth)'), {
      base: 'mcp_servers[].authentication',
      variant: 'oauth',
    });
    assert.equal(splitVariantSuffix('gateway.authentication'), null);
  });

  it('strips mid-path variant parentheticals (nested variant sections)', () => {
    // Nested variant section title from the generator.
    assert.equal(
      stripVariantParentheticals('mcp_servers[].authentication (authheaders).headers[]'),
      'mcp_servers[].authentication.headers[]',
    );
    // Trailing variant also stripped.
    assert.equal(stripVariantParentheticals('mcp_servers[].authentication (oauth)'), 'mcp_servers[].authentication');
    // No parentheticals — passthrough.
    assert.equal(stripVariantParentheticals('gateway.ssrf'), 'gateway.ssrf');
  });

  it('includes authheaders.headers[].value under the bare base path (nested variant)', () => {
    // Nested variant (authheaders).headers[] must compose its fields under
    // `mcp_servers[].authentication.headers[]` — i.e. the shape a real
    // YAML emits after normalizeYamlPath.
    assert.ok(allowed.has('mcp_servers[].authentication.headers[].value'));
    assert.ok(allowed.has('mcp_servers[].authentication.headers[].key'));
  });
});
