#!/usr/bin/env node
/**
 * Minimal MCP-over-stdio server used by the Tier-2 bench.
 *
 * Why this exists
 * ---------------
 * The `dtwo-gateway-config` skill is authored against a set of `dtwo-*`
 * MCP tools. When the bench runs with no MCP tools mounted, Claude often
 * refuses with "please connect the DTwo MCP server." That's the skill's
 * prerequisite check firing correctly — but it blocks us from
 * measuring its production behavior.
 *
 * This stub registers the 12 `dtwo-*` tools the skill expects, returns
 * canned responses, and — critically — captures the YAML payload sent to
 * `dtwo-validate-gateway-config` / `dtwo-save-gateway-draft-config`. The
 * captured payload becomes the skill's output artifact.
 *
 * Protocol
 * --------
 * Classic MCP-over-stdio: line-delimited JSON-RPC 2.0 on stdin/stdout.
 * We handle exactly three methods:
 *
 *   - `initialize`      — hand back server info + capabilities.
 *   - `tools/list`      — enumerate the 12 tools with shallow JSONSchema.
 *   - `tools/call`      — dispatch, capture, reply.
 *
 * Any other method gets the standard `-32601 Method not found` reply.
 *
 * We hand-roll rather than take `@modelcontextprotocol/sdk` as a
 * dependency because this is a test double; a few hundred lines of
 * JSON-RPC are worth less churn on `package.json` than a real SDK add.
 *
 * Capture file format
 * -------------------
 * JSONL. Each `tools/call` appends one line:
 *
 *   { "timestamp": "<iso>", "tool": "<name>", "params": <args> }
 *
 * The path is read from `SKILL_HARNESS_CAPTURE_PATH`. Non-capture tools
 * are logged too — it's useful for the runner to see the full call
 * sequence, not just validate/save.
 *
 * Stateless
 * ---------
 * Intentionally. Each tool call is independent. No gateway state is
 * simulated. Validation always succeeds — the harness's own Zod rubric
 * catches bad user configs downstream.
 */

import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

type JsonRpcRequest = {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: unknown;
};

type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

type ToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => unknown;
};

const TEXT_SCHEMA = { type: 'string' } as const;

/**
 * The 12 `dtwo-*` tools. Schemas are deliberately minimal: each tool's
 * input is an open `object`, and the handler returns canned JSON-like
 * data matching the tool's purpose. The skill doesn't introspect schemas
 * beyond tool names, so the surface can stay thin.
 */
const TOOLS: ToolDef[] = [
  {
    name: 'dtwo-list-gateways',
    description: 'List gateways with optional filters (name, status, uid).',
    inputSchema: {
      type: 'object',
      properties: {
        name: TEXT_SCHEMA,
        status: TEXT_SCHEMA,
        uid: TEXT_SCHEMA,
      },
      additionalProperties: true,
    },
    handler: () => [{ uid: 'bench-gw-1', name: 'bench-gateway', status: 'draft' }],
  },
  {
    name: 'dtwo-get-gateway',
    description: 'Fetch a single gateway by UID.',
    inputSchema: {
      type: 'object',
      properties: { uid: TEXT_SCHEMA },
      required: ['uid'],
      additionalProperties: true,
    },
    handler: () => ({
      uid: 'bench-gw-1',
      name: 'bench-gateway',
      status: 'draft',
      tags: [],
      lastSeenAt: new Date().toISOString(),
    }),
  },
  {
    name: 'dtwo-update-gateway',
    description: 'Update gateway metadata (name, tags).',
    inputSchema: {
      type: 'object',
      properties: {
        uid: TEXT_SCHEMA,
        name: TEXT_SCHEMA,
        tags: { type: 'array', items: TEXT_SCHEMA },
      },
      required: ['uid'],
      additionalProperties: true,
    },
    handler: () => ({ ok: true }),
  },
  {
    name: 'dtwo-get-gateway-config',
    description: 'Fetch the draft YAML configuration.',
    inputSchema: {
      type: 'object',
      properties: { uid: TEXT_SCHEMA },
      required: ['uid'],
      additionalProperties: true,
    },
    handler: () => ({
      yaml: 'gateway:\n  authentication:\n    enabled: true\n',
    }),
  },
  {
    name: 'dtwo-get-gateway-versions',
    description: 'List published versions for a gateway.',
    inputSchema: {
      type: 'object',
      properties: { uid: TEXT_SCHEMA },
      required: ['uid'],
      additionalProperties: true,
    },
    handler: () => [],
  },
  {
    name: 'dtwo-validate-gateway-config',
    description: 'Validate YAML configuration without saving. CAPTURED.',
    inputSchema: {
      type: 'object',
      properties: {
        uid: TEXT_SCHEMA,
        yaml: TEXT_SCHEMA,
        config: TEXT_SCHEMA,
      },
      additionalProperties: true,
    },
    handler: () => ({ valid: true, errors: [] }),
  },
  {
    name: 'dtwo-save-gateway-draft-config',
    description: 'Validate and save YAML as the draft configuration. CAPTURED.',
    inputSchema: {
      type: 'object',
      properties: {
        uid: TEXT_SCHEMA,
        yaml: TEXT_SCHEMA,
        config: TEXT_SCHEMA,
      },
      additionalProperties: true,
    },
    handler: () => ({ ok: true, saved: true }),
  },
  {
    name: 'dtwo-publish-gateway-config',
    description: 'Publish the gateway draft as a new version.',
    inputSchema: {
      type: 'object',
      properties: { uid: TEXT_SCHEMA },
      required: ['uid'],
      additionalProperties: true,
    },
    handler: () => ({ version: 1 }),
  },
  {
    name: 'dtwo-revert-gateway-config',
    description: 'Restore a published gateway version back into the draft.',
    inputSchema: {
      type: 'object',
      properties: {
        uid: TEXT_SCHEMA,
        version: { type: 'number' },
        publish: { type: 'boolean' },
      },
      required: ['uid'],
      additionalProperties: true,
    },
    handler: () => ({ ok: true }),
  },
  {
    name: 'dtwo-deploy-gateway',
    description: 'Queue a deployment for the gateway.',
    inputSchema: {
      type: 'object',
      properties: { uid: TEXT_SCHEMA },
      required: ['uid'],
      additionalProperties: true,
    },
    handler: () => ({ deployment_id: 'bench-dep-1' }),
  },
  {
    name: 'dtwo-get-gateway-deployments',
    description: 'List deployment tasks for a gateway.',
    inputSchema: {
      type: 'object',
      properties: { uid: TEXT_SCHEMA },
      required: ['uid'],
      additionalProperties: true,
    },
    handler: () => [],
  },
  {
    name: 'dtwo-get-deployment',
    description: 'Check status of a specific deployment.',
    inputSchema: {
      type: 'object',
      properties: { deployment_id: TEXT_SCHEMA },
      required: ['deployment_id'],
      additionalProperties: true,
    },
    handler: () => ({ status: 'succeeded' }),
  },
];

const TOOL_INDEX: Record<string, ToolDef> = Object.fromEntries(TOOLS.map(t => [t.name, t]));

export type CapturedCall = {
  timestamp: string;
  tool: string;
  params: Record<string, unknown>;
};

/**
 * Safe append of a single JSONL line. We swallow capture errors on
 * purpose — an unwritable capture file should not crash the skill's
 * tool call. The runner surfaces the empty-capture case separately.
 */
function appendCapture(path: string, entry: CapturedCall): void {
  try {
    appendFileSync(path, `${JSON.stringify(entry)}\n`, { encoding: 'utf8' });
  } catch {
    // best-effort
  }
}

/**
 * Build a JSON-RPC response. `null` id is explicit — the spec allows it
 * for notifications, and a request without an id should get an error
 * reply where id is echoed as null.
 */
function ok(id: number | string | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function err(id: number | string | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/**
 * Produce an MCP `tools/call` result. Per MCP spec the response shape is
 * `{ content: [{ type: 'text', text: '...' }], isError?: boolean }`. We
 * JSON-stringify whatever the handler returned so the client sees a
 * deterministic blob.
 */
function toolResult(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return {
    content: [
      {
        type: 'text',
        text: typeof data === 'string' ? data : JSON.stringify(data),
      },
    ],
  };
}

export function handleRequest(req: JsonRpcRequest, capturePath: string | undefined): JsonRpcResponse | null {
  const id = req.id ?? null;

  // Notifications (no id) get no reply. Per JSON-RPC 2.0 §4.1.
  const isNotification = req.id === undefined;

  switch (req.method) {
    case 'initialize': {
      if (isNotification) return null;
      return ok(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'skill-harness-dtwo-stub', version: '0.1.0' },
      });
    }
    case 'notifications/initialized':
      // Client-to-server notification; no reply.
      return null;
    case 'tools/list': {
      if (isNotification) return null;
      return ok(id, {
        tools: TOOLS.map(t => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });
    }
    case 'tools/call': {
      const params = (req.params ?? {}) as { name?: unknown; arguments?: unknown };
      const name = typeof params.name === 'string' ? params.name : '';
      const args =
        params.arguments && typeof params.arguments === 'object' ? (params.arguments as Record<string, unknown>) : {};
      if (capturePath) {
        appendCapture(capturePath, {
          timestamp: new Date().toISOString(),
          tool: name,
          params: args,
        });
      }
      const def = TOOL_INDEX[name];
      if (!def) {
        if (isNotification) return null;
        return ok(id, {
          content: [{ type: 'text', text: `unknown tool: ${name}` }],
          isError: true,
        });
      }
      let data: unknown;
      try {
        data = def.handler(args);
      } catch (e) {
        if (isNotification) return null;
        return ok(id, {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        });
      }
      if (isNotification) return null;
      return ok(id, toolResult(data));
    }
    default: {
      if (isNotification) return null;
      return err(id, -32601, `Method not found: ${req.method}`);
    }
  }
}

function runStdioLoop(): void {
  const capturePath = process.env.SKILL_HARNESS_CAPTURE_PATH;
  const rl = createInterface({ input: process.stdin });

  rl.on('line', line => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let req: JsonRpcRequest;
    try {
      req = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      // Malformed JSON: reply with -32700 to id=null per JSON-RPC 2.0 §5.
      process.stdout.write(`${JSON.stringify(err(null, -32700, 'Parse error'))}\n`);
      return;
    }
    const response = handleRequest(req, capturePath);
    if (response !== null) {
      process.stdout.write(`${JSON.stringify(response)}\n`);
    }
  });

  rl.on('close', () => {
    process.exit(0);
  });
}

// Only enter the stdio loop when this file is the process entry point.
// Tests import it as a module and invoke `handleRequest` directly.
const entry = process.argv[1] ?? '';
if (entry.endsWith('mcpStub.ts') || entry.endsWith('mcpStub.js') || entry.endsWith('mcpStub.mjs')) {
  runStdioLoop();
}

export { TOOLS };
