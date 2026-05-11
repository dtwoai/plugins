---
name: "dtwo-gateway-config"
description: |
  Manage DTwo gateway YAML configuration and MCP server definitions: edit, validate, save draft, publish, deploy, and roll back.
  TRIGGER when: user says "add/remove/edit MCP server", "gateway config/YAML", "change gateway auth/JWKS/SSRF/CORS",
  "publish/revert gateway config", "deploy gateway" after a config change; or wants to inspect/list gateway versions.
  SKIP when: task is writing or explaining Rego (use dtwo-policy-rego); task is attaching/detaching policies
  on a pipeline or pinning policy versions (use dtwo-gateway-policy).
---

<!-- © 2026 DTwo, Inc. PROPRIETARY & CONFIDENTIAL. Not for redistribution, modification, or training of other models without a commercial license from DTwo, Inc. -->

# DTwo Gateway & MCP Server Configuration

You manage DTwo gateway configuration and MCP server definitions through the DTwo MCP server. You handle the full configuration lifecycle: editing gateway YAML, adding/modifying MCP server entries, validating and publishing configuration, deploying gateways, and rolling back.

## Companion skills

This skill is typically used alongside others. Invoke them via the `Skill` tool when the task crosses boundaries (in other agents, use your host's equivalent skill-loading mechanism):

- **dtwo-gateway-policy** — load when the task also involves attaching/detaching policies on a pipeline or managing policy lifecycle (e.g., add a new MCP server and attach a policy in the same session).
- **dtwo-policy-rego** — load when the task also requires writing or modifying Rego; typically loaded via `dtwo-gateway-policy` rather than directly alongside this skill.

## Prerequisites

This skill requires the DTwo MCP server to be connected (`dtwo-*` tools must be loaded). If the tools are not available, ask the user to connect the DTwo MCP server first.

The tools listed below reflect the initial set. The DTwo MCP server may add new tools over time — if you discover `dtwo-*` tools not listed here, use them where appropriate. Prefer newer, more specific tools over workarounds when available.

**Tool naming note:** This skill refers to the DTwo MCP tools by their short names (e.g., `dtwo-list-gateways`). In Claude Code, that short name is what you call directly — the `mcp__dtwo__` server prefix is stripped automatically. In other MCP clients you may see the fully-qualified name `mcp__dtwo__dtwo-list-gateways`; both refer to the same tool. This is **separate** from the per-tool name that appears inside Rego policies (`input.payload.name`) — see the companion `dtwo-policy-rego` instructions for that.

## Workflow

1. Identify the target gateway by resolving the user-provided name to a UID.
2. Inspect the current draft configuration and any relevant published versions.
3. Make the smallest correct YAML change for the requested outcome.
4. Validate before saving or publishing.
5. Only deploy after confirming with the user, then verify deployment status and runtime behavior.

## Rules

- Do not guess gateway UIDs when they can be discovered with `dtwo-list-gateways`.
- Validate draft YAML before saving or publishing.
- Treat deployment as a live-environment change and confirm with the user first.
- Prefer newly discovered `dtwo-*` tools over older workarounds when available.

## Available Tools

### Gateway Configuration Tools

| Tool | Purpose |
|------|---------|
| `dtwo-list-gateways` | List gateways with optional filters (name, status, uid) |
| `dtwo-get-gateway` | Fetch a single gateway by UID |
| `dtwo-update-gateway` | Update gateway metadata (name, tags) |
| `dtwo-get-gateway-config` | Fetch the draft YAML configuration (includes MCP server definitions) |
| `dtwo-get-gateway-versions` | List published versions for a gateway |
| `dtwo-validate-gateway-config` | Validate YAML configuration without saving |
| `dtwo-save-gateway-draft-config` | Validate and save YAML as the draft configuration |
| `dtwo-publish-gateway-config` | Publish the gateway draft as a new version |
| `dtwo-revert-gateway-config` | Restore a published gateway version back into the draft |

### Deploy & Status Tools

| Tool | Purpose |
|------|---------|
| `dtwo-deploy-gateway` | Queue a deployment for the gateway |
| `dtwo-get-gateway-deployments` | List deployment tasks for a gateway |
| `dtwo-get-deployment` | Check status of a specific deployment |

### Deletion (not supported via MCP)

The DTwo MCP server does not expose a `delete-gateway` tool. `revert-gateway-config` restores a prior version — it does **not** delete.

Deleting a gateway must be done via the **DTwo web UI**. If a `dtwo-delete-gateway` tool later appears (see the tool-discovery note under Prerequisites), prefer it over the UI.

## Identifying the Target Gateway

Users typically refer to gateways by name. Use `dtwo-list-gateways` with the `name` filter to resolve a name to a UID. If the user hasn't specified a gateway and more than one exists, list the gateways and ask which one to use.

## Gateway Configuration Reference

Gateway configuration is YAML with two optional top-level sections. Keys are normalized to lowercase by the parser, **except inside the `advanced` section** — keys there are case-sensitive and must match exactly.

The `advanced` section is an escape hatch for settings that the parser does not model directly but that need to be written into the gateway config file. Use it for keys the parser doesn't recognize; preserve the exact casing the underlying gateway expects.

```yaml
gateway:       # Gateway-level settings
  ...
mcp_servers:   # List of MCP server definitions
  - ...
```

### Gateway Section

Controls authentication, SSRF protection, logging, CORS, and advanced flags.

- **Authentication** defaults to enabled when omitted. Supports JWKS-based JWT verification, SSO issuer, audience/issuer verification, JTI requirements, token expiration enforcement, and OAuth resource metadata.
- **Gateway-side `jwks_info` is independent of any `mcp_servers[].authentication` block.** When the prompt supplies an IdP tenant and audience (e.g. Auth0), populate `gateway.authentication.jwks_info` (`jwt_algorithm`, `jwt_jwks_uri`, `jwt_issuer`, `jwt_audience`) — even when the upstream MCP server uses OAuth/DCR, and even when the prompt says the upstream server "only supports OAuth" or "does not accept bearer tokens." Those statements describe the outbound leg to the MCP server, not the inbound leg from clients to the gateway.
- **SSRF** defaults to strict (block localhost, block private networks, fail-closed DNS) when omitted. Set `allow_private_networks: true` to permit access to `host.docker.internal` and other private addresses.

### MCP Servers Section

Each server requires `name` and `url`. Optional fields: `description`, `transport_type`, `refresh_interval_seconds`, and `authentication`.

- `transport_type` — accepted values are `streamablehttp`, `sse`, and `http`. **When generating new configs, always use `streamablehttp`** (one word). The parser also accepts `streamable_http` and normalizes it to `streamablehttp` when writing the file back out, so you may see either form in existing configs.
- `refresh_interval_seconds` — supported but should not normally be set; rely on the gateway default unless the user has a specific reason to override.

Supported authentication types:

| Type | Required Fields |
|------|----------------|
| `bearer` | `token` |
| `basic` | `username`, `password` |
| `authheaders` | `headers` (array of `{key, value}`) |
| `query_param` | `param_key`, `param_value` |
| `oauth` | Either `issuer` (for DCR) or `client_id` + `client_secret` + `token_url`. Optional: `grant_type`, `scopes`, `authorization_url`, `redirect_uri`, `pkce_enabled`, `extra_authorize_params`, `scope_param_name`, `scope_separator`, `token_response_path`, `token_lifetime_seconds`, `oauth_quirks` |
| `cert` | `ca_cert` (PEM) |

**Secret-typed fields** (any field with `secret: true` in the schema — `token`, `password`, `client_secret`, `authheaders.headers[].value`, `query_param.param_value`) must never carry inferred or literal credentials. Emit a self-describing placeholder in one of these shapes: `REPLACE_WITH_<FIELD>`, `PLACEHOLDER_<FIELD>`, `YOUR_<FIELD>` / `your-<field>` (matching the OAuth example below), `CHANGE_ME`, or `${ENV_VAR}`. Bare `PLACEHOLDER` (no suffix), `FILL_FROM_ENV`, and descriptive prose like `placeholder-replace-me` do **not** count — the placeholder must be self-describing so the operator can see which value to substitute.

### MCP Server Example

```yaml
mcp_servers:
  - name: slack-mcp
    url: https://mcp.slack.com/mcp
    transport_type: streamablehttp
    authentication:
      type: oauth
      grant_type: authorization_code
      client_id: "your-client-id"
      client_secret: "your-client-secret"
      authorization_url: https://slack.com/oauth/v2/authorize
      token_url: https://slack.com/api/oauth.v2.access
      redirect_uri: https://localhost/oauth/callback
      scopes:
        - search:read
        - channels:history
        - chat:write
```

## Configuration Workflow

### Editing Configuration

1. Fetch the current draft with `dtwo-get-gateway-config`
2. Edit the YAML (add/modify MCP servers, change gateway settings)
3. Validate with `dtwo-validate-gateway-config`
4. Save with `dtwo-save-gateway-draft-config`
5. Deploy with `dtwo-deploy-gateway` to test the draft configuration
6. Once working as desired, publish with `dtwo-publish-gateway-config`

### Rolling Back Configuration

1. List versions with `dtwo-get-gateway-versions`
2. Restore with `dtwo-revert-gateway-config` (optionally publish immediately with `publish: true`)

## Deploying

`dtwo-deploy-gateway` is the only operation that affects a running gateway — all other changes (configuration edits, publishing, reverting) modify draft or published state that is not live until a deploy happens. Always confirm with the user before deploying.

After editing configuration, you **must** deploy the gateway for changes to take effect on the running instance.

**MCP connection drops during deploy:** The gateway restarts during deployment, which briefly disconnects the MCP server (typically 5–10 seconds). `dtwo-deploy-gateway` returns the task UID before the restart, so capture it. Then poll `dtwo-get-deployment` with that UID; transient errors are expected during the restart window. Do not proceed with testing or further changes until the deployment status confirms `status: "completed"`.

> **Client quirks (Claude Code).** Claude Code's MCP client surfaces two distinct transient error states during a gateway restart; other MCP clients may reconnect transparently or surface different errors.
>
> 1. **`Streamable HTTP error: 502 Bad Gateway`** — the gateway is restarting but the MCP client connection is still alive. Keep retrying — this recovers automatically.
> 2. **`MCP server "<name>" is not connected`** — the MCP client has fully disconnected and will **not** auto-recover. Ask the user to reconnect the MCP server in their client (e.g., via the MCP server panel in VS Code or the CLI reconnect command), then resume polling.
>
> **Do not ask the user to reconnect unless you see the "is not connected" error.** The 502 errors resolve on their own.

## Verification

After deploying a gateway with configuration changes:

1. Poll `dtwo-get-deployment` until it returns `status: "completed"`. If a call fails with a 502 error, retry — the gateway is still restarting. If you get `"MCP server is not connected"`, ask the user to reconnect, then resume polling. Once status is `"completed"`, the gateway is live and ready to test.
2. Verify the gateway is heartbeating (check `lastSeenAt` in `dtwo-get-gateway`)
3. Test that MCP tools from each configured server are accessible and responding
4. If an MCP server uses OAuth, the user may need to re-authenticate after the server is added or its auth config changes

## Limitations

- This skill cannot author or modify Rego policies — see the companion `dtwo-policy-rego` instructions
- This skill cannot attach/detach policies on a pipeline, pin policy versions, or manage policy lifecycle — see the companion `dtwo-gateway-policy` instructions
- This skill cannot delete a gateway via the MCP surface — deletion must be done in the DTwo web UI
- This skill cannot validate or auto-complete keys inside the `advanced` section — those keys are passed through verbatim, so the user is responsible for correctness
- This skill cannot enumerate the MCP tools a server exposes until after the server is deployed and introspected — for tool discovery, see the companion `dtwo-gateway-policy` instructions
