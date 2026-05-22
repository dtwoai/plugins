import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import yaml from 'js-yaml';

import { findHallucinations, walkYamlPaths } from '../hallucination.js';
import { buildAllowedPathSet } from '../paths.js';
import { loadSchemaArtifact } from '../schemaArtifact.js';

const artifact = loadSchemaArtifact();
const allowed = buildAllowedPathSet(artifact);

function loadDoc(text: string): unknown {
  return yaml.load(text);
}

describe('hallucination walker', () => {
  it('flags a fabricated top-level field', () => {
    const doc = loadDoc(`
gateway:
  bogus_field: true
`);
    const hits = findHallucinations(doc, allowed);
    assert.ok(hits.includes('gateway.bogus_field'));
  });

  it('accepts extra_authorize_params children without flagging them (record-leaf)', () => {
    const doc = loadDoc(`
mcp_servers:
  - name: atlassian
    url: https://example.com/mcp
    authentication:
      type: oauth
      grant_type: authorization_code
      issuer: https://example.com
      scopes: [read]
      extra_authorize_params:
        audience: foo
        custom_param: bar
`);
    // The LEAF is allowed; children do NOT recurse and therefore don't
    // surface as hallucinations.
    const hits = findHallucinations(doc, allowed);
    for (const h of hits) {
      assert.ok(
        !h.startsWith('mcp_servers[].authentication.extra_authorize_params.'),
        `walker should stop at record leaf but saw ${h}`,
      );
    }
  });

  it('preserves case inside extra_authorize_params subtrees', () => {
    const doc = loadDoc(`
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
`);
    const paths = walkYamlPaths(doc);
    assert.ok(paths.has('mcp_servers[].authentication.extra_authorize_params'));
    // The walker must not recurse into the map body — case-sensitive
    // child keys would otherwise leak out as lowercase via the outer
    // normalizer. Verify nothing deeper leaked.
    for (const p of paths) {
      assert.ok(!p.startsWith('mcp_servers[].authentication.extra_authorize_params.'));
    }
  });

  it('matches mixed-case keys against the lowercase allowed set', () => {
    const doc = loadDoc(`
Gateway:
  Authentication:
    Enabled: true
`);
    const hits = findHallucinations(doc, allowed);
    assert.deepEqual(hits, []);
  });

  it('flags an invalid record-child key via parseConfig (delegated)', () => {
    // `findHallucinations` does not walk into record leaves, so a
    // pathologically-named child key is NOT flagged here. Instead it's
    // caught by parseConfig in the rubric's `must_validate` step. This
    // test documents the split-responsibility contract by asserting that
    // the walker itself stays quiet on bad record-child keys.
    const doc = loadDoc(`
mcp_servers:
  - name: atlassian
    url: https://example.com/mcp
    authentication:
      type: oauth
      grant_type: authorization_code
      issuer: https://example.com
      scopes: [read]
      extra_authorize_params:
        "has space": foo
`);
    const hits = findHallucinations(doc, allowed);
    // The walker is not the validator for record-leaf child keys; see
    // rubric.test.ts for the parseConfig-side assertion.
    for (const h of hits) {
      assert.ok(!h.startsWith('mcp_servers[].authentication.extra_authorize_params.'));
    }
  });
});
