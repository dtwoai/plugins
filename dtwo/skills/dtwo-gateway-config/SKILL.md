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

<!-- BEGIN SCHEMA DIGEST (generated by scripts/generate-schema-digest.mjs — do not edit by hand) -->

### Schema Digest

This subsection is generated from `schema-reference.json` by `scripts/generate-schema-digest.mjs` — do not edit by hand. It captures field-level facts (types, defaults, required-ness, secret flags, cross-field rules, target env-var / SOTW paths); the surrounding SKILL.md prose handles workflow and rules. When the digest and the underlying schema artifact disagree, the artifact wins; regenerate this section to reconcile.

#### Sections at a glance

| Section path | Synopsis |
|---|---|
| `gateway` | Gateway-wide settings (auth, SSRF, logging). Carries the `advanced` escape hatch and `log_level`. |
| `gateway.authentication` | Inbound auth from clients to the gateway. `enabled` defaults to `true`; cross-field constraint requires `jwks_info` when enabled. |
| `gateway.authentication.jwks_info` | Inbound JWT validation parameters. All four fields required when this object is present. |
| `gateway.ssrf` | SSRF protection overrides. Strict defaults apply when omitted. |
| `mcp_servers[]` | One entry per upstream MCP server. `name` and `url` required. |
| `mcp_servers[].authentication` | Discriminated union keyed on `type`; outbound auth from gateway to the upstream server. Seven variants (see table). |

#### `gateway.authentication` — load-bearing defaults & constraints

- **`enabled`** — `schemaDefault: true`. Type `boolean`. Target env var: `MCP_REQUIRE_AUTH`. **When omitted, the gateway authenticates incoming requests.** Set `false` only for local development.
- **`sso_issuer`** — optional `URL`. Metadata-only; does NOT validate tokens by itself. Target: `SSO_GENERIC_ISSUER`.
- **`sso_generic_scope`** — optional `string`. Ignored unless `sso_issuer` is set. Target: `SSO_GENERIC_SCOPE`.

**Cross-field constraint** (verbatim from artifact):
> When authentication is enabled (the default), `jwks_info` must be configured. `sso_issuer` alone is metadata-only and does not validate tokens.

#### `gateway.authentication.jwks_info` — inbound JWT validation

All four fields are required when this object is present. These govern the **inbound** leg (clients → gateway), independent of any `mcp_servers[].authentication` block which governs the **outbound** leg (gateway → upstream MCP server). Populate `jwks_info` whenever the prompt supplies an IdP tenant + audience, even when the upstream server uses OAuth/DCR or "does not accept bearer tokens" — those statements describe the outbound leg only.

| Field | Type | Target env | Rationale (from artifact) |
|---|---|---|---|
| `jwt_algorithm` | enum: `HS256`/`HS384`/`HS512`/`RS256`/`RS384`/`RS512`/`ES256`/`ES384`/`ES512` | `JWT_ALGORITHM` | Choose the algorithm your identity provider uses to sign tokens — HS256 for symmetric secrets, RS256 for asymmetric JWKs. |
| `jwt_jwks_uri` | URL | `JWT_JWKS_URI` | Set to the JWKS URL your identity provider publishes; the gateway fetches public keys from here to validate incoming tokens. |
| `jwt_issuer` | string | `JWT_ISSUER` | Set to the `iss` claim your provider emits; the gateway rejects tokens whose `iss` does not match. |
| `jwt_audience` | string | `JWT_AUDIENCE` | Set to the `aud` claim the provider targets at this gateway; prevents tokens meant for other services from being accepted. |

#### `gateway.ssrf` — strict-by-default

Strict defaults block localhost, private networks, and fail-closed DNS when omitted.

| Field | Type | deployDefault | Rationale (from artifact) |
|---|---|---|---|
| `allow_localhost` | boolean | `false` | Enable only for local development where the MCP server runs on the same host as the gateway; leaving it on in production widens the gateway's outbound attack surface. |
| `allow_private_networks` | boolean | `false` | Enable only when the gateway and MCP server share a private network (e.g. co-located on one EC2 host); prefer `allowed_networks` with a surgical CIDR allowlist in production, since a blanket private-range allow widens the gateway's outbound attack surface. |
| `allowed_networks` | array<string> | `[]` | Set to the specific CIDRs your MCP servers live on when the gateway must reach private hosts — prefer this surgical allowlist over the blanket `allow_private_networks=true`, since every range you add widens the gateway's outbound attack surface. |

#### `gateway.advanced` and `gateway.log_level`

- **`advanced`** — `array<string>`, `targetKind: advanced`. Lines are appended verbatim to the deployed env file under systemd `EnvironmentFile` semantics (last-occurrence-wins). Validation rejects keys already emitted by a typed field, so it cannot shadow a typed field by accident. Keys here are case-sensitive — preserve exact casing.
- **`log_level`** — enum: `TRACE`/`DEBUG`/`INFO`/`WARNING`/`ERROR`/`CRITICAL`. `deployDefault`: `DEBUG`. Target: `LOG_LEVEL`.

#### `mcp_servers[]` — required and optional top-level fields

| Field | Required | Type | Target | Notes (from artifact) |
|---|---|---|---|---|
| `name` | yes | string | `sotw.name` | A short memorable identifier shown in the d2 UI. |
| `description` | no | string | `sotw.description` | One-line summary so end users know what this server offers. |
| `url` | yes | URL | `sotw.url` | Where the gateway forwards MCP requests for this server. |
| `transport_type` | no | enum: `sse`/`streamable_http`/`streamablehttp`/`http` | `sotw.transport` | `http` for most servers; `sse` only when the server explicitly requires server-sent events. |
| `refresh_interval_seconds` | no | integer | `sotw.refresh_interval_seconds` | How often the gateway re-fetches the server's tool list. Raise when the list changes rarely, lower when it changes often. |
| `visibility` | no | enum: `public`/`team`/`private` | `sotw.visibility` | `public` lists the server to everyone; `team` lists to your tenant only; `private` hides it from discovery. |
| `owner_email` | no | email | `sotw.owner_email` | Who to contact when this server breaks. |

#### `mcp_servers[].authentication` — variants

Discriminated union keyed on `type`. `requiredFields[]` lists fields that MUST appear in the YAML for each variant (always includes `type` itself).

| `type` | Required fields | Notes |
|---|---|---|
| `bearer` | `type`, `token` | Static bearer token in `Authorization` header. |
| `basic` | `type`, `username`, `password` | HTTP basic auth. |
| `authheaders` | `type`, `headers` | Array of `{key, value}` header pairs; each pair both required. |
| `query_param` | `type`, `param_key`, `param_value` | Auth via URL query parameter. |
| `oauth` | `type`, `grant_type`, `scopes` | See the cross-field constraint below — `issuer`-OR-trio rule. |
| `cert` | `type`, `ca_cert` | PEM-encoded CA cert; used for custom-CA / mTLS / self-signed. |
| `none` | `type` | Explicitly disabled auth. |

#### OAuth variant — fields and the load-bearing cross-field rule

**Cross-field constraint** (verbatim from artifact):
> OAuth requires either `issuer` or all of `client_id`, `client_secret`, and `token_url`

In other words: a valid `oauth` block must satisfy one of these two shapes:

- **DCR shape:** `issuer` is set. `client_id`, `client_secret`, and `token_url` may be omitted — the gateway discovers/registers them.
- **Static-credentials shape:** `client_id` AND `client_secret` AND `token_url` are all set. `issuer` is not required.

Setting some but not all of `client_id` / `client_secret` / `token_url` without `issuer` is invalid. Both shapes still require `type: oauth`, `grant_type`, and `scopes`.

| Field | Required | Type | Rationale (from artifact) |
|---|---|---|---|
| `grant_type` | yes (variant) | string | Pick the OAuth grant the upstream server supports — `client_credentials` for machine-to-machine, `authorization_code` for delegated user auth. |
| `scopes` | yes (variant) | array<string> | Scopes the gateway requests from the provider; match the provider's documented scope strings. |
| `issuer` | conditional | URL | Set to enable dynamic client registration — the gateway discovers token/authorize URLs and registers itself automatically. |
| `client_id` | conditional | string | The OAuth client identifier the upstream server issued you. Omit to let the gateway register dynamically (requires `issuer`). |
| `client_secret` | conditional | string, **secret** | The OAuth client secret paired with `client_id`. Omit for public clients or when using DCR. |
| `token_url` | conditional | URL | The token endpoint the gateway posts to. Omit when `issuer` is set — DCR will discover it. |
| `authorization_url` | no | URL | The authorize endpoint for delegated user flows. Omit for non-interactive grants like `client_credentials`. |
| `redirect_uri` | no | URL | Callback URL the upstream server redirects back to after user consent. |
| `pkce_enabled` | no | boolean | Enable for public clients where leaking the `client_secret` is a risk. |

#### Secret-typed fields — must emit a placeholder, never a literal

Every field marked `secret: true` in the artifact. Emit a self-describing placeholder (`REPLACE_WITH_<FIELD>`, `PLACEHOLDER_<FIELD>`, `YOUR_<FIELD>`, `CHANGE_ME`, or `${ENV_VAR}`); never an inferred or literal credential. Bare `PLACEHOLDER` does not count.

| Path |
|---|
| `mcp_servers[].authentication (bearer).token` |
| `mcp_servers[].authentication (basic).password` |
| `mcp_servers[].authentication (authheaders).headers[].value` |
| `mcp_servers[].authentication (query_param).param_value` |
| `mcp_servers[].authentication (oauth).client_secret` |

#### `target` / `targetKind` — where values land

- **`targetKind: envVar`** — value is written to the deployed env file under the named `target` (e.g. `MCP_REQUIRE_AUTH`, `JWT_AUDIENCE`, `SSRF_ALLOWED_NETWORKS`, `LOG_LEVEL`).
- **`targetKind: sotwPath`** — value is written into the SOTW YAML at the named dotted path (e.g. `sotw.url`, `sotw.oauth_config.client_secret`). All `mcp_servers[]` fields land here.
- **`targetKind: advanced`** — only `gateway.advanced`. Lines are **appended verbatim** to the deployed env file; the parser does not validate keys here. Case-sensitive; the user owns correctness.

<!-- END SCHEMA DIGEST -->

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
