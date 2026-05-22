/**
 * `claude -p` CLI-backed client.
 *
 * Alternative to `createAnthropicClient` that shells out to the user's
 * locally installed Claude Code CLI binary. This lets a bench run reuse
 * the user's existing OAuth login instead of requiring a separate
 * `ANTHROPIC_API_KEY`.
 *
 * Trade-offs vs the SDK path:
 *   - **`temperature` is forwarded via `--settings '{"temperature":N}'`.**
 *     The CLI has no `--temperature` flag, but `--settings` accepts a
 *     JSON blob inline, and `temperature` is a recognized key. `max_tokens`
 *     has no equivalent settings key and is still silently ignored.
 *   - **Skills/MCP auto-load risk.** `claude -p` auto-loads skills and
 *     MCP servers from `$CWD/.claude/` and `~/.claude/`. We mitigate by
 *     (a) defaulting `cwd` to `os.tmpdir()` so the project tree's
 *     `.claude/skills/` isn't picked up, and (b) passing `--tools ""` to
 *     suppress built-in tools. We do NOT pass `--bare`, which would
 *     stop skills/MCP/hooks but also refuse OAuth login.
 *   - **Prompt caching is opaque.** The CLI caches automatically, but
 *     `--output-format json` doesn't expose per-block cache telemetry.
 *   - **Auth precedence** matches `claude -p`: `ANTHROPIC_API_KEY` wins
 *     if set; otherwise OAuth applies in non-bare mode.
 */

import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Client, MessageParams } from './client.js';
import type { CapturedCall } from './mcpStub.js';
import { createStubConfig, readCaptures } from './mcpStubLauncher.js';

export type CliClientOptions = {
  /** Path or name of the `claude` binary. Defaults to `'claude'` (resolved via PATH). */
  claudeBinary?: string;
  /** Model ID passed to --model. Defaults to whatever `Client.messages` gets. */
  defaultModel?: string;
  /** Working directory for the spawned process. Defaults to `os.tmpdir()` to avoid auto-loading project-level skills/MCP. */
  cwd?: string;
  /** When true, adds --bare (disables skills/MCP/hooks but requires ANTHROPIC_API_KEY). Defaults to false. */
  bare?: boolean;
  /** Timeout in ms for the spawned `claude -p` call. Defaults to 120000. */
  timeoutMs?: number;
};

/**
 * Shape of the test-injection seam: a function matching `child_process.spawn`'s
 * signature that we use to produce a `ChildProcess`-like object. Tests can
 * assign to `__TEST_ONLY__spawnImpl` to intercept spawns without actually
 * invoking `claude`.
 */
export type SpawnLike = (command: string, args: readonly string[], options: SpawnOptionsLike) => ChildProcess;

export type SpawnOptionsLike = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

/**
 * Test-only hook. Default impl wraps `node:child_process.spawn`. Tests set
 * this to a stub that emits scripted stdout/stderr/exit. We intentionally
 * export a mutable holder (not a bare reference) so mutation is visible
 * across module loads in ESM.
 */
export const __TEST_ONLY__spawnImpl: { impl: SpawnLike } = {
  impl: (command, args, options) =>
    spawn(command, Array.from(args), {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
};

// 180s accommodates fixtures where the skill makes several MCP tool
// round-trips (list → get → validate* → save → deploy). The earlier
// 120s ceiling was tight enough that genuine tool-loop completions
// sometimes clipped — not a skill hang, just a slower loop on a
// contended machine.
const DEFAULT_TIMEOUT_MS = 180_000;
const SIGKILL_GRACE_MS = 5_000;

function flattenSystem(system: MessageParams['system']): string {
  return system.map(b => b.text).join('\n\n---\n\n');
}

function flattenMessages(messages: MessageParams['messages']): string {
  if (messages.length === 0) {
    throw new Error('createCliClient: messages array is empty; nothing to send.');
  }
  for (const m of messages) {
    if (typeof m.content !== 'string') {
      throw new Error(`createCliClient: message content must be a string (role=${m.role}).`);
    }
  }
  const last = messages[messages.length - 1];
  if (last.role !== 'user') {
    throw new Error(`createCliClient: last message must have role=user (got ${last.role}).`);
  }
  if (messages.length === 1) {
    return messages[0].content.trimEnd();
  }
  const lines: string[] = [];
  for (const m of messages) {
    const label = m.role === 'user' ? 'User' : 'Assistant';
    lines.push(`${label}: ${m.content}`);
  }
  return lines.join('\n\n').trimEnd();
}

function writeSystemPromptFile(systemText: string): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'claude-cli-system-'));
  const suffix = randomBytes(6).toString('hex');
  const path = join(dir, `system-${suffix}.txt`);
  writeFileSync(path, systemText, { encoding: 'utf8' });
  const cleanup = () => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // tmp is best-effort; swallow.
    }
  };
  return { path, cleanup };
}

/**
 * Allocate the two temp files that back an MCP-enabled run:
 *
 *   - `configPath`  — a JSON blob the CLI reads via `--mcp-config`.
 *   - `capturePath` — a JSONL file the stub server writes on every
 *                     `tools/call`. We touch it to an empty file so the
 *                     stub can `appendFileSync` without creating it
 *                     itself (simpler error semantics).
 *
 * Both live under a single tmp dir so cleanup removes them together.
 */
function writeMcpConfigFiles(): { configPath: string; capturePath: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'claude-cli-mcp-'));
  const suffix = randomBytes(6).toString('hex');
  const configPath = join(dir, `mcp-config-${suffix}.json`);
  const capturePath = join(dir, `captures-${suffix}.jsonl`);
  const config = createStubConfig({ capturePath });
  writeFileSync(configPath, JSON.stringify(config), { encoding: 'utf8' });
  // Touch the capture file to ensure it exists before the child writes.
  writeFileSync(capturePath, '', { encoding: 'utf8' });
  const cleanup = () => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  };
  return { configPath, capturePath, cleanup };
}

type SpawnOutcome = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

function runSpawn(
  binary: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<SpawnOutcome> {
  return new Promise(resolve => {
    const child = __TEST_ONLY__spawnImpl.impl(binary, args, { cwd, env });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });

    const softTimer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
      // Hard kill after grace period if still alive.
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
      }, SIGKILL_GRACE_MS).unref?.();
    }, timeoutMs);
    softTimer.unref?.();

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(softTimer);
      resolve({ exitCode, signal, stdout, stderr, timedOut });
    };

    child.once('error', err => {
      stderr += `\n[spawn-error] ${err instanceof Error ? err.message : String(err)}`;
      finish(null, null);
    });
    child.once('close', (code, signal) => {
      finish(code, signal);
    });
  });
}

/**
 * Build a `Client` that shells out to `claude -p`.
 *
 * **Forwarded**: `temperature` via `--settings '{"temperature":N}'` when
 * a finite value is supplied. `max_tokens` has no equivalent settings key
 * and is silently ignored.
 *
 * Callers who need reproducible sampling across providers should still
 * prefer `createAnthropicClient` — the CLI's settings-file route accepts
 * `temperature` without error but does not expose telemetry confirming
 * it took effect. This factory does not log per-call warnings.
 */
export function createCliClient(opts: CliClientOptions = {}): Client {
  const binary = opts.claudeBinary ?? 'claude';
  const cwd = opts.cwd ?? tmpdir();
  const bare = opts.bare ?? false;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async messages(params: MessageParams): Promise<{ content: string; captures?: CapturedCall[] }> {
      const prompt = flattenMessages(params.messages);
      const systemText = flattenSystem(params.system);
      const model = opts.defaultModel ?? params.model;

      const { path: systemPath, cleanup: cleanupSystem } = writeSystemPromptFile(systemText);
      const { configPath, capturePath, cleanup: cleanupMcp } = writeMcpConfigFiles();

      const args = [
        '-p',
        prompt,
        '--append-system-prompt-file',
        systemPath,
        '--output-format',
        'json',
        '--tools',
        '',
        '--model',
        model,
        // MCP-config wiring. `--strict-mcp-config` prevents the user's
        // `~/.claude/` MCP servers from leaking into the run, which
        // would both pollute captures and make CI non-hermetic.
        '--mcp-config',
        configPath,
        '--strict-mcp-config',
      ];
      // Forward temperature via an inline `--settings` JSON blob. The
      // CLI accepts JSON directly (no tmp file needed). Only pass when
      // the caller supplied a finite value — unset leaves the CLI on
      // its own default, matching what the user would see running
      // `claude -p` by hand.
      if (typeof params.temperature === 'number' && Number.isFinite(params.temperature)) {
        args.push('--settings', JSON.stringify({ temperature: params.temperature }));
      }
      if (bare) args.push('--bare');

      try {
        const outcome = await runSpawn(binary, args, cwd, process.env, timeoutMs);

        if (outcome.timedOut) {
          throw new Error(`claude -p timed out after ${timeoutMs}ms (stderr: ${outcome.stderr.slice(0, 1000)})`);
        }

        if (outcome.exitCode !== 0) {
          throw new Error(
            `claude -p exited with code ${outcome.exitCode}${
              outcome.signal ? ` (signal ${outcome.signal})` : ''
            }: ${outcome.stderr.slice(0, 1000)}`,
          );
        }

        let parsed: { result?: unknown; session_id?: unknown };
        try {
          parsed = JSON.parse(outcome.stdout) as { result?: unknown; session_id?: unknown };
        } catch (err) {
          const snippet = outcome.stdout.slice(0, 500);
          throw new Error(
            `claude -p stdout was not valid JSON: ${
              err instanceof Error ? err.message : String(err)
            }. First 500 chars: ${snippet}`,
          );
        }

        if (typeof parsed.result !== 'string') {
          throw new Error(`claude -p JSON output had no string \`result\` key. Raw: ${outcome.stdout.slice(0, 500)}`);
        }

        // Read captures BEFORE cleanup removes the file.
        const captures = readCaptures(capturePath);

        return { content: parsed.result, captures };
      } finally {
        cleanupSystem();
        cleanupMcp();
      }
    },
  };
}
