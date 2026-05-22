import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';
import { afterEach, describe, it } from 'node:test';
import {
  __TEST_ONLY__spawnImpl,
  createCliClient,
  type SpawnLike,
  type SpawnOptionsLike,
} from '../../runner/cliClient.js';
import type { SystemBlock } from '../../runner/systemPrompt.js';

type Script = {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
};

type SpawnCall = {
  command: string;
  args: string[];
  options: SpawnOptionsLike;
};

function fakeSpawnFactory(script: Script): { impl: SpawnLike; calls: SpawnCall[] } {
  const calls: SpawnCall[] = [];
  const impl: SpawnLike = (command, args, options) => {
    calls.push({ command, args: Array.from(args), options });
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
      kill: (signal?: NodeJS.Signals) => boolean;
    };
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    child.stdout = stdout;
    child.stderr = stderr;
    child.kill = () => true;
    // Fire streams + close asynchronously to mimic a real child.
    setImmediate(() => {
      if (script.stdout !== undefined) stdout.write(script.stdout);
      if (script.stderr !== undefined) stderr.write(script.stderr);
      stdout.end();
      stderr.end();
      setImmediate(() => {
        child.emit('close', script.exitCode ?? 0, null);
      });
    });
    return child as unknown as ReturnType<SpawnLike>;
  };
  return { impl, calls };
}

const originalSpawn = __TEST_ONLY__spawnImpl.impl;
afterEach(() => {
  __TEST_ONLY__spawnImpl.impl = originalSpawn;
});

const SYSTEM: SystemBlock[] = [
  { type: 'text', text: 'block-one' },
  { type: 'text', text: 'block-two' },
];

describe('createCliClient', () => {
  it('returns { content } from parsed JSON result on exit 0', async () => {
    const { impl, calls } = fakeSpawnFactory({
      stdout: JSON.stringify({ result: 'the answer', session_id: 'abc' }),
      exitCode: 0,
    });
    __TEST_ONLY__spawnImpl.impl = impl;
    const client = createCliClient();
    const out = await client.messages({
      model: 'claude-sonnet-4-6',
      system: SYSTEM,
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.2,
      max_tokens: 4096,
    });
    assert.equal(out.content, 'the answer');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, 'claude');
    assert.ok(calls[0].args.includes('-p'));
    assert.ok(calls[0].args.includes('--output-format'));
    assert.ok(calls[0].args.includes('json'));
    assert.ok(calls[0].args.includes('--model'));
    assert.ok(calls[0].args.includes('claude-sonnet-4-6'));
  });

  it('passes --mcp-config <path> and --strict-mcp-config', async () => {
    const { impl, calls } = fakeSpawnFactory({
      stdout: JSON.stringify({ result: 'x' }),
      exitCode: 0,
    });
    __TEST_ONLY__spawnImpl.impl = impl;
    const client = createCliClient();
    await client.messages({
      model: 'm',
      system: SYSTEM,
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.2,
      max_tokens: 4096,
    });
    const args = calls[0].args;
    const mcpIdx = args.indexOf('--mcp-config');
    assert.ok(mcpIdx >= 0, '--mcp-config must be present');
    const configPath = args[mcpIdx + 1];
    assert.ok(typeof configPath === 'string' && configPath.length > 0, '--mcp-config must have a path value');
    assert.ok(args.includes('--strict-mcp-config'), '--strict-mcp-config must be present');
  });

  it('returns empty captures array when the stub had no tool calls', async () => {
    const { impl } = fakeSpawnFactory({
      stdout: JSON.stringify({ result: 'x' }),
      exitCode: 0,
    });
    __TEST_ONLY__spawnImpl.impl = impl;
    const client = createCliClient();
    const out = await client.messages({
      model: 'm',
      system: SYSTEM,
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.2,
      max_tokens: 4096,
    });
    assert.ok(Array.isArray(out.captures), 'captures must be an array');
    assert.equal(out.captures?.length, 0);
  });

  it('flattens multi-turn messages with User:/Assistant: labels', async () => {
    const { impl, calls } = fakeSpawnFactory({
      stdout: JSON.stringify({ result: 'ok' }),
      exitCode: 0,
    });
    __TEST_ONLY__spawnImpl.impl = impl;
    const client = createCliClient();
    await client.messages({
      model: 'm',
      system: SYSTEM,
      messages: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'ack' },
        { role: 'user', content: 'second' },
      ],
      temperature: 0.2,
      max_tokens: 4096,
    });
    const pIdx = calls[0].args.indexOf('-p');
    assert.ok(pIdx >= 0);
    const prompt = calls[0].args[pIdx + 1];
    assert.match(prompt, /^User: first\n\nAssistant: ack\n\nUser: second$/);
  });

  it('throws with stderr content on non-zero exit', async () => {
    const { impl } = fakeSpawnFactory({
      stdout: '',
      stderr: 'Not authenticated',
      exitCode: 1,
    });
    __TEST_ONLY__spawnImpl.impl = impl;
    const client = createCliClient();
    await assert.rejects(
      () =>
        client.messages({
          model: 'm',
          system: SYSTEM,
          messages: [{ role: 'user', content: 'hi' }],
          temperature: 0.2,
          max_tokens: 4096,
        }),
      /Not authenticated/,
    );
  });

  it('throws with diagnostic snippet when stdout is not valid JSON', async () => {
    const { impl } = fakeSpawnFactory({
      stdout: 'hello world',
      exitCode: 0,
    });
    __TEST_ONLY__spawnImpl.impl = impl;
    const client = createCliClient();
    await assert.rejects(
      () =>
        client.messages({
          model: 'm',
          system: SYSTEM,
          messages: [{ role: 'user', content: 'hi' }],
          temperature: 0.2,
          max_tokens: 4096,
        }),
      /hello world/,
    );
  });

  it('throws when parsed JSON has no `result` key', async () => {
    const { impl } = fakeSpawnFactory({
      stdout: JSON.stringify({ session_id: 'abc' }),
      exitCode: 0,
    });
    __TEST_ONLY__spawnImpl.impl = impl;
    const client = createCliClient();
    await assert.rejects(
      () =>
        client.messages({
          model: 'm',
          system: SYSTEM,
          messages: [{ role: 'user', content: 'hi' }],
          temperature: 0.2,
          max_tokens: 4096,
        }),
      /no string `result` key/,
    );
  });

  it('adds --bare when bare: true and omits it by default', async () => {
    const bareScript = fakeSpawnFactory({
      stdout: JSON.stringify({ result: 'x' }),
      exitCode: 0,
    });
    __TEST_ONLY__spawnImpl.impl = bareScript.impl;
    const bareClient = createCliClient({ bare: true });
    await bareClient.messages({
      model: 'm',
      system: SYSTEM,
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.2,
      max_tokens: 4096,
    });
    assert.ok(bareScript.calls[0].args.includes('--bare'));

    const normalScript = fakeSpawnFactory({
      stdout: JSON.stringify({ result: 'x' }),
      exitCode: 0,
    });
    __TEST_ONLY__spawnImpl.impl = normalScript.impl;
    const normalClient = createCliClient();
    await normalClient.messages({
      model: 'm',
      system: SYSTEM,
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.2,
      max_tokens: 4096,
    });
    assert.equal(normalScript.calls[0].args.includes('--bare'), false);
  });

  it('defaults cwd to os.tmpdir()', async () => {
    const { impl, calls } = fakeSpawnFactory({
      stdout: JSON.stringify({ result: 'x' }),
      exitCode: 0,
    });
    __TEST_ONLY__spawnImpl.impl = impl;
    const client = createCliClient();
    await client.messages({
      model: 'm',
      system: SYSTEM,
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.2,
      max_tokens: 4096,
    });
    assert.equal(calls[0].options.cwd, tmpdir());
  });

  it('passes --tools and empty string as two separate argv elements', async () => {
    const { impl, calls } = fakeSpawnFactory({
      stdout: JSON.stringify({ result: 'x' }),
      exitCode: 0,
    });
    __TEST_ONLY__spawnImpl.impl = impl;
    const client = createCliClient();
    await client.messages({
      model: 'm',
      system: SYSTEM,
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.2,
      max_tokens: 4096,
    });
    const args = calls[0].args;
    const toolsIdx = args.indexOf('--tools');
    assert.ok(toolsIdx >= 0, '--tools must be present');
    assert.equal(args[toolsIdx + 1], '', 'value after --tools must be exactly empty string');
  });

  it('removes the temporary system-prompt file after the call resolves', async () => {
    let capturedPath: string | undefined;
    const impl: SpawnLike = (command, args, options) => {
      const argList = Array.from(args);
      const idx = argList.indexOf('--append-system-prompt-file');
      capturedPath = idx >= 0 ? argList[idx + 1] : undefined;
      if (capturedPath) {
        // Assert the file exists at the moment the spawn runs — the finally
        // block in cliClient.ts should remove it only after close fires.
        assert.ok(existsSync(capturedPath), 'system prompt file should exist during the call');
      }
      const child = new EventEmitter() as EventEmitter & {
        stdout: PassThrough;
        stderr: PassThrough;
        kill: (signal?: NodeJS.Signals) => boolean;
      };
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = () => true;
      setImmediate(() => {
        child.stdout.write(JSON.stringify({ result: 'x' }));
        child.stdout.end();
        child.stderr.end();
        setImmediate(() => child.emit('close', 0, null));
      });
      void command;
      void options;
      return child as unknown as ReturnType<SpawnLike>;
    };
    __TEST_ONLY__spawnImpl.impl = impl;
    const client = createCliClient();
    await client.messages({
      model: 'm',
      system: SYSTEM,
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.2,
      max_tokens: 4096,
    });
    assert.ok(capturedPath, 'capturedPath must have been set');
    assert.equal(existsSync(capturedPath), false, 'system prompt file should be cleaned up after the call');
  });

  it('forwards temperature via --settings inline JSON', async () => {
    const { impl, calls } = fakeSpawnFactory({
      stdout: JSON.stringify({ result: 'x' }),
      exitCode: 0,
    });
    __TEST_ONLY__spawnImpl.impl = impl;
    const client = createCliClient();
    await client.messages({
      model: 'm',
      system: SYSTEM,
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.25,
      max_tokens: 4096,
    });
    const args = calls[0].args;
    const settingsIdx = args.indexOf('--settings');
    assert.ok(settingsIdx >= 0, '--settings must be present when temperature is set');
    const parsed = JSON.parse(args[settingsIdx + 1]);
    assert.equal(parsed.temperature, 0.25);
    // Still no literal --temperature flag (that doesn't exist in the CLI).
    assert.equal(args.includes('--temperature'), false);
  });

  it('omits --settings when temperature is not finite', async () => {
    const { impl, calls } = fakeSpawnFactory({
      stdout: JSON.stringify({ result: 'x' }),
      exitCode: 0,
    });
    __TEST_ONLY__spawnImpl.impl = impl;
    const client = createCliClient();
    await client.messages({
      model: 'm',
      system: SYSTEM,
      messages: [{ role: 'user', content: 'hi' }],
      temperature: Number.NaN,
      max_tokens: 4096,
    });
    assert.equal(calls[0].args.includes('--settings'), false);
  });

  it('does not include a --temperature flag (no such CLI flag exists)', async () => {
    const { impl, calls } = fakeSpawnFactory({
      stdout: JSON.stringify({ result: 'x' }),
      exitCode: 0,
    });
    __TEST_ONLY__spawnImpl.impl = impl;
    const client = createCliClient();
    await client.messages({
      model: 'm',
      system: SYSTEM,
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.7,
      max_tokens: 4096,
    });
    assert.equal(calls[0].args.includes('--temperature'), false);
  });
});
