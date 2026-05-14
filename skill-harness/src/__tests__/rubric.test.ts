import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Fixture } from '../fixtureSchema.js';
import { loadFixtures } from '../fixtures.js';
import { evaluateRubric } from '../rubric.js';
import { loadSchemaArtifact } from '../schemaArtifact.js';

const artifact = loadSchemaArtifact();
const fixtures = loadFixtures();
const atlassian = fixtures.find(f => f.id === 'atlassian-auth0-oauth');
if (!atlassian) throw new Error('atlassian-auth0-oauth fixture not found');

/**
 * Build a minimal atlassian-shape YAML (gateway auth + one oauth DCR
 * MCP server). Only the fields that actually vary across tests are
 * parameterized — everything else stays baked in. Each test calls this
 * helper with the override(s) that make its case interesting.
 *
 * The baseline yields the well-formed atlassian DCR+PKCE shape:
 *   - gateway.authentication.jwks_info with Auth0 values
 *   - mcp_servers[0].authentication = { type: oauth,
 *       grant_type: authorization_code, issuer, scopes, pkce_enabled }
 */
function makeAtlassianYaml(
  overrides: {
    /** Add `gateway.ssrf.allow_localhost: <value>` under gateway. */
    allowLocalhost?: boolean;
    /** Swap the DCR flow for client_credentials + client triple (drops `issuer`). */
    useClientCredentials?: boolean;
    /** Emit a stray `client_id` alongside the DCR flow (for forbidden_paths tests). */
    leakedClientId?: string;
    /** Add an `extra_authorize_params` map to the mcp_server authentication block. */
    extraAuthorizeParams?: Record<string, string>;
  } = {},
): string {
  const ssrfBlock = overrides.allowLocalhost === true ? '  ssrf:\n    allow_localhost: true\n' : '';

  const authBlock = overrides.useClientCredentials
    ? [
        '      type: oauth',
        '      grant_type: client_credentials',
        '      client_id: abc',
        '      client_secret: "<REPLACE_ME>"',
        '      token_url: https://example.com/token',
        '      scopes: [read]',
        '      pkce_enabled: true',
      ].join('\n')
    : [
        '      type: oauth',
        '      grant_type: authorization_code',
        '      issuer: https://mcp.atlassian.com',
        ...(overrides.leakedClientId !== undefined ? [`      client_id: ${overrides.leakedClientId}`] : []),
        '      scopes: [read:jira-work]',
        '      pkce_enabled: true',
      ].join('\n');

  const extraParamsBlock =
    overrides.extraAuthorizeParams !== undefined
      ? `      extra_authorize_params:\n${Object.entries(overrides.extraAuthorizeParams)
          .map(([k, v]) => `        "${k}": "${v}"`)
          .join('\n')}\n`
      : '';

  return `
gateway:
  authentication:
    enabled: true
    jwks_info:
      jwt_algorithm: RS256
      jwt_jwks_uri: https://acme.us.auth0.com/.well-known/jwks.json
      jwt_issuer: https://acme.us.auth0.com/
      jwt_audience: https://api.acme.com
${ssrfBlock}mcp_servers:
  - name: atlassian
    url: https://mcp.atlassian.com
    authentication:
${authBlock}
${extraParamsBlock}`;
}

describe('evaluateRubric (end-to-end)', () => {
  it('passes the atlassian fixture on a well-formed YAML', () => {
    const r = evaluateRubric(atlassian, makeAtlassianYaml(), artifact);
    assert.equal(r.passed, true, `unexpected failures: ${JSON.stringify(r.failures, null, 2)}`);
    assert.deepEqual(r.failures, []);
  });

  it('fails `must_validate` on invalid YAML (OAuth missing both issuer and client triple)', () => {
    const yaml = `
mcp_servers:
  - name: atlassian
    url: https://mcp.atlassian.com
    authentication:
      type: oauth
      grant_type: authorization_code
      scopes: [read]
`;
    const r = evaluateRubric(atlassian, yaml, artifact);
    assert.equal(r.passed, false);
    assert.ok(r.failures.some(f => f.check === 'must_validate'));
  });

  it('fails `must_validate` on an invalid extra_authorize_params child key (contains a space)', () => {
    // parseConfig rejects record-child keys that don't match /^[A-Za-z0-9_.-]+$/.
    // This test pins the end-to-end flow: a space in the key surfaces as a
    // rubric `must_validate` failure rather than silently being accepted.
    const yaml = makeAtlassianYaml({ extraAuthorizeParams: { 'has space': 'foo' } });
    const r = evaluateRubric(atlassian, yaml, artifact);
    assert.equal(r.passed, false);
    assert.ok(
      r.failures.some(f => f.check === 'must_validate'),
      `expected a must_validate failure, got ${JSON.stringify(r.failures, null, 2)}`,
    );
  });

  it('fails `no_hallucinated_keys` on a fabricated top-level field', () => {
    const yaml = `${makeAtlassianYaml()}
gateway_bogus_top_level: 1
`;
    const r = evaluateRubric(atlassian, yaml, artifact);
    assert.ok(r.failures.some(f => f.check === 'no_hallucinated_keys'));
  });

  it('fails `safe_defaults_preserved` on ssrf.allow_localhost: true', () => {
    const yaml = makeAtlassianYaml({ allowLocalhost: true });
    const r = evaluateRubric(atlassian, yaml, artifact);
    assert.ok(
      r.failures.some(f => f.check === 'safe_defaults_preserved' && f.path === 'gateway.ssrf.allow_localhost'),
      `expected safe_defaults_preserved failure but got ${JSON.stringify(r.failures, null, 2)}`,
    );
  });

  it('honors fixture-level safe_default_opt_out (ssrf.allow_localhost bypass)', () => {
    // Some fixtures (e.g. "allow localhost for local development") ask the
    // skill to weaken a safe default intentionally. The rubric accepts the
    // opt-out when the fixture declares it.
    const yaml = makeAtlassianYaml({ allowLocalhost: true });
    const fixtureOptOut: Fixture = {
      ...atlassian,
      expect: {
        ...atlassian.expect,
        safe_default_opt_out: ['gateway.ssrf.allow_localhost'],
      },
    };
    const r = evaluateRubric(fixtureOptOut, yaml, artifact);
    assert.ok(
      !r.failures.some(f => f.check === 'safe_defaults_preserved' && f.path === 'gateway.ssrf.allow_localhost'),
      `safe_defaults_preserved should not fire under opt-out but got ${JSON.stringify(r.failures, null, 2)}`,
    );
  });

  it('fails `secrets_are_placeholders` when client_secret holds a real value', () => {
    // Use the bearer fixture's simpler shape to exercise the secret check
    // cleanly — atlassian is DCR so client_secret is forbidden.
    const bearer = fixtures.find(f => f.id === 'bearer-token-simple');
    if (!bearer) throw new Error('bearer fixture missing');
    const yaml = `
gateway:
  authentication:
    enabled: true
mcp_servers:
  - name: demo
    url: https://example.com/mcp
    authentication:
      type: bearer
      token: real-looking-token-abc123
`;
    const r = evaluateRubric(bearer, yaml, artifact);
    assert.ok(r.failures.some(f => f.check === 'secrets_are_placeholders'));
  });

  it('fails `required_paths` when issuer is missing', () => {
    const yaml = makeAtlassianYaml({ useClientCredentials: true });
    const r = evaluateRubric(atlassian, yaml, artifact);
    assert.ok(r.failures.some(f => f.check === 'required_paths' && f.path === 'mcp_servers[0].authentication.issuer'));
  });

  it('fails `forbidden_paths` when client_id is emitted alongside DCR', () => {
    const yaml = makeAtlassianYaml({ leakedClientId: 'leaked' });
    const r = evaluateRubric(atlassian, yaml, artifact);
    assert.ok(
      r.failures.some(f => f.check === 'forbidden_paths' && f.path === 'mcp_servers[0].authentication.client_id'),
    );
  });

  it('fails `value_constraints` on wrong type discriminator', () => {
    const yaml = `
gateway:
  authentication:
    enabled: true
    jwks_info:
      jwt_algorithm: RS256
      jwt_jwks_uri: https://acme.us.auth0.com/.well-known/jwks.json
      jwt_issuer: https://acme.us.auth0.com/
      jwt_audience: https://api.acme.com
mcp_servers:
  - name: atlassian
    url: https://mcp.atlassian.com
    authentication:
      type: bearer
      token: "<REPLACE_ME>"
`;
    const r = evaluateRubric(atlassian, yaml, artifact);
    assert.ok(r.failures.some(f => f.check === 'value_constraints'));
  });

  it('fails `safe_default_opt_out_unknown` when the opt-out names an unknown seed path', () => {
    // A typo in `safe_default_opt_out` used to be silently accepted — the
    // rubric would happily skip "gateway.nonexistent" while still running
    // (or not running) every real seed. The guard added in this revision
    // catches the typo at evaluation time as a loud rubric failure so the
    // author notices the moment they run tests.
    const yaml = makeAtlassianYaml();
    const fixtureBadOptOut: Fixture = {
      ...atlassian,
      expect: {
        ...atlassian.expect,
        safe_default_opt_out: ['gateway.nonexistent'],
      },
    };
    const r = evaluateRubric(fixtureBadOptOut, yaml, artifact);
    assert.equal(r.passed, false);
    assert.ok(
      r.failures.some(f => f.check === 'safe_default_opt_out_unknown' && f.path === 'gateway.nonexistent'),
      `expected safe_default_opt_out_unknown failure but got ${JSON.stringify(r.failures, null, 2)}`,
    );
  });

  it('accepts `safe_default_opt_out` entries that match a known seed (no unknown-opt-out failure)', () => {
    // Positive case: a well-formed opt-out for a real seed path must not
    // trip the new guard. `gateway.ssrf.allow_localhost` is in
    // SAFE_DEFAULT_SEEDS, so the opt-out is valid even though the YAML
    // baseline here doesn't set it.
    const yaml = makeAtlassianYaml();
    const fixtureGoodOptOut: Fixture = {
      ...atlassian,
      expect: {
        ...atlassian.expect,
        safe_default_opt_out: ['gateway.ssrf.allow_localhost'],
      },
    };
    const r = evaluateRubric(fixtureGoodOptOut, yaml, artifact);
    assert.ok(
      !r.failures.some(f => f.check === 'safe_default_opt_out_unknown'),
      `unexpected safe_default_opt_out_unknown: ${JSON.stringify(r.failures, null, 2)}`,
    );
  });

  it('surfaces `no_dropped_keys` when ConfigSchema rejects and must_validate is false', () => {
    // With must_validate: false, the rubric skips parseConfig but still
    // runs roundTripDiff. If ConfigSchema rejects the input, roundTripDiff
    // reports a parseError, and the rubric surfaces that as a
    // `no_dropped_keys` failure (see rubric.ts §3).
    //
    // Trigger: jwks_info present but missing a required sub-field
    // (`jwt_audience`). ConfigSchema's JwtAuthSchema requires all four.
    const brokenYaml = `
gateway:
  authentication:
    enabled: true
    jwks_info:
      jwt_algorithm: RS256
      jwt_jwks_uri: https://acme.us.auth0.com/.well-known/jwks.json
      jwt_issuer: https://acme.us.auth0.com/
mcp_servers:
  - name: atlassian
    url: https://mcp.atlassian.com
    authentication:
      type: oauth
      grant_type: authorization_code
      issuer: https://mcp.atlassian.com
      scopes: [read]
      pkce_enabled: true
`;
    const fixtureNoValidate: Fixture = {
      ...atlassian,
      expect: { ...atlassian.expect, must_validate: false },
    };
    const r = evaluateRubric(fixtureNoValidate, brokenYaml, artifact);
    assert.equal(r.passed, false);
    assert.ok(
      r.failures.some(f => f.check === 'no_dropped_keys'),
      `expected no_dropped_keys failure but got ${JSON.stringify(r.failures, null, 2)}`,
    );
  });
});
