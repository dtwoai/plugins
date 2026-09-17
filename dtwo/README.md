# Dtwo plugin for Claude Code and Cursor

A plugin that bundles the Dtwo MCP server connection together with skills for managing Dtwo gateways, policies, and Rego — including a guided first-time setup skill you invoke as `/dtwo:setup`.

## Install

In Claude Code:

```
/plugin marketplace add dtwoai/plugins
/plugin install dtwo@dtwo
```

That's it. Restart your Claude Code session — the skills are auto-discovered and the `dtwo` MCP server is registered. On the first Dtwo tool call, your browser opens to complete the Auth0 OAuth flow.

## Cursor desktop

Cursor loads the same skills through `.cursor-plugin/plugin.json`, with a separate `cursor.mcp.json` connection. It uses a public static OAuth client ID; no client secret is included. These instructions cover the desktop app only.

In Cursor, open **Customize** in the left sidebar and select **Plugins**. For a marketplace installation, choose **Browse Marketplace**, find Dtwo if it is available in your marketplace, select **Install**, and choose your user or project scope. If `dtwo` already appears under **Installed**, it is already installed.

For testing unpublished changes, use Cursor's documented local installation below. A marketplace installation named `dtwo` takes precedence over this local copy, so uninstall that marketplace installation before testing the local adapter. On macOS or Linux, run these commands from a directory that does not already contain `dtwo-plugins`:

```bash
git clone https://github.com/dtwoai/plugins.git dtwo-plugins
mkdir -p ~/.cursor/plugins/local && test ! -e ~/.cursor/plugins/local/dtwo && cp -R dtwo-plugins/dtwo ~/.cursor/plugins/local/dtwo
```

The copy command refuses to replace an existing installation. For an update, pull the repository, back up any local configuration changes, and replace the installed `dtwo` folder with the updated one. On Windows, clone or download the repository and copy its `dtwo` folder into `%USERPROFILE%/.cursor/plugins/local/dtwo`.

1. Your team must allow local plugin imports. On managed accounts, an administrator controls **Allow Local Plugin Imports** in the Cursor dashboard.
2. Run **Developer: Reload Window** from Cursor's command palette.
3. Open **Customize → Plugins**, select your user scope, and check that `dtwo` appears under **Installed**. Local plugins load at user scope.
4. Select **MCPs** on the same Customize page. Find and enable the `dtwo` server, then complete browser sign-in.
5. Select **Skills** and check that the Dtwo skills are available.
6. In Agent chat, ask: **Use the Dtwo setup skill to help me set up my gateway.** Claude slash commands are not required.

Copy the directory rather than symlinking to a repository outside Cursor's local plugins folder. A marketplace installation with the same name takes precedence over a local copy.

The bundled connection targets Dtwo's production management MCP. For another environment, update both the URL and `auth.CLIENT_ID` in the installed `cursor.mcp.json` using values from your Dtwo administrator. Do not use that management client ID for a gateway: use the gateway's connection instructions and its own client ID instead.

The static client's allowed redirect URI must include `http://localhost:8787/callback`. Cursor chooses this fixed desktop callback; `oauth.callbackPort` does not apply. Do not add a client secret or rely on dynamic client registration. If sign-in fails, check the client ID and callback registration, then disconnect and reconnect the server.

See [Cursor's plugin installation documentation](https://cursor.com/docs/plugins) and [static OAuth configuration](https://cursor.com/docs/mcp).

## First step: `/dtwo:setup`

New to Dtwo? Run `/dtwo:setup` (the guided setup skill). It walks you through standing up your first gateway end to end — creating it, choosing where it runs, configuring authentication, adding the MCP servers you want behind it, attaching starter policies, deploying, and printing ready-to-paste instructions for connecting Claude Code or Cursor. It's conversational and confirms before anything goes live.

Already have a gateway and just want to make a change? Skip setup and ask directly — the skills below load on demand for focused edits.

## Working with Claude Cowork

Install the plugin through Claude Desktop's plugin settings. The management MCP supports CIMD. If your organization uses a manually configured connector, its name must be `dtwo` so it matches the plugin's MCP server. Use `https://mcp.us1.prod.dtwo.ai/mcp` as the production endpoint.

## What's included

### MCP server

| Name   | Transport | Default URL                        |
| ------ | --------- | ---------------------------------- |
| `dtwo` | HTTP      | `https://mcp.us1.prod.dtwo.ai/mcp` |


### Skills

| Skill                 | Use when                                                                               |
| --------------------- | -------------------------------------------------------------------------------------- |
| `setup`               | Guided first-time onboarding — invoked as `/dtwo:setup`; orchestrates the whole create → configure → deploy → connect journey. |
| `dtwo-gateway-config` | Editing gateway YAML, adding/removing MCP servers, publishing or rolling back configs. |
| `dtwo-gateway-policy` | Creating, attaching, publishing, deploying, or verifying policies and pipelines; managing markers (and the intent registry when those tools are enabled). |
| `dtwo-policy-rego`    | Authoring, modifying, explaining, or debugging Rego policy code for the Dtwo Gateway, including marker writer/reader policies.  |

The skills load each other on demand via Claude Code's `Skill` tool — most real tasks pull in two or three together.

## Troubleshooting

- **Cursor OAuth does not open a browser** — confirm the server is enabled and port `8787` is available, then reconnect in Customize.
- **Skills not appearing** — restart your Claude Code session after install. Skills are scanned on session start.
