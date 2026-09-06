import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FixtureSchema } from '../fixtureSchema.js';
import { loadFixtures } from '../fixtures.js';
import { buildAllowedPathSet, normalizeYamlPath } from '../paths.js';
import { loadSchemaArtifact } from '../schemaArtifact.js';

describe('fixtures', () => {
  const fixtures = loadFixtures();

  it('loads the Phase 2 fixture battery (12 required + 18 aspirational)', () => {
    const ids = fixtures.map(f => f.id).sort();
    assert.deepEqual(ids, [
      'advanced-custom-env-var',
      'adversarial-disable-auth',
      'adversarial-reserved-in-advanced',
      'ambiguous-missing-audience',
      'ambiguous-missing-issuer',
      'atlassian-auth0-oauth',
      'auth-headers-x-api-key',
      'basic-auth-simple',
      'bearer-token-simple',
      'cert-mtls',
      'cognito-oauth-client-credentials',
      'contradictory-dcr-with-secret',
      'contradictory-grant-with-redirect',
      'docebo-oauth-no-scopes',
      'entra-oauth-client-credentials',
      'github-copilot-mcp-authheaders',
      'github-oauth-client-credentials',
      'keycloak-oauth-dcr',
      'linear-remote-dcr-streamable-http',
      'log-level-debug',
      'mcp-server-refresh-interval',
      'ms365-entra-oauth-code',
      'multi-server-auth0',
      'notion-remote-oauth-dcr',
      'okta-oauth-dcr',
      'query-param-auth',
      'slack-auth0-oauth',
      'ssrf-allow-localhost',
      'ssrf-allow-private-networks',
      'ssrf-allowed-networks-cidrs',
    ]);
    const required = fixtures.filter(f => f.tier === 'required').length;
    const aspirational = fixtures.filter(f => f.tier === 'aspirational').length;
    assert.equal(required, 12, 'expected 12 required fixtures');
    assert.equal(aspirational, 18, 'expected 18 aspirational fixtures');
  });

  it('every value_constraint keeps exactly one kind key after parse', () => {
    // Regression for `value-constraints-stripped-at-parse` (known-defects.md):
    // with a plain `equals: z.unknown()` object first in the union, every
    // `regex` / `min_length` constraint parsed to a bare `{ path }`.
    const KINDS = ['equals', 'regex', 'min_length', 'max_length'];
    let seen = 0;
    for (const f of fixtures) {
      for (const c of f.expect.value_constraints ?? []) {
        const kinds = Object.keys(c).filter(k => KINDS.includes(k));
        assert.deepEqual(
          kinds.length,
          1,
          `fixture ${f.id}: constraint on ${c.path} lost its kind: ${JSON.stringify(c)}`,
        );
        seen++;
      }
    }
    assert.ok(seen >= 100, `anti-vacuity: expected the battery to carry >= 100 value_constraints, saw ${seen}`);
  });

  it('every fixture re-parses against FixtureSchema', () => {
    for (const f of fixtures) {
      const result = FixtureSchema.safeParse(f);
      assert.ok(result.success, `fixture ${f.id} failed re-parse`);
    }
  });

  it('every referenced path resolves in the allowed-path set (normalized)', () => {
    const artifact = loadSchemaArtifact();
    const allowed = buildAllowedPathSet(artifact);
    for (const f of fixtures) {
      const paths: string[] = [
        ...(f.expect.required_paths ?? []),
        ...(f.expect.forbidden_paths ?? []),
        ...(f.expect.value_constraints ?? []).map(c => c.path),
      ];
      for (const p of paths) {
        const normalized = normalizeYamlPath(p);
        assert.ok(allowed.has(normalized), `fixture ${f.id}: path ${p} (normalized=${normalized}) not in allowed set`);
      }
    }
  });
});
