# dtwo-plugin

Claude Code plugin marketplace for the **DTwo** plugin — bundles the DTwo MCP server connection together with the gateway, policy, and Rego skills for managing DTwo gateways.

## Install

In Claude Code:

```
/plugin marketplace add dtwoai/dtwo-plugin
/plugin install dtwo@dtwo
```

After install, restart your Claude Code session. See [`dtwo/README.md`](dtwo/README.md) for what's bundled, the OAuth flow, and how to override `DTWO_MCP_URL` for staging or local dev.

## Layout

```
.claude-plugin/marketplace.json   # marketplace manifest
dtwo/                              # the plugin
├── .claude-plugin/plugin.json     # plugin manifest
├── .mcp.json                      # dtwo MCP server connection
├── skills/                        # dtwo-gateway-config, dtwo-gateway-policy, dtwo-policy-rego
└── README.md                      # plugin docs
```
