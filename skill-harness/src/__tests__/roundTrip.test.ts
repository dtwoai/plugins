import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { roundTripDiff } from '../roundTrip.js';

describe('roundTripDiff', () => {
  it('surfaces parseError on a typo sibling key (schema catches it before missingPaths)', () => {
    // Typo'd sibling keys like `authentic_tion` were previously silently
    // dropped by `parseConfig` and surfaced only via missingPaths. The
    // schema tightened in #883 to reject unrecognized keys outright, so
    // the typo now produces a parseError before round-trip diff runs.
    // Behavior is strictly stronger; the test pins the new contract so
    // a future loosening of the schema would re-expose the missingPaths
    // path and catch the regression.
    const yaml = `
gateway:
  authentication:
    enabled: true
  authentic_tion:
    enabled: true
`;
    const r = roundTripDiff(yaml);
    assert.ok(r.parseError, 'expected parseError for unrecognized sibling key');
    assert.match(r.parseError ?? '', /authentic_tion/i);
  });

  it('round-trips a valid config cleanly', () => {
    const yaml = `
gateway:
  authentication:
    enabled: true
    jwks_info:
      jwt_algorithm: RS256
      jwt_jwks_uri: https://example.us.auth0.com/.well-known/jwks.json
      jwt_issuer: https://example.us.auth0.com/
      jwt_audience: https://api.example.com/
mcp_servers:
  - name: context-server
    url: http://localhost:8080/sse
`;
    const r = roundTripDiff(yaml);
    assert.equal(r.parseError, undefined, r.parseError);
    assert.deepEqual(r.missingPaths, []);
  });

  it('does not flag extra_authorize_params children as missing', () => {
    const yaml = `
mcp_servers:
  - name: atlassian
    url: https://example.com/mcp
    authentication:
      type: oauth
      grant_type: authorization_code
      issuer: https://example.com
      scopes: [read]
      extra_authorize_params:
        Audience: keep-case
        other_param: value
`;
    const r = roundTripDiff(yaml);
    assert.equal(r.parseError, undefined, r.parseError);
    // No child of the record leaf should appear in missingPaths — the
    // walker stops at the leaf on both sides.
    for (const p of r.missingPaths) {
      assert.ok(!p.startsWith('mcp_servers[].authentication.extra_authorize_params.'));
    }
  });

  it('surfaces parseError instead of throwing on schema failure', () => {
    // No `url` -> McpServerSchema rejects -> parseError returned, not thrown.
    const yaml = `
mcp_servers:
  - name: no-url-allowed
    authentication:
      type: bearer
      token: "<REPLACE_ME>"
`;
    const r = roundTripDiff(yaml);
    assert.ok(r.parseError, 'expected parseError for schema violation');
  });
});
