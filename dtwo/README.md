# DTwo plugin for Claude Code

A Claude Code plugin that bundles the DTwo MCP server connection together with three skills for managing DTwo gateways, policies, and Rego.

## Install

In Claude Code:

```
/plugin marketplace add dtwoai/dtwo-plugin
/plugin install dtwo@dtwo
```

That's it. Restart your Claude Code session — the skills are auto-discovered and the `dtwo` MCP server is registered. On the first DTwo tool call, your browser opens to complete the Auth0 OAuth flow.

## What's included

### MCP server

| Name   | Transport | Default URL                        |
| ------ | --------- | ---------------------------------- |
| `dtwo` | HTTP      | `https://mcp.us1.prod.dtwo.ai/mcp` |

The URL can be overridden by setting `DTWO_MCP_URL` and `DTWO_CLIENT_ID` before launching Claude Code, e.g.:

```bash
# Point at your local dtwo-mcp server
export DTWO_MCP_URL=http://localhost:3000/mcp
export DTWO_CLIENT_ID=[...]
```

For a per-project override that doesn't touch your shell, drop it in `.claude/settings.local.json` at the root of the project you're working in (this file is git-ignored by default):

```json
{
  "env": {
    "DTWO_MCP_URL": "http://localhost:3000/mcp",
    "DTWO_CLIENT_ID": [...]
  }
}
```

Use `.claude/settings.json` instead if you want the override committed and shared with your team.

If unset, the plugin connects to https://mcp.us1.prod.dtwo.ai/mcp automatically.

### Skills

| Skill                 | Use when                                                                               |
| --------------------- | -------------------------------------------------------------------------------------- |
| `dtwo-gateway-config` | Editing gateway YAML, adding/removing MCP servers, publishing or rolling back configs. |
| `dtwo-gateway-policy` | Creating, attaching, publishing, deploying, or verifying policies and pipelines.       |
| `dtwo-policy-rego`    | Authoring, modifying, explaining, or debugging Rego policy code for the DTwo Gateway.  |

The skills load each other on demand via Claude Code's `Skill` tool — most real tasks pull in two or three together.

## Troubleshooting

- **OAuth doesn't open a browser** — make sure port `33418` is free; this is the registered OAuth callback port.
- **`dtwo` server not connecting** — confirm `DTWO_MCP_URL` (if set) is reachable, and that you're logged into the right Auth0 tenant.
- **Skills not appearing** — restart your Claude Code session after install. Skills are scanned on session start.
