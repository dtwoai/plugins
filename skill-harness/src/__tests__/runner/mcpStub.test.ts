import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { handleRequest, TOOLS } from '../../runner/mcpStub.js';
import {
  createStubConfig,
  extractCapturedYaml,
  hasSaveCall,
  MCP_STUB_PATH,
  readCaptures,
} from '../../runner/mcpStubLauncher.js';

const HERE = dirname(fileURLToPath(import.meta.url));

// -----------------------------------------------------------------------
// Unit tests — `handleRequest` directly, no subprocess.
// -----------------------------------------------------------------------

describe('mcpStub.handleRequest', () => {
  it('responds to initialize with server info and capabilities', () => {
    const res = handleRequest({ jsonrpc: '2.0', id: 1, method: 'initialize' }, undefined);
    assert.ok(res);
    assert.equal(res?.id, 1);
    const result = res?.result as { protocolVersion: string; serverInfo: { name: string } };
    assert.ok(result.protocolVersion);
    assert.equal(result.serverInfo.name, 'skill-harness-dtwo-stub');
  });

  it('tools/list returns all 12 dtwo-* tools', () => {
    const res = handleRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, undefined);
    const result = res?.result as { tools: Array<{ name: string }> };
    assert.equal(result.tools.length, 12);
    const names = result.tools.map(t => t.name);
    for (const expected of [
      'dtwo-list-gateways',
      'dtwo-get-gateway',
      'dtwo-update-gateway',
      'dtwo-get-gateway-config',
      'dtwo-get-gateway-versions',
      'dtwo-validate-gateway-config',
      'dtwo-save-gateway-draft-config',
      'dtwo-publish-gateway-config',
      'dtwo-revert-gateway-config',
      'dtwo-deploy-gateway',
      'dtwo-get-gateway-deployments',
      'dtwo-get-deployment',
    ]) {
      assert.ok(names.includes(expected), `missing tool: ${expected}`);
    }
  });

  it('tools/call returns canned list for dtwo-list-gateways', () => {
    const res = handleRequest(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'dtwo-list-gateways', arguments: {} },
      },
      undefined,
    );
    const result = res?.result as { content: Array<{ type: string; text: string }> };
    const data = JSON.parse(result.content[0].text);
    assert.ok(Array.isArray(data));
    assert.equal(data[0].uid, 'bench-gw-1');
  });

  it('tools/call on unknown tool returns isError=true result', () => {
    const res = handleRequest(
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'dtwo-nope', arguments: {} },
      },
      undefined,
    );
    const result = res?.result as { isError?: boolean };
    assert.equal(result.isError, true);
  });

  it('unknown method returns -32601', () => {
    const res = handleRequest({ jsonrpc: '2.0', id: 5, method: 'resources/list' }, undefined);
    assert.equal(res?.error?.code, -32601);
  });

  it('notifications (no id) produce no reply', () => {
    const res = handleRequest({ jsonrpc: '2.0', method: 'notifications/initialized' }, undefined);
    assert.equal(res, null);
  });
});

// -----------------------------------------------------------------------
// Capture behavior — still in-process, verifying that a tools/call with
// SKILL_HARNESS_CAPTURE_PATH writes a JSONL line we can read back.
// -----------------------------------------------------------------------

describe('mcpStub capture file', () => {
  let tmpDir: string;
  let capturePath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mcpstub-capture-'));
    capturePath = join(tmpDir, 'captures.jsonl');
    writeFileSync(capturePath, '', 'utf8');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('records a tools/call for dtwo-validate-gateway-config', () => {
    const yamlPayload = 'gateway:\n  authentication:\n    enabled: true\n';
    handleRequest(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'dtwo-validate-gateway-config',
          arguments: { uid: 'bench-gw-1', yaml: yamlPayload },
        },
      },
      capturePath,
    );
    const captures = readCaptures(capturePath);
    assert.equal(captures.length, 1);
    assert.equal(captures[0].tool, 'dtwo-validate-gateway-config');
    assert.equal(captures[0].params.yaml, yamlPayload);
    assert.ok(typeof captures[0].timestamp === 'string');
  });

  it('captures non-capture tools too (full sequence is useful)', () => {
    handleRequest(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'dtwo-list-gateways', arguments: {} },
      },
      capturePath,
    );
    const captures = readCaptures(capturePath);
    assert.equal(captures.length, 1);
    assert.equal(captures[0].tool, 'dtwo-list-gateways');
  });

  it('produces one JSONL line per call, parseable', () => {
    for (let i = 0; i < 3; i++) {
      handleRequest(
        {
          jsonrpc: '2.0',
          id: i,
          method: 'tools/call',
          params: { name: 'dtwo-list-gateways', arguments: { tag: String(i) } },
        },
        capturePath,
      );
    }
    const raw = readFileSync(capturePath, 'utf8');
    const lines = raw.trim().split('\n');
    assert.equal(lines.length, 3);
    for (const line of lines) {
      assert.doesNotThrow(() => JSON.parse(line));
    }
  });
});

// -----------------------------------------------------------------------
// End-to-end — spawn the real stub as a subprocess, speak JSON-RPC on
// stdio. Keeps the test small (initialize → list → call).
// -----------------------------------------------------------------------

type JsonRpcResponse = {
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
};

function spawnStub(capturePath: string): {
  send: (msg: object) => Promise<JsonRpcResponse>;
  close: () => Promise<void>;
} {
  // Resolve tsx via the package's own node_modules so the subprocess
  // picks up the same binary the workspace uses. `HERE` points at
  // `…/src/__tests__/runner/` — walk up four levels to the package
  // root, then into `node_modules/.bin/tsx`.
  const tsxBin = resolve(HERE, '../../../node_modules/.bin/tsx');
  const child = spawn(tsxBin, [MCP_STUB_PATH], {
    env: { ...process.env, SKILL_HARNESS_CAPTURE_PATH: capturePath },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const rl = createInterface({ input: child.stdout });
  const inbox: JsonRpcResponse[] = [];
  const pending: Array<(r: JsonRpcResponse) => void> = [];

  rl.on('line', line => {
    if (!line.trim()) return;
    try {
      const parsed = JSON.parse(line) as JsonRpcResponse;
      const waiter = pending.shift();
      if (waiter) waiter(parsed);
      else inbox.push(parsed);
    } catch {
      // ignore malformed
    }
  });

  child.stderr.on('data', () => {
    // Silence stderr noise; tsx prints typechecks etc.
  });

  return {
    send(msg: object): Promise<JsonRpcResponse> {
      return new Promise<JsonRpcResponse>(resolveReply => {
        const existing = inbox.shift();
        if (existing) {
          resolveReply(existing);
          return;
        }
        pending.push(resolveReply);
        child.stdin.write(`${JSON.stringify(msg)}\n`);
      });
    },
    close(): Promise<void> {
      return new Promise<void>(resolveClose => {
        child.on('close', () => resolveClose());
        child.stdin.end();
      });
    },
  };
}

describe('mcpStub stdio subprocess', () => {
  it('round-trips initialize → tools/list → tools/call', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'mcpstub-sub-'));
    const capturePath = join(tmpDir, 'captures.jsonl');
    writeFileSync(capturePath, '', 'utf8');
    const stub = spawnStub(capturePath);
    try {
      const init = await stub.send({ jsonrpc: '2.0', id: 1, method: 'initialize' });
      const initResult = init.result as { serverInfo: { name: string } };
      assert.equal(initResult.serverInfo.name, 'skill-harness-dtwo-stub');

      const list = await stub.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
      const listResult = list.result as { tools: Array<{ name: string }> };
      assert.equal(listResult.tools.length, 12);

      const call = await stub.send({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'dtwo-save-gateway-draft-config',
          arguments: { uid: 'bench-gw-1', yaml: 'gateway:\n  authentication:\n    enabled: true\n' },
        },
      });
      const callResult = call.result as { content: Array<{ text: string }> };
      const data = JSON.parse(callResult.content[0].text);
      assert.equal(data.ok, true);

      // Give the stub a tick to flush the capture file before we read.
      await stub.close();
      const captures = readCaptures(capturePath);
      assert.equal(captures.length, 1);
      assert.equal(captures[0].tool, 'dtwo-save-gateway-draft-config');
      assert.ok(typeof captures[0].params.yaml === 'string');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// -----------------------------------------------------------------------
// Launcher helpers (createStubConfig, extractCapturedYaml, hasSaveCall).
// -----------------------------------------------------------------------

describe('mcpStubLauncher', () => {
  it('createStubConfig produces a JSON blob pointing at mcpStub.ts', () => {
    const cfg = createStubConfig({ capturePath: '/tmp/x.jsonl' });
    assert.ok(cfg.mcpServers.dtwo);
    assert.equal(cfg.mcpServers.dtwo.args[0], MCP_STUB_PATH);
    assert.equal(cfg.mcpServers.dtwo.env?.SKILL_HARNESS_CAPTURE_PATH, '/tmp/x.jsonl');
  });

  it('extractCapturedYaml prefers the last save over the last validate', () => {
    const captures = [
      {
        timestamp: 't0',
        tool: 'dtwo-validate-gateway-config',
        params: { yaml: 'first: validate' },
      },
      {
        timestamp: 't1',
        tool: 'dtwo-save-gateway-draft-config',
        params: { yaml: 'the: save' },
      },
      {
        timestamp: 't2',
        tool: 'dtwo-validate-gateway-config',
        params: { yaml: 'post: save validate' },
      },
    ];
    assert.equal(extractCapturedYaml(captures), 'the: save');
  });

  it('extractCapturedYaml returns the last validate when no save fired', () => {
    const captures = [
      { timestamp: 't0', tool: 'dtwo-validate-gateway-config', params: { yaml: 'one' } },
      { timestamp: 't1', tool: 'dtwo-validate-gateway-config', params: { yaml: 'two' } },
    ];
    assert.equal(extractCapturedYaml(captures), 'two');
  });

  it('extractCapturedYaml accepts `config:` as a synonym for `yaml:`', () => {
    const captures = [
      { timestamp: 't0', tool: 'dtwo-save-gateway-draft-config', params: { config: 'via-config-key' } },
    ];
    assert.equal(extractCapturedYaml(captures), 'via-config-key');
  });

  it('extractCapturedYaml returns null when no capture tool fired', () => {
    assert.equal(extractCapturedYaml([]), null);
    assert.equal(extractCapturedYaml([{ timestamp: 't', tool: 'dtwo-list-gateways', params: {} }]), null);
  });

  it('hasSaveCall detects a successful save', () => {
    assert.equal(
      hasSaveCall([{ timestamp: 't', tool: 'dtwo-save-gateway-draft-config', params: { yaml: 'x' } }]),
      true,
    );
    assert.equal(hasSaveCall([{ timestamp: 't', tool: 'dtwo-list-gateways', params: {} }]), false);
  });

  it('readCaptures tolerates a missing file', () => {
    assert.deepEqual(readCaptures('/nonexistent/path.jsonl'), []);
  });

  it('TOOLS exports exactly 12 entries', () => {
    assert.equal(TOOLS.length, 12);
  });
});
