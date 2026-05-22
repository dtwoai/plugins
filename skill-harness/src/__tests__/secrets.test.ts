import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { loadSchemaArtifact } from '../schemaArtifact.js';
import { collectSecretPaths, findSecretViolations, SECRET_PLACEHOLDER_REGEX } from '../secrets.js';

const artifact = loadSchemaArtifact();
const secretPaths = collectSecretPaths(artifact);

describe('secrets', () => {
  it('includes the known secret leaves across variants', () => {
    // basic.password
    assert.ok(secretPaths.has('mcp_servers[].authentication.password'));
    // query_param.param_value
    assert.ok(secretPaths.has('mcp_servers[].authentication.param_value'));
    // bearer.token
    assert.ok(secretPaths.has('mcp_servers[].authentication.token'));
    // oauth.client_secret
    assert.ok(secretPaths.has('mcp_servers[].authentication.client_secret'));
    // authheaders.headers[].value (issue #754 — patched to `secret: true`)
    assert.ok(secretPaths.has('mcp_servers[].authentication.headers[].value'));
  });

  it('accepts <REPLACE_*> placeholder', () => {
    const parsed = {
      mcp_servers: [{ authentication: { type: 'bearer', token: '<REPLACE_WITH_TOKEN>' } }],
    };
    assert.deepEqual(findSecretViolations(parsed, secretPaths), []);
  });

  // biome-ignore lint/suspicious/noTemplateCurlyInString: literal placeholder token under test
  it('accepts ${ENV} placeholder', () => {
    const parsed = {
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal placeholder token under test
      mcp_servers: [{ authentication: { type: 'bearer', token: '${GITHUB_TOKEN}' } }],
    };
    assert.deepEqual(findSecretViolations(parsed, secretPaths), []);
  });

  it('accepts CHANGE_ME placeholder', () => {
    const parsed = {
      mcp_servers: [{ authentication: { type: 'bearer', token: 'CHANGE_ME' } }],
    };
    assert.deepEqual(findSecretViolations(parsed, secretPaths), []);
  });

  it('rejects a real-looking token string', () => {
    const parsed = {
      mcp_servers: [{ authentication: { type: 'bearer', token: 'abc123' } }],
    };
    const v = findSecretViolations(parsed, secretPaths);
    assert.equal(v.length, 1);
    assert.equal(v[0].path, 'mcp_servers[].authentication.token');
  });

  it('accepts absent secret fields', () => {
    const parsed = {
      mcp_servers: [{ authentication: { type: 'oauth', grant_type: 'authorization_code' } }],
    };
    assert.deepEqual(findSecretViolations(parsed, secretPaths), []);
  });

  it('does not descend into extra_authorize_params record children', () => {
    // Synthesize a parsed object with a (fake) `secret: true` path that
    // sits under a PRESERVE_CHILD_KEYS leaf. If the walker descended into
    // `extra_authorize_params`, it would match the synthesized path and
    // flag a violation; the boundary logic must stop it.
    const syntheticSecretPaths = new Set<string>(['mcp_servers[].authentication.extra_authorize_params.token']);
    const parsed = {
      mcp_servers: [
        {
          authentication: {
            type: 'oauth',
            extra_authorize_params: {
              // Non-placeholder string — would violate if the walker
              // descended past the record leaf.
              token: 'abc123-real-looking-value',
            },
          },
        },
      ],
    };
    assert.deepEqual(findSecretViolations(parsed, syntheticSecretPaths), []);
  });

  it('exports a placeholder regex matching the accepted conventions', () => {
    // Bracketed and bare REPLACE_… (bare form added after a live Tier-2
    // run showed the skill naturally emits `REPLACE_WITH_…` without
    // brackets — that's still a valid placeholder, not a leaked secret).
    assert.ok(SECRET_PLACEHOLDER_REGEX.test('<REPLACE_ME>'));
    assert.ok(SECRET_PLACEHOLDER_REGEX.test('REPLACE_ME'));
    assert.ok(SECRET_PLACEHOLDER_REGEX.test('REPLACE_WITH_YOUR_BEARER_TOKEN'));
    // PLACEHOLDER_… also accepted, bracketed or bare.
    assert.ok(SECRET_PLACEHOLDER_REGEX.test('<PLACEHOLDER_TOKEN>'));
    assert.ok(SECRET_PLACEHOLDER_REGEX.test('PLACEHOLDER_TOKEN'));
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal placeholder token under test
    assert.ok(SECRET_PLACEHOLDER_REGEX.test('${FOO}'));
    assert.ok(SECRET_PLACEHOLDER_REGEX.test('CHANGE_ME'));
    assert.ok(SECRET_PLACEHOLDER_REGEX.test('changeme'));
    // YOUR_… / your-… placeholder shapes (Tier-2 bench showed the skill
    // naturally emits all five of these; they're conventional and should
    // be accepted just like REPLACE_ / PLACEHOLDER_).
    assert.ok(SECRET_PLACEHOLDER_REGEX.test('<YOUR_CLIENT_SECRET>'));
    assert.ok(SECRET_PLACEHOLDER_REGEX.test('YOUR_BEARER_TOKEN'));
    assert.ok(SECRET_PLACEHOLDER_REGEX.test('<your-bearer-token>'));
    assert.ok(SECRET_PLACEHOLDER_REGEX.test('your-bearer-token'));
    assert.ok(SECRET_PLACEHOLDER_REGEX.test('<your-instance>'));
    // Rejected: literal-looking credentials.
    assert.ok(!SECRET_PLACEHOLDER_REGEX.test('abc123'));
    assert.ok(!SECRET_PLACEHOLDER_REGEX.test('ghp_16C7e42F292c6912E7710c838347Ae178B4a'));
    // Rejected: `REPLACE` as a suffix, not a prefix — avoids matching
    // arbitrary tokens that happen to contain the word.
    assert.ok(!SECRET_PLACEHOLDER_REGEX.test('my-REPLACE_token'));
    // Rejected: scheme prefixed onto a placeholder — we want the skill
    // to write just the placeholder in the value, not `Bearer <X>`.
    assert.ok(!SECRET_PLACEHOLDER_REGEX.test('Bearer GITHUB_PAT_PLACEHOLDER'));
    assert.ok(!SECRET_PLACEHOLDER_REGEX.test('Bearer YOUR_TOKEN'));
    // Rejected: random high-entropy string with no placeholder prefix.
    assert.ok(!SECRET_PLACEHOLDER_REGEX.test('a9Xk2mQ8pLr'));
    // Rejected: JWT-like base64 payload.
    assert.ok(!SECRET_PLACEHOLDER_REGEX.test('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMifQ.abc'));
  });

  it('accepts bare REPLACE_* and PLACEHOLDER_* placeholders', () => {
    const parsed = {
      mcp_servers: [{ authentication: { type: 'bearer', token: 'REPLACE_WITH_YOUR_BEARER_TOKEN' } }],
    };
    assert.deepEqual(findSecretViolations(parsed, secretPaths), []);

    const parsed2 = {
      mcp_servers: [{ authentication: { type: 'bearer', token: 'PLACEHOLDER_TOKEN' } }],
    };
    assert.deepEqual(findSecretViolations(parsed2, secretPaths), []);
  });

  it('accepts YOUR_* / your-* placeholder shapes from Tier-2 bench', () => {
    // `<YOUR_CLIENT_SECRET>` — angle-bracketed uppercase snake.
    const parsed1 = {
      mcp_servers: [{ authentication: { type: 'oauth', client_secret: '<YOUR_CLIENT_SECRET>' } }],
    };
    assert.deepEqual(findSecretViolations(parsed1, secretPaths), []);

    // `YOUR_BEARER_TOKEN` — bare uppercase.
    const parsed2 = {
      mcp_servers: [{ authentication: { type: 'bearer', token: 'YOUR_BEARER_TOKEN' } }],
    };
    assert.deepEqual(findSecretViolations(parsed2, secretPaths), []);

    // `<your-bearer-token>` — bracketed lowercase kebab.
    const parsed3 = {
      mcp_servers: [{ authentication: { type: 'bearer', token: '<your-bearer-token>' } }],
    };
    assert.deepEqual(findSecretViolations(parsed3, secretPaths), []);

    // `your-bearer-token` — bare lowercase kebab.
    const parsed4 = {
      mcp_servers: [{ authentication: { type: 'bearer', token: 'your-bearer-token' } }],
    };
    assert.deepEqual(findSecretViolations(parsed4, secretPaths), []);

    // `<your-instance>` — bracketed lowercase kebab, different noun.
    const parsed5 = {
      mcp_servers: [{ authentication: { type: 'bearer', token: '<your-instance>' } }],
    };
    assert.deepEqual(findSecretViolations(parsed5, secretPaths), []);
  });
});
