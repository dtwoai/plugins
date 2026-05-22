# DTwo plugin for Claude Code

A Claude Code plugin that bundles the DTwo MCP server connection together with three skills for managing DTwo gateways, policies, and Rego.

## Install

In Claude Code:

```
/plugin marketplace add dtwoai/dtwo-plugin
/plugin install dtwo@dtwo
```

That's it. Restart your Claude Code session — the skills are auto-discovered and the `dtwo` MCP server is registered. On the first DTwo tool call, your browser opens to complete the Auth0 OAuth flow.

## Working with Claude Cowork

The DTwo MCP server does not yet support CIMD, so Claude Cowork can't connect to it through the plugin alone. Support for CIMD will be added soon. In the meantime, to make our plugin work in Claude Cowork, an admin of your Anthropic organization needs to configure a custom connector first.

1. As an Anthropic org admin, create a custom connector with the following settings:
   - **Name:** `dtwo` (must match the plugin name exactly)
   - **Transport:** HTTP
   - **URL:** `https://mcp.us1.prod.dtwo.ai/mcp`
   - **Client ID:** `EleONdxmthzCtATDyGkHW4w9TIct7qRO`
2. Once the connector is in place, install the plugin from the marketplace as described in [Install](#install).

Naming the connector `dtwo` is required — it has to match the plugin's MCP server name so users connect through it cleanly.

## What's included

### MCP server

| Name   | Transport | Default URL                        |
| ------ | --------- | ---------------------------------- |
| `dtwo` | HTTP      | `https://mcp.us1.prod.dtwo.ai/mcp` |


### Skills

| Skill                 | Use when                                                                               |
| --------------------- | -------------------------------------------------------------------------------------- |
| `dtwo-gateway-config` | Editing gateway YAML, adding/removing MCP servers, publishing or rolling back configs. |
| `dtwo-gateway-policy` | Creating, attaching, publishing, deploying, or verifying policies and pipelines.       |
| `dtwo-policy-rego`    | Authoring, modifying, explaining, or debugging Rego policy code for the DTwo Gateway.  |

The skills load each other on demand via Claude Code's `Skill` tool — most real tasks pull in two or three together.

## Troubleshooting

- **OAuth doesn't open a browser** — make sure port `33418` is free; this is the registered OAuth callback port.
- **Skills not appearing** — restart your Claude Code session after install. Skills are scanned on session start.
