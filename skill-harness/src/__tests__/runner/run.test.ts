import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { loadFixtures } from '../../fixtures.js';
import type { Client, MessageParams } from '../../runner/client.js';
import type { CapturedCall } from '../../runner/mcpStub.js';
import { runBench } from '../../runner/run.js';
import { loadSchemaArtifact } from '../../schemaArtifact.js';

const fixtures = loadFixtures();
const bearer = fixtures.find(f => f.id === 'bearer-token-simple');
if (!bearer) throw new Error('bearer-token-simple fixture missing');
const artifact = loadSchemaArtifact();

const BEARER_VALID_YAML = `
\`\`\`yaml
gateway:
  authentication:
    jwks_info:
      jwt_algorithm: RS256
      jwt_jwks_uri: https://acme.us.auth0.com/.well-known/jwks.json
      jwt_issuer: https://acme.us.auth0.com/
      jwt_audience: https://api.acme.com
mcp_servers:
  - name: demo
    url: https://example.com/mcp
    authentication:
      type: bearer
      token: "<REPLACE_ME>"
\`\`\`
`;

function fixedClient(reply: string): Client {
  return {
    async messages(_params: MessageParams) {
      return { content: reply };
    },
  };
}

function captureClient(reply: string, captures: CapturedCall[]): Client {
  return {
    async messages(_params: MessageParams) {
      return { content: reply, captures };
    },
  };
}

const VALID_CAPTURED_YAML = [
  'gateway:',
  '  authentication:',
  '    jwks_info:',
  '      jwt_algorithm: RS256',
  '      jwt_jwks_uri: https://acme.us.auth0.com/.well-known/jwks.json',
  '      jwt_issuer: https://acme.us.auth0.com/',
  '      jwt_audience: https://api.acme.com',
  'mcp_servers:',
  '  - name: demo',
  '    url: https://example.com/mcp',
  '    authentication:',
  '      type: bearer',
  '      token: "<REPLACE_ME>"',
  '',
].join('\n');

describe('runBench end-to-end', () => {
  it('returns passed=true for a well-formed bearer fixture', async () => {
    const results = await runBench({
      fixtures: [bearer],
      artifact,
      skillBundle: '# stub',
      client: fixedClient(BEARER_VALID_YAML),
      model: 'stub-model',
      runsPerRequired: 2,
      runsPerAspirational: 1,
    });
    assert.equal(results.prompts.length, 1);
    const p = results.prompts[0];
    assert.equal(p.id, 'bearer-token-simple');
    assert.equal(p.tier, 'required');
    assert.equal(p.runs.length, 2);
    for (const run of p.runs) {
      assert.equal(run.passed, true, `run failed unexpectedly: ${JSON.stringify(run.failures, null, 2)}`);
    }
    assert.equal(p.passed, true);
    assert.equal(p.samples, 2);
    assert.equal(p.passes, 2);
    assert.equal(p.passAtK, 1);
    assert.equal(p.wilsonUpper, 1);
    assert.ok(p.wilsonLower > 0);
    assert.equal(results.summary.headline > 0, true);
    assert.equal(results.summary.gates.reservedAdvancedViolation, false);
  });

  it('captures a gaveUpAtTurn when the assistant refuses', async () => {
    const results = await runBench({
      fixtures: [bearer],
      artifact,
      skillBundle: '# stub',
      client: fixedClient('I refuse.'),
      model: 'stub-model',
      runsPerRequired: 1,
      runsPerAspirational: 1,
    });
    const run = results.prompts[0].runs[0];
    assert.equal(run.yaml, null);
    assert.equal(run.gaveUpAtTurn, 1);
    assert.equal(run.passed, false);
    assert.ok(run.failures.some(f => f.check === 'runner_no_yaml'));
  });

  it('stamps metadata with default values when none is supplied', async () => {
    const results = await runBench({
      fixtures: [bearer],
      artifact,
      skillBundle: '# stub',
      client: fixedClient(BEARER_VALID_YAML),
      model: 'stub-model',
      runsPerRequired: 1,
      runsPerAspirational: 1,
    });
    // Defaults: temperature=0.2, samples=1, provider='anthropic', seed=null,
    // model falls back to the `model` param.
    assert.equal(results.metadata.temperature, 0.2);
    assert.equal(results.metadata.samples, 1);
    assert.equal(results.metadata.provider, 'anthropic');
    assert.equal(results.metadata.seed, null);
    assert.equal(results.metadata.model, 'stub-model');
  });

  it('prefers captured YAML over text-extracted YAML', async () => {
    // Assistant text contains well-formed YAML, but its audience is wrong
    // (jwt_audience is a placeholder). The captured YAML is correct. The
    // runner should grade on captured YAML — so the fixture passes.
    const badTextYaml = `
\`\`\`yaml
gateway:
  authentication:
    jwks_info:
      jwt_algorithm: RS256
      jwt_jwks_uri: https://acme.us.auth0.com/.well-known/jwks.json
      jwt_issuer: https://acme.us.auth0.com/
      jwt_audience: WRONG
mcp_servers:
  - name: demo
    url: https://example.com/mcp
    authentication:
      type: bearer
      token: "<REPLACE_ME>"
\`\`\`
`;
    const captures: CapturedCall[] = [
      {
        timestamp: '2026-04-22T00:00:00Z',
        tool: 'dtwo-save-gateway-draft-config',
        params: { uid: 'bench-gw-1', yaml: VALID_CAPTURED_YAML },
      },
    ];
    const results = await runBench({
      fixtures: [bearer],
      artifact,
      skillBundle: '# stub',
      client: captureClient(badTextYaml, captures),
      model: 'stub-model',
      runsPerRequired: 1,
      runsPerAspirational: 1,
    });
    const run = results.prompts[0].runs[0];
    assert.equal(run.yaml, VALID_CAPTURED_YAML);
    assert.equal(run.passed, true, `run failed: ${JSON.stringify(run.failures, null, 2)}`);
  });

  it('suppresses gaveUpAtTurn when a successful save call occurred', async () => {
    // Assistant message is non-YAML prose that would normally be treated
    // as "gave up". But the skill hit dtwo-save-gateway-draft-config, so
    // we have a YAML artifact and should not register the give-up.
    const captures: CapturedCall[] = [
      {
        timestamp: '2026-04-22T00:00:00Z',
        tool: 'dtwo-save-gateway-draft-config',
        params: { uid: 'bench-gw-1', yaml: VALID_CAPTURED_YAML },
      },
    ];
    const results = await runBench({
      fixtures: [bearer],
      artifact,
      skillBundle: '# stub',
      client: captureClient('All done — saved your draft.', captures),
      model: 'stub-model',
      runsPerRequired: 1,
      runsPerAspirational: 1,
    });
    const run = results.prompts[0].runs[0];
    assert.equal(run.gaveUpAtTurn, undefined);
    assert.equal(run.yaml, VALID_CAPTURED_YAML);
    assert.equal(run.passed, true, `run failed: ${JSON.stringify(run.failures, null, 2)}`);
  });

  it('propagates caller-supplied metadata into the report', async () => {
    const results = await runBench({
      fixtures: [bearer],
      artifact,
      skillBundle: '# stub',
      client: fixedClient(BEARER_VALID_YAML),
      model: 'stub-model',
      runsPerRequired: 3,
      runsPerAspirational: 1,
      temperature: 0.7,
      metadata: {
        temperature: 0.7,
        samples: 3,
        model: 'stub-model',
        provider: 'claude-cli',
        seed: null,
      },
    });
    assert.equal(results.metadata.samples, 3);
    assert.equal(results.metadata.provider, 'claude-cli');
    assert.equal(results.metadata.temperature, 0.7);
    // Per-fixture sampling fields must match what the aggregate saw.
    const p = results.prompts[0];
    assert.equal(p.samples, 3);
    assert.equal(p.passes, 3);
    assert.equal(p.passAtK, 1);
  });
});
