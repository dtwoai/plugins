/**
 * Glue between the stdio MCP stub and the `claude -p` CLI.
 *
 * Produces the `--mcp-config` JSON blob that tells the CLI how to spawn
 * our stub. The CLI launches the subprocess, plumbs stdio, and surfaces
 * the stub's tools to the model under `mcp__dtwo__*` names (matching
 * what the skill expects).
 *
 * Also owns the capture-file reader and the helper that pulls the
 * final YAML out of the captured call log.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { CapturedCall } from './mcpStub.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Absolute path to `mcpStub.ts`. Exported so tests and the launcher
 * agree on a single source of truth. Resolves relative to this file so
 * the lookup survives tsx's in-memory transpile and the published
 * JS layout.
 */
export const MCP_STUB_PATH = resolve(HERE, 'mcpStub.ts');

export type McpServerConfig = {
  command: string;
  args: string[];
  env?: Record<string, string>;
};

export type McpConfig = {
  mcpServers: Record<string, McpServerConfig>;
};

/**
 * Build the `--mcp-config` JSON the CLI consumes. The server name is
 * `dtwo` so tools surface as `mcp__dtwo__dtwo-<name>`; Claude Code
 * strips the `mcp__dtwo__` prefix when displaying to the model, which
 * matches what SKILL.md documents.
 *
 * The stub inherits PATH from the parent process so `tsx` is
 * discoverable. The capture path is passed via the `env` block instead
 * of argv so it doesn't leak into process lists.
 */
export function createStubConfig(opts: { capturePath: string; tsxBinary?: string }): McpConfig {
  const tsxBinary = opts.tsxBinary ?? 'tsx';
  return {
    mcpServers: {
      dtwo: {
        command: tsxBinary,
        args: [MCP_STUB_PATH],
        env: {
          SKILL_HARNESS_CAPTURE_PATH: opts.capturePath,
        },
      },
    },
  };
}

/**
 * Parse a capture file into a list of `CapturedCall`. Missing file
 * returns an empty array — a skill run that never exercised the MCP
 * server is legal (it just produces no captures).
 *
 * Malformed lines are skipped with a console warning rather than
 * thrown — the run has already happened, so a broken JSONL line in the
 * middle shouldn't lose the whole capture.
 */
export function readCaptures(capturePath: string): CapturedCall[] {
  let raw: string;
  try {
    raw = readFileSync(capturePath, 'utf8');
  } catch {
    return [];
  }
  const out: CapturedCall[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as CapturedCall);
    } catch {
      // Skip malformed line.
    }
  }
  return out;
}

const YAML_PARAM_NAMES = ['yaml', 'config'] as const;

function pickYamlParam(params: Record<string, unknown>): string | null {
  for (const key of YAML_PARAM_NAMES) {
    const v = params[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

/**
 * Scan captures for the skill's "this is my final config" signal.
 *
 * Priority:
 *   1. Last `dtwo-save-gateway-draft-config` — this is the durable
 *      persistence call, so its YAML is the most authoritative.
 *   2. Last `dtwo-validate-gateway-config` — the skill may call validate
 *      several times while iterating; take the most recent one. Only
 *      used if no save call fired.
 *
 * Both tools accept either `yaml:` or `config:` as the payload key (the
 * skill picks one; the stub doesn't care which). We prefer `yaml:` when
 * both are present.
 */
export function extractCapturedYaml(captures: CapturedCall[]): string | null {
  let lastSave: string | null = null;
  let lastValidate: string | null = null;
  for (const call of captures) {
    const payload = pickYamlParam(call.params ?? {});
    // A save call with a malformed payload (neither yaml nor config) is
    // skipped here and in hasSaveCall — we treat it as "didn't really
    // save" rather than surfacing a malformed artifact downstream.
    if (payload === null) continue;
    if (call.tool === 'dtwo-save-gateway-draft-config') lastSave = payload;
    else if (call.tool === 'dtwo-validate-gateway-config') lastValidate = payload;
  }
  return lastSave ?? lastValidate;
}

/**
 * True when the capture stream shows a successful save call — the
 * strongest "skill completed its flow" signal. The runner uses this
 * to suppress `gaveUpAtTurn` when a save happened but the assistant's
 * final text didn't include a fenced YAML block.
 */
export function hasSaveCall(captures: CapturedCall[]): boolean {
  for (const call of captures) {
    if (call.tool === 'dtwo-save-gateway-draft-config') {
      if (pickYamlParam(call.params ?? {}) !== null) return true;
    }
  }
  return false;
}
