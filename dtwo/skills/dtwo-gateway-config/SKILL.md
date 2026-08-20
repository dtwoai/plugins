---
name: dtwo-gateway-config
description: |
  Manage Dtwo gateway YAML configuration and MCP server definitions: edit, validate, save draft, publish, deploy, and roll back.
  TRIGGER when: user says "add/remove/edit MCP server", "gateway config/YAML", "change gateway auth/JWKS/SSRF/CORS",
  "publish/revert gateway config", "deploy gateway" after a config change; or wants to inspect/list gateway versions.
  SKIP when: task is writing or explaining Rego (use dtwo-policy-rego); task is attaching/detaching policies
  on a pipeline or pinning policy versions (use dtwo-gateway-policy).
---

<!-- © 2026 Dtwo, Inc. -->

# Dtwo Gateway & MCP Server Configuration

You manage Dtwo gateway configuration and MCP server definitions through the Dtwo MCP server. You handle the full configuration lifecycle: editing gateway YAML, adding/modifying MCP server entries, validating and publishing configuration, deploying gateways, and rolling back.

## Companion skills

This skill is typically used alongside others. Invoke them via the `Skill` tool when the task crosses boundaries (in other agents, use your host's equivalent skill-loading mechanism):

- **dtwo-gateway-policy** — load when the task also involves attaching/detaching policies on a pipeline or managing policy lifecycle (e.g., add a new MCP server and attach a policy in the same session).
- **dtwo-policy-rego** — load when the task also requires writing or modifying Rego; typically loaded via `dtwo-gateway-policy` rather than directly alongside this skill.
- **setup** (the guided first-time setup skill, invoked as `/dtwo:setup`) — for a first-time user standing up their first gateway from scratch; it orchestrates the full onboarding journey and hands the config-editing step back to this skill.

## Prerequisites

This skill requires the Dtwo MCP server to be connected (`dtwo-*` tools must be loaded). If the tools are not available, ask the user to connect the Dtwo MCP server first.

The tools listed below reflect the initial set. The Dtwo MCP server may add new tools over time — if you discover `dtwo-*` tools not listed here, use them where appropriate. Prefer newer, more specific tools over workarounds when available.

**Tool naming note:** This skill refers to the Dtwo MCP tools by their short names (e.g., `dtwo-list-gateways`). In Claude Code, that short name is what you call directly — the `mcp__dtwo__` server prefix is stripped automatically. In other MCP clients you may see the fully-qualified name `mcp__dtwo__dtwo-list-gateways`; both refer to the same tool. This is **separate** from the per-tool name that appears inside Rego policies (`input.payload.name`) — see the companion `dtwo-policy-rego` instructions for that.

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

## Communicating with the User

The steps above (tool names, YAML field names, the validate → save → publish → deploy sequence) are internal mechanics for you to follow — they are not vocabulary for talking to the user. Do the right technical steps behind the scenes; describe them to the user in plain, outcome-focused language.

- **Don't narrate internal mechanics.** Never say things like "I'll call `dtwo-validate-gateway-config` then `dtwo-save-gateway-draft-config`," or reference YAML field names, gateway UIDs, or tool names in conversation. Say what you're doing and why it matters to them: "I'm adding GitHub access to your gateway and will check it's configured correctly before saving it as a draft."
- **Translate protocol jargon when a decision needs the user's input.** If a choice genuinely requires their input (e.g., which authentication method to use), don't ask them to pick between "bearer token" vs "OAuth with dynamic client registration." Frame it around what they'd recognize: "Do you want to authenticate with a personal access token you paste in, or a sign-in flow?" Only use the technical term in parentheses as a secondary reference, and only if it helps a technical user confirm you mean the right thing.
- **Keep deploy/status updates outcome-level.** Report deployment progress as "deploying now, this usually takes under a minute" rather than describing polling loops, task UIDs, or transient error codes (like 502s during a restart) unless something is actually stuck and the user needs to know why, or they explicitly ask for the detail.
- **Surface technical detail on request, not by default.** If the user asks "what auth type did you use" or "show me the YAML," give the precise technical answer. Default conversation should stay non-technical; go deeper only when asked or when a real decision hinges on a technical distinction they need to understand to choose correctly.
- **Exception: technical audiences.** If the user has been using precise technical vocabulary themselves (tool names, YAML syntax, protocol terms), mirror their register — this guidance is about protecting non-technical users from unnecessary jargon, not about dumbing down conversations with engineers who want the detail.

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
| `dtwo-revert-gateway-config` | Restore a published `version` back into the draft. Pass `publish: true` to publish it immediately as well |

### Deploy & Status Tools

| Tool | Purpose |
|------|---------|
| `dtwo-deploy-gateway` | Queue a deployment for the gateway |
| `dtwo-get-gateway-deployments` | List deployment tasks for a gateway |
| `dtwo-get-deployment` | Check status of a specific deployment |

### Deletion (not supported via MCP)

The Dtwo MCP server does not expose a `delete-gateway` tool. `revert-gateway-config` restores a prior version — it does **not** delete.

Deleting a gateway must be done via the **Dtwo web UI**. If a `dtwo-delete-gateway` tool later appears (see the tool-discovery note under Prerequisites), prefer it over the UI.

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
| `gateway.authentication.jwks_info` | Inbound JWT validation parameters. All 4 fields required when this object is present. |
| `gateway.authentication.oauth_dcr` | OAuth Dynamic Client Registration overrides. Defaults are auto-derived from mcp_servers; set fields here to override (typically to disable DCR/discovery for IdPs that pre-provision clients). |
| `gateway.ssrf` | SSRF protection overrides. Strict defaults apply when omitted. |
| `gateway.intent` | Gateway session-intent controls. |
| `gateway.session_control` | Human-gated session clearing (session-control) registration: the IdP app the browser ceremony authenticates against. Arms the platform clear tools and the browser clear ceremony when `intent.enabled: true`, or when `clearing.enabled: true` on a gateway that uses markers without intent capture. The ceremony issuer is not configured here — it is always `gateway.authentication.jwks_info.jwt_issuer` (the same tenant issues both the inbound tokens and the browser-login ID tokens), and the deploy derives `SESSION_CONTROL_ISSUER` from it. |
| `gateway.session_control.clearing` | Arming control for human-gated clearing. |
| `mcp_servers[]` | One entry per upstream MCP server. `name` and `url` required. |
| `mcp_servers[].authentication` | Discriminated union keyed on `type`; outbound auth from gateway to the upstream server. 7 variants (see table). |
| `mcp_servers[].authentication (bearer)` | Fields for `type: bearer`. Static bearer token in the `Authorization` header. |
| `mcp_servers[].authentication (basic)` | Fields for `type: basic`. HTTP basic auth. |
| `mcp_servers[].authentication (authheaders)` | Fields for `type: authheaders`. Array of `{key, value}` header pairs. |
| `mcp_servers[].authentication (authheaders).headers[]` | Each element of `mcp_servers[].authentication (authheaders).headers`. |
| `mcp_servers[].authentication (query_param)` | Fields for `type: query_param`. Auth via a URL query parameter. |
| `mcp_servers[].authentication (oauth)` | Fields for `type: oauth`. Governed by the `issuer`-OR-trio cross-field rule. |
| `mcp_servers[].authentication (cert)` | Fields for `type: cert`. PEM-encoded CA cert; custom-CA / mTLS / self-signed. |

Reading the **`Default`** column in the tables below: `` `value` (schema) ``, `` `value` (deploy) `` and `` `value` (gateway) `` are defaults the artifact declares — filled by the schema itself, by deploy-time config, or applied by the gateway at runtime when the deployed env leaves the field unset. **`not declared`** marks an optional field whose default the artifact does not record — the gateway still decides at runtime, but unlike `(gateway)` the value does not travel in this table; read the Guidance column, which states the effective behavior where the artifact records it. **`—`** marks a required field with no declared default — you must supply a value.

Reading the **`Required`** column: required-ness is *within the containing section*. `yes` means the field must appear whenever that section's object is present; if the parent object is itself optional, the whole block may be omitted and the field with it.

#### `gateway.authentication` — load-bearing defaults & constraints

- **`enabled`** — `schemaDefault: true`. Type `boolean`. Target env var: `MCP_REQUIRE_AUTH`. **When omitted, the gateway authenticates incoming requests.** Set `false` only for local development.
- **`sso_issuer`** — optional `URL`. Metadata-only; does NOT validate tokens by itself. Target: `SSO_GENERIC_ISSUER`.
- **`sso_generic_scope`** — optional `string`. Ignored unless `sso_issuer` is set. Target: `SSO_GENERIC_SCOPE`.

Every field in this section, with the artifact's own guidance:

| Field | Required | Type | Default | Target | Guidance (from artifact) |
|---|---|---|---|---|---|
| `enabled` | yes | boolean | `true` (schema) | `MCP_REQUIRE_AUTH` | Leave at the default `true` for production. Set `false` only for local development where you want an unauthenticated gateway. |
| `sso_issuer` | no | URL | `not declared` | `SSO_GENERIC_ISSUER` | Set when you're using an SSO provider that publishes an OpenID Connect discovery document at `{issuer}/.well-known/openid-configuration`. Only set an issuer you want advertised: MCP clients will follow it for OAuth discovery. |
| `jwt_issuer_verification` | no | boolean | `true` (gateway) | `JWT_ISSUER_VERIFICATION` | Leave unset or `true` — the gateway defaults it to `true` and refuses to start with `false` whenever `jwks_info` is configured, because skipping issuer verification against external IdP keys enables token substitution; the schema rejects `false` for the same reason. Set `true` explicitly to pin the secure value against a future change in the gateway default, not to make a choice. |
| `jwt_audience_verification` | no | boolean | `true` (gateway) | `JWT_AUDIENCE_VERIFICATION` | Leave unset or `true` — the gateway defaults it to `true` and refuses to start with `false` whenever `jwks_info` is configured, since a token minted for another service in the same tenant would otherwise be accepted here; the schema rejects `false` for the same reason. Set `true` explicitly to pin the secure value against a future change in the gateway default, not to make a choice. |
| `require_jti` | no | boolean | `true` (gateway) | `REQUIRE_JTI` | The gateway defaults this to `true`, so omitting it rejects every request from Auth0 or Entra ID with "Token is missing required JTI claim" — neither IdP mints a `jti` on access tokens. Set `false` for those, and for any other IdP whose tokens lack `jti`; stay at the `true` default only when your IdP emits one and you rely on per-token revocation, since a `jti`-less token cannot be revoked individually. |
| `require_token_expiration` | no | boolean | `true` (gateway) | `REQUIRE_TOKEN_EXPIRATION` | The gateway defaults this to `true`, so omitting it already rejects tokens carrying no `exp` claim, which never age out — the setup runbooks set it explicitly only to state that posture. Set `false` only for a short-lived local experiment against an IdP that mints non-expiring tokens, and revert before the gateway sees real traffic. |
| `mcp_oauth_resource_metadata_enabled` | no | boolean | `not declared` | `MCP_OAUTH_RESOURCE_METADATA_ENABLED` | The gateway defaults this to `false`, so discovery is off unless something turns it on. Set `true` when spec-compliant MCP clients must find your authorization server automatically and you have no `sso_issuer` — without it, 401 responses carry no `resource_metadata` URL and the client has nowhere to begin the OAuth flow. With `sso_issuer` set the deploy turns it on for you, so leave it unset there; set `false` to override that and stop advertising the issuer to clients you configure out of band. |
| `sso_generic_scope` | no | string | `not declared` | `SSO_GENERIC_SCOPE` | Set to the OAuth scope your SSO provider requires (e.g. `openid profile email`). Ignored when `sso_issuer` is not set. |

**Cross-field constraints** (verbatim from artifact):
> When authentication is enabled (the default), `jwks_info` must be configured. `sso_issuer` alone is metadata-only and does not validate tokens.
>
> When authentication is enabled (the default) and `jwks_info` is configured, `jwt_issuer_verification` and `jwt_audience_verification` cannot be false — the gateway refuses to start. Omit them to take the secure default.

#### `gateway.authentication.jwks_info` — inbound JWT validation

All 4 fields are required when this object is present. These govern the **inbound** leg (clients → gateway), independent of any `mcp_servers[].authentication` block which governs the **outbound** leg (gateway → upstream MCP server). Populate `jwks_info` whenever the prompt supplies an IdP tenant + audience, even when the upstream server uses OAuth/DCR or "does not accept bearer tokens" — those statements describe the outbound leg only.

| Field | Required | Type | Target env | Rationale (from artifact) |
|---|---|---|---|---|
| `jwt_algorithm` | yes | enum: `HS256`/`HS384`/`HS512`/`RS256`/`RS384`/`RS512`/`ES256`/`ES384`/`ES512` | `JWT_ALGORITHM` | Set to the asymmetric algorithm your identity provider signs with — RS256 for most (Auth0, Entra), ES256 for elliptic-curve tenants. The HS256/HS384/HS512 values are symmetric and are rejected here: `jwks_info` always implies a JWKS endpoint, which publishes public keys only, and the gateway refuses to start on that combination. |
| `jwt_jwks_uri` | yes | URL | `JWT_JWKS_URI` | Set to the JWKS URL your identity provider publishes; the gateway fetches public keys from here to validate incoming tokens. Must begin with a lowercase `https://` — the gateway rejects every other scheme, `file://` included, as an SSRF and key-substitution vector, and refuses to start. |
| `jwt_issuer` | yes | string | `JWT_ISSUER` | Set to the `iss` claim your provider emits; the gateway rejects tokens whose `iss` does not match. Use the `https://` form — the gateway dereferences this URL for `/userinfo` token introspection and refuses to start on `http://`. Auth0 issuers carry a trailing slash and the comparison is exact, so `https://tenant.us.auth0.com/` and `https://tenant.us.auth0.com` are different values. |
| `jwt_audience` | yes | string | `JWT_AUDIENCE` | Set to the `aud` claim the provider targets at this gateway; prevents tokens meant for other services from being accepted. |

**Cross-field constraints** (verbatim from artifact):
> When authentication is enabled (the default), `jwt_jwks_uri` must begin with a lowercase "https://" — the gateway rejects every other scheme, "file://" included, as an SSRF and key-substitution vector, and refuses to start.
>
> When authentication is enabled (the default), `jwt_algorithm` cannot be HS256, HS384 or HS512 — a JWKS endpoint publishes public keys, which only verify asymmetric signatures, so the gateway refuses to start. Use RS256 or ES256.
>
> When authentication is enabled (the default), `jwt_issuer` cannot begin with "http://" — the gateway dereferences it for /userinfo token introspection and refuses to start rather than send a bearer token in cleartext.

#### `gateway.authentication.oauth_dcr` — DCR and discovery overrides

OAuth Dynamic Client Registration overrides. Defaults are auto-derived from mcp_servers; set fields here to override (typically to disable DCR/discovery for IdPs that pre-provision clients).

| Field | Required | Type | Default | Target | Guidance (from artifact) |
|---|---|---|---|---|---|
| `dcr_enabled` | no | boolean | `not declared` | `DCR_ENABLED` | Set `false` when your IdP (e.g. Entra ID) does not support DCR and OAuth clients are pre-provisioned out of band; leave unset to inherit the default driven by `mcp_servers[*].authentication.issuer`. |
| `auto_register_on_missing_credentials` | no | boolean | `not declared` | `DCR_AUTO_REGISTER_ON_MISSING_CREDENTIALS` | Set `false` to require pre-provisioned client credentials and fail closed when they are missing. |
| `oauth_discovery_enabled` | no | boolean | `not declared` | `OAUTH_DISCOVERY_ENABLED` | Set `false` when the upstream IdP does not publish authorization-server metadata (common with config-only Entra deployments). |

#### `gateway.ssrf` — strict-by-default

Strict defaults block localhost, private networks, and fail-closed DNS when omitted.

| Field | Type | deployDefault | Target | Rationale (from artifact) |
|---|---|---|---|---|
| `allow_localhost` | boolean | `false` | `SSRF_ALLOW_LOCALHOST` | Enable only for local development where the MCP server runs on the same host as the gateway; leaving it on in production widens the gateway's outbound attack surface. |
| `allow_private_networks` | boolean | `false` | `SSRF_ALLOW_PRIVATE_NETWORKS` | Enable only when the gateway and MCP server share a private network (e.g. co-located on one EC2 host); prefer `allowed_networks` with a surgical CIDR allowlist in production, since a blanket private-range allow widens the gateway's outbound attack surface. |
| `allowed_networks` | array<string> | `[]` | `SSRF_ALLOWED_NETWORKS` | Set to the specific CIDRs your MCP servers live on when the gateway must reach private hosts — prefer this surgical allowlist over the blanket `allow_private_networks=true`, since every range you add widens the gateway's outbound attack surface. |

#### `gateway.advanced` and `gateway.log_level`

- **`advanced`** — `array<string>`, `targetKind: advanced`. Lines are appended verbatim to the deployed env file under systemd `EnvironmentFile` semantics (last-occurrence-wins). Validation rejects two classes of keys: keys already emitted by a typed field (so it cannot shadow one by accident) AND every name on the reserved-keys list below. Keys here are case-sensitive — preserve exact casing.
- **`log_level`** — enum: `TRACE`/`DEBUG`/`INFO`/`WARNING`/`ERROR`/`CRITICAL`. `deployDefault`: `DEBUG`. Target: `LOG_LEVEL`.

#### Reserved keys — rejected inside `gateway.advanced`

Validation rejects each of these 54 env-var names when written into `gateway.advanced`, in two groups.

Owned by a typed config field — set the field instead of the raw env line:

| Reserved key | Configure via |
|---|---|
| `DCR_AUTO_REGISTER_ON_MISSING_CREDENTIALS` | `gateway.authentication.oauth_dcr.auto_register_on_missing_credentials` |
| `DCR_ENABLED` | `gateway.authentication.oauth_dcr.dcr_enabled` |
| `JWT_ALGORITHM` | `gateway.authentication.jwks_info.jwt_algorithm` |
| `JWT_AUDIENCE` | `gateway.authentication.jwks_info.jwt_audience` |
| `JWT_AUDIENCE_VERIFICATION` | `gateway.authentication.jwt_audience_verification` |
| `JWT_ISSUER` | `gateway.authentication.jwks_info.jwt_issuer` |
| `JWT_ISSUER_VERIFICATION` | `gateway.authentication.jwt_issuer_verification` |
| `JWT_JWKS_URI` | `gateway.authentication.jwks_info.jwt_jwks_uri` |
| `LOG_LEVEL` | `gateway.log_level` |
| `MCP_OAUTH_RESOURCE_METADATA_ENABLED` | `gateway.authentication.mcp_oauth_resource_metadata_enabled` |
| `MCP_REQUIRE_AUTH` | `gateway.authentication.enabled` |
| `OAUTH_DISCOVERY_ENABLED` | `gateway.authentication.oauth_dcr.oauth_discovery_enabled` |
| `REQUIRE_JTI` | `gateway.authentication.require_jti` |
| `REQUIRE_TOKEN_EXPIRATION` | `gateway.authentication.require_token_expiration` |
| `SESSION_CONTROL_CLIENT_ID` | `gateway.session_control.client_id` |
| `SSO_GENERIC_ISSUER` | `gateway.authentication.sso_issuer` |
| `SSO_GENERIC_SCOPE` | `gateway.authentication.sso_generic_scope` |
| `SSRF_ALLOWED_NETWORKS` | `gateway.ssrf.allowed_networks` |
| `SSRF_ALLOW_LOCALHOST` | `gateway.ssrf.allow_localhost` |
| `SSRF_ALLOW_PRIVATE_NETWORKS` | `gateway.ssrf.allow_private_networks` |

Platform-managed — the platform sets these; not configurable through this config at all:

`ALLOWED_ORIGINS`, `AUDIT_TRAIL_ENABLED`, `AUTH_ENCRYPTION_SECRET`, `AUTH_REQUIRED`, `AUTO_REFRESH_SERVERS`, `CACHE_TYPE`, `D2_TENANT_ID`, `DATABASE_URL`, `DISABLE_ACCESS_LOG`, `EMAIL_AUTH_ENABLED`, `ENVIRONMENT`, `GUNICORN_WORKERS`, `HEARTBEAT_ENABLED`, `HEARTBEAT_INTERVAL_SECONDS`, `JWT_REQUIRED_ORG_ID`, `JWT_SECRET_KEY`, `MCPGATEWAY_ADMIN_API_ENABLED`, `MCPGATEWAY_UI_ENABLED`, `PLATFORM_ADMIN_EMAIL`, `PLATFORM_ADMIN_PASSWORD`, `PLUGINS_CONFIG_FILE`, `PLUGINS_ENABLED`, `PULSE_DEBOUNCE_SECONDS`, `PULSE_ENABLED`, `PULSE_EVENT_DRIVEN_ENABLED`, `PULSE_INTERVAL_SECONDS`, `SECURITY_HEADERS_ENABLED`, `SESSION_CONTROL_ISSUER`, `SOTW_ENABLED`, `SOTW_FILE_PATH`, `SSRF_DNS_FAIL_CLOSED`, `STRUCTURED_LOGGING_DATABASE_ENABLED`, `TRANSPORT_TYPE`, `WELL_KNOWN_ALLOW_HTTP`

#### `gateway.intent` — session-intent capture

Gateway session-intent controls.

| Field | Required | Type | Default | Target | Guidance (from artifact) |
|---|---|---|---|---|---|
| `enabled` | no | boolean | `false` (deploy) | `platform.intent.enabled` | Turn on when you want intent-aware policies to have real values to read. Capture alone never denies a call — but it arms the egress closed-pipeline gate for `set_intent`: customer egress denies, transforms, and marker writes stop applying to that one tool (needed so a customer deny on the set_intent response cannot block the client while the platform capture policy has already committed the intent to session state). Customer INGRESS policies still govern `set_intent` unless `required: true` is also on. No `mcp_servers[]` configuration is needed — the platform intent server is deployed inside the gateway container and injected automatically. |
| `required` | no | boolean | `false` (deploy) | `platform.intent.required` | Turn on when your intent registry and workflows are settled. Requires `enabled: true` — a gate with no capture policy would deny every call forever. Also arms the INGRESS closed-pipeline gate for `set_intent`: customer ingress denies/throttles/argument-inspection stop applying to that one tool (needed so a customer default-deny cannot AND against intent_required and lock the agent out of `set_intent`). Availability note: while on, the gate fails closed, so an intent-server outage blocks the entire tool surface (only `set_intent` stays reachable). A transient OPA/registry blip self-heals — `set_intent` returns a retryable `registry_unavailable` rather than locking permanently — but to recover from a sustained intent-server outage, set `required: false` and redeploy. |

**Cross-field constraint** (verbatim from artifact):
> `required: true` requires `enabled: true` (a required gate needs the capture policy to write intent).

#### `gateway.session_control` — human-gated clearing registration

Human-gated session clearing (session-control) registration: the IdP app the browser ceremony authenticates against. Arms the platform clear tools and the browser clear ceremony when `intent.enabled: true`, or when `clearing.enabled: true` on a gateway that uses markers without intent capture. The ceremony issuer is not configured here — it is always `gateway.authentication.jwks_info.jwt_issuer` (the same tenant issues both the inbound tokens and the browser-login ID tokens), and the deploy derives `SESSION_CONTROL_ISSUER` from it.

| Field | Required | Type | Default | Target | Guidance (from artifact) |
|---|---|---|---|---|---|
| `client_id` | yes | string | — | `SESSION_CONTROL_CLIENT_ID` | Register a dedicated public client at your IdP for the clear ceremony (authorization-code + PKCE, no refresh grant) and paste its client id here. Do not reuse the gateway API client. |

**Cross-field constraints** (verbatim from artifact):
> `clearing.enabled` unset follows `gateway.intent.enabled`; an explicit `true` arms clearing even with intent capture off (the markers-only deployment).
>
> `clearing.enabled: false` while `gateway.intent.enabled: true` is rejected (clearing cannot be withdrawn where markers can block).
>
> While clearing is armed, `gateway.authentication` must be enabled with `jwks_info` — the ceremony binds every clear to the authenticated caller identity, so an unauthenticated inbound leg has nothing to bind.
>
> While clearing is armed, `jwt_issuer` must be a normalized HTTPS URL (it becomes the ceremony issuer via `SESSION_CONTROL_ISSUER`) and `jwt_audience` must not be blank.

#### `gateway.session_control.clearing` — arming control

Arming control for human-gated clearing.

| Field | Required | Type | Default | Target | Guidance (from artifact) |
|---|---|---|---|---|---|
| `enabled` | no | boolean | `not declared` | `platform.session_control.clearing.enabled` | Leave unset in almost all cases — clearing arms automatically wherever intent capture is on and this block is configured. Set `true` explicitly on a gateway that runs marker-writing policies WITHOUT intent capture, which otherwise has no targeted clear path and can only wait for a marker to expire. |

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

| Field | Required | Type | Target | Rationale (from artifact) |
|---|---|---|---|---|
| `grant_type` | yes (variant) | string | `sotw.oauth_config.grant_type` | Pick the OAuth grant the upstream server supports — `client_credentials` for machine-to-machine, `authorization_code` for delegated user auth. |
| `scopes` | yes (variant) | array<string> | `sotw.oauth_config.scopes` | Scopes the gateway requests from the provider; match the provider's documented scope strings. |
| `issuer` | conditional | URL | `sotw.oauth_config.issuer` | Set to enable dynamic client registration — the gateway discovers token/authorize URLs and registers itself automatically. |
| `client_id` | conditional | string | `sotw.oauth_config.client_id` | The OAuth client identifier the upstream server issued you. Omit to let the gateway register dynamically (requires `issuer`). |
| `client_secret` | conditional | string, **secret** | `sotw.oauth_config.client_secret` | The OAuth client secret paired with `client_id`. Omit for public clients or when using DCR. |
| `token_url` | conditional | URL | `sotw.oauth_config.token_url` | The token endpoint the gateway posts to. Omit when `issuer` is set — DCR will discover it. |
| `authorization_url` | no | URL | `sotw.oauth_config.authorization_url` | The authorize endpoint for delegated user flows. Omit for non-interactive grants like `client_credentials`. |
| `redirect_uri` | no | URL | `sotw.oauth_config.redirect_uri` | Callback URL the upstream server redirects back to after user consent. |
| `pkce_enabled` | no | boolean | `sotw.oauth_config.pkce_enabled` | Enable for public clients where leaking the `client_secret` is a risk. |

#### Non-OAuth variant fields — where each one lands

Required-ness here is *within the variant*: the field must appear when that `type` is chosen.

| Variant | Field | Required | Type | Target |
|---|---|---|---|---|
| `bearer` | `token` | yes | string | `sotw.auth_token` |
| `basic` | `username` | yes | string | `sotw.auth_username` |
| `basic` | `password` | yes | string | `sotw.auth_password` |
| `authheaders` | `headers` | yes | array<object> | `sotw.auth_headers` |
| `authheaders` | `headers[].key` | yes | string | `sotw.auth_headers[].key` |
| `authheaders` | `headers[].value` | yes | string | `sotw.auth_headers[].value` |
| `query_param` | `param_key` | yes | string | `sotw.auth_query_param_key` |
| `query_param` | `param_value` | yes | string | `sotw.auth_query_param_value` |
| `cert` | `ca_cert` | yes | string | `sotw.ca_certificate` |

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

- **`targetKind: advanced`** — only `gateway.advanced`. Lines are **appended verbatim** to the deployed env file; the parser does not validate keys here. Case-sensitive; the user owns correctness.
- **`targetKind: envVar`** — value is written to the deployed env file under the named `target` (e.g. `MCP_REQUIRE_AUTH`, `JWT_AUDIENCE`, `SSRF_ALLOWED_NETWORKS`, `LOG_LEVEL`).
- **`targetKind: platform`** — value is applied as a platform-side control at the named `platform.*` path rather than written to the gateway env file.
- **`targetKind: sotwPath`** — value is written into the SOTW YAML at the named dotted path (e.g. `sotw.url`, `sotw.oauth_config.client_secret`). Read the `Target` column per field; do not infer a field's target from its section.

<!-- schema-reference.json sha256:7da03dec3c066d3ca74a9a25173017dd63b0e8a04eea167dce3eec4ae19fad1d -->

<!-- END SCHEMA DIGEST -->

### Gateway Section

Controls authentication, SSRF protection, `log_level`, `advanced` flags, DCR / discovery overrides, and session-intent and human-gated clearing — all documented in the Schema Digest above. (CORS is also modeled by the parser but is not detailed in the digest; configure it via the `advanced` escape hatch or confirm the field names with `dtwo-validate-gateway-config` before relying on them.) Authentication and SSRF are the load-bearing ones and are expanded below.

- **Authentication** defaults to enabled when omitted. Every field in `gateway.authentication` — including the token-validation flags (`jwt_issuer_verification`, `jwt_audience_verification`, `require_jti`, `require_token_expiration`, `mcp_oauth_resource_metadata_enabled`) — is listed in the Schema Digest above with its target, its default, and the schema's own guidance on when to set it. Read the table there rather than guessing from this summary; most of those flags carry a gateway-applied default (their Default column reads `` `true` (gateway) ``), and where the artifact declares none (`mcp_oauth_resource_metadata_enabled` reads `not declared`) the Guidance column states the effective value.
- **Gateway-side `jwks_info` is independent of any `mcp_servers[].authentication` block.** When the prompt supplies an IdP tenant and audience (e.g. Auth0), populate `gateway.authentication.jwks_info` (`jwt_algorithm`, `jwt_jwks_uri`, `jwt_issuer`, `jwt_audience`) — even when the upstream MCP server uses OAuth/DCR, and even when the prompt says the upstream server "only supports OAuth" or "does not accept bearer tokens." Those statements describe the outbound leg to the MCP server, not the inbound leg from clients to the gateway.
- **SSRF** defaults to strict (block localhost, block private networks, fail-closed DNS) when omitted. Set `allow_private_networks: true` to permit access to `host.docker.internal` and other private addresses.

### MCP Servers Section

Each server requires `name` and `url`. Optional fields: `description`, `transport_type`, `refresh_interval_seconds`, `visibility`, `owner_email`, and `authentication`.

- `transport_type` — accepted values are `streamablehttp`, `sse`, and `http`. **When generating new configs, always use `streamablehttp`** (one word). The parser also accepts `streamable_http` and normalizes it to `streamablehttp` when writing the file back out, so you may see either form in existing configs.
- `refresh_interval_seconds` — supported but should not normally be set; rely on the gateway default unless the user has a specific reason to override.

Supported authentication types:

| Type | Required Fields |
|------|----------------|
| `bearer` | `token` |
| `basic` | `username`, `password` |
| `authheaders` | `headers` (array of `{key, value}`) |
| `query_param` | `param_key`, `param_value` |
| `oauth` | `grant_type`, `scopes`, plus either `issuer` (for DCR) or `client_id` + `client_secret` + `token_url`. Optional: `authorization_url`, `redirect_uri`, `pkce_enabled`, `extra_authorize_params`, `scope_param_name`, `scope_separator`, `token_response_path`, `token_lifetime_seconds`, `oauth_quirks` |
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
- This skill cannot delete a gateway via the MCP surface — deletion must be done in the Dtwo web UI
- This skill cannot validate or auto-complete keys inside the `advanced` section — those keys are passed through verbatim, so the user is responsible for correctness
- This skill cannot enumerate the MCP tools a server exposes until after the server is deployed and introspected — for tool discovery, see the companion `dtwo-gateway-policy` instructions
