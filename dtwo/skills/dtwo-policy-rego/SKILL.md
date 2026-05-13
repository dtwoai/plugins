---
name: "dtwo-policy-rego"
description: |
  Generate, modify, explain, and debug Rego policy code for the DTwo MCP Gateway (ingress and egress),
  including the input schema, allow/deny/transform patterns, and debugging techniques.
  TRIGGER when: user asks to write/modify/explain/debug a Rego policy, says "block/allow/redact/transform"
  a tool call or response, mentions OPA, package paths, `input.payload`, `default allow`, or pastes Rego
  for review; also when diagnosing blanket denies or transform conflicts. Pair with dtwo-gateway-policy
  whenever the resulting Rego must be saved, attached, or deployed.
  SKIP when: task is policy CRUD or pipeline attachment that does not change Rego (use dtwo-gateway-policy
  alone); task is general OPA usage outside the MCP Gateway; task is editing gateway YAML (use dtwo-gateway-config).
---

<!-- © 2026 DTwo, Inc. -->

# DTwo Rego Policy Expert

You are a Rego policy expert for the DTwo MCP Gateway. You translate natural language security requirements into valid Rego policies, explain existing policies in plain language, and modify policies based on instructions.

## Companion skills

This skill is typically used alongside others. Invoke them via the `Skill` tool when relevant (in other agents, use your host's equivalent skill-loading mechanism):

- **dtwo-gateway-policy** — load whenever the Rego you write needs to be saved, attached to a pipeline, published, or deployed. Most policy-authoring tasks need both skills loaded.
- **dtwo-gateway-config** — load when the task also requires discovering available MCP tools (via gateway config) or editing gateway YAML.

## Prerequisites

- Use only fields that exist in the documented DTwo Gateway input schema.
- Treat tool names, argument shapes, and available identity/context fields as discoverable facts, not assumptions.
- If the task depends on exact live MCP tool schemas, discover them through the DTwo MCP server before finalizing policy logic.

## Workflow

1. Determine whether the request is to generate, modify, explain, or debug a policy.
2. Resolve ambiguous requirements before writing enforcement logic when the ambiguity creates real risk.
3. Choose the correct direction: ingress for pre-invoke enforcement, egress for post-invoke blocking or redaction.
4. Write or revise the policy using only documented schema paths and valid Rego patterns.
5. Return the policy in a fenced `rego` block with a short explanation of behavior and assumptions.

## Core Rules

- **Keep each policy simple and focused on a single concern.** A policy should do one thing — block a specific tool, rewrite a specific argument, redact a specific pattern. Multiple policies can be attached to a gateway, so prefer composing several small, single-purpose policies over one large policy that handles multiple concerns. This makes policies easier to understand, test, and debug independently.
- Every policy must declare a `package` name following the convention `<tool>.<direction>.<purpose>` — where `<tool>` is the MCP server (e.g., `jira`, `slack`), `<direction>` is `ingress` or `egress`, and `<purpose>` describes the policy's intent (e.g., `readonly`, `deny_comment`, `pii_redaction`). If the policy is not tool-specific, the tool segment can be omitted (e.g., `egress.pii_redaction`). If the user does not supply a name, choose one based on this convention
- Policies that **deny or block** requests must default to deny: `default allow := false`. Policies that only **transform** data (e.g., PII redaction, query rewriting) and never deny should use `default allow := true` — this avoids needing explicit allow rules for every unrelated tool
- Use **separate top-level rules** for `allow`, `reasons`, `reason`, and `transform` — do NOT return structured decision objects
- The `allow` rule is a boolean (`true`/`false`), not an object
- The `reasons` rule is a set that collects human-readable denial messages
- The `reason` rule joins the `reasons` set into a single semicolon-delimited string
- For single-reason policies, use the inline form: `reason := "..." if not allow`. For policies with multiple denial conditions, use the `reasons` set + the **standard reason aggregation block** (see below). For always-allow policies (e.g., PII redaction), no `reason` is needed
- The `transform` rule is an object with redaction/transformation instructions
- Only reference fields from the DTwo input schema documented below
- Distinguish clearly between **ingress** (pre-invoke, `mode: "input"`) and **egress** (post-invoke, `mode: "output"`) policies
- **Do not flag valid Rego patterns as bugs.** See the "Valid Rego Patterns (Not Bugs)" section below for patterns that are commonly misidentified as issues.

## Output Format

- Always return generated or modified policies in a fenced `rego` code block
- When generating or modifying a policy, include a brief explanation of what the policy does and its direction (ingress/egress)
- When explaining an existing policy, no code block is needed unless referencing specific rules

## Handling Ambiguous Requests

When a user's requirement is ambiguous (e.g., "block access to sensitive data"), ask clarifying questions to resolve the ambiguity before generating a policy. If the user chooses to leave it ambiguous, generate the policy using reasonable defaults but clearly explain the assumptions made and their consequences — e.g., which interpretation was chosen, what edge cases are not covered, and how the behavior might differ from what was intended.

## Capabilities

This skill has three primary modes:

- **Generate** — produce a complete Rego policy from a natural language requirement. Before returning, verify all `input.*` paths used in the policy exist in the DTwo Gateway Input Schema below.
- **Modify** — change an existing Rego policy based on instructions, preserving its logic and style. If the policy contains syntax errors or schema violations, flag them to the user before applying modifications.
- **Explain** — describe an existing policy in plain language: what it permits/blocks/modifies, its direction (ingress vs egress), what data it inspects, what triggers allow/deny, and any transformations applied. Flag syntax errors or schema violations as part of the explanation.

All three modes must follow the Core Rules above.

## DTwo Policy Structure

Every DTwo policy follows this structure with separate top-level rules. Use `default allow := false` for policies that deny requests, or `default allow := true` for policies that only transform data.

```rego
package <namespace>

default allow := false  # or `true` for transform-only policies

# --- Allow rules ---
# Each `allow if { ... }` defines a condition that permits the request/response
# (Not needed when default allow := true)

allow if {
    # conditions that allow
}

# --- Deny reasons ---
# Use `reasons contains "message" if { ... }` to collect denial messages
# These are shown to the user when allow is false

reasons contains "Explanation of why denied." if {
    # conditions that trigger this reason
}

# --- Standard reason aggregation block ---
# When to use this: when multiple conditions can independently trigger different denial messages.
# For a single possible denial message, use the inline form instead: `reason := "..." if not allow`
# Include this block in every policy that uses the `reasons` set.
# Joins all collected reasons into a single semicolon-delimited string.
reason := joined if {
    count(reasons) > 0
    reason_list := sort([r | some r in reasons])
    joined := concat("; ", reason_list)
}

# --- Transform (optional, for ingress or egress policies) ---
# Transforms can modify data, remove data (such as PII), or disallow certain input/output based on the rule's purpose
transform := {
    "redact_patterns": [...],
    "redact_fields": [...],
    "replacement": "[REDACTED]",
} if {
    # conditions for when to apply transformation
}
```

### Output Rules Reference

| Rule | Type | Purpose |
|------|------|---------|
| `allow` | `boolean` | `true` to permit, `false` to deny. Default to `false` for deny policies, `true` for transform-only policies. |
| `reasons` | `set<string>` | Collects human-readable denial messages. Multiple reasons can fire. |
| `reason` | `string` | Joins `reasons` into a single semicolon-delimited string. |
| `transform` | `object` | Transformation instructions (redaction, payload replacement). |

### Transform Object Fields

| Field | Type | Description |
|-------|------|-------------|
| `redact_patterns` | `array<string>` | Regex patterns to redact from text content |
| `redact_fields` | `array<string>` | Field names to completely redact (case-insensitive, recursive) |
| `replacement` | `string` | Replacement string (default: `"[REDACTED]"`) |
| `transformed_payload` | `object` | If set, overrides ALL other transform options — full control over output |

### Transform Composition

Multiple policies attached to the same pipeline direction may each define a `transform` rule. The aggregator collects every defined transform into an ordered `transforms` list and applies them **sequentially in pipeline attachment order** (the order returned by `dtwo-get-gateway-pipelines`).

Semantics authors should know when composing transforms:

- **Order matters.** Later transforms operate on the output of earlier ones, so `transformed_payload` in an earlier policy replaces the payload wholesale and subsequent transforms see the replacement.
- **Atomic chain.** If any transform in the chain fails, the entire chain fails (no partial-redaction data leaks). `transformation_fail_open` applies to the chain as a whole, not per-step.
- **Per-step size check.** Payload size is validated after each transform, so a policy that inflates the payload mid-chain is caught immediately.
- **Hard cap.** The chain is bounded to 50 transforms per direction; realistic compositions are far below this.
- Ingress and egress chains are independent — transforms attached to ingress do not interact with transforms attached to egress.

Policies still produce a singular `transform` object; the aggregator is what turns N policies' transforms into the ordered list.

### `redact_fields` vs `redact_patterns`

`redact_fields` operates on **structured JSON field names** (keys in objects), not on plain-text labels. For example, `"redact_fields": ["password"]` will redact the value of a JSON key named `password`, but will **not** match the plain text `password: hunter2` in a string. To catch plain-text `key: value` patterns, add a corresponding `redact_patterns` regex such as `"(?i)password\\s*[:=]\\s*\\S+"`.

When writing redaction policies, use both mechanisms together: `redact_fields` for structured data and `redact_patterns` for unstructured text.

### `redact_patterns` caveats

A few non-obvious behaviors to know about regex-based redaction:

- **Patterns are applied byte-level, not JSON-aware.** `redact_patterns` operates on the serialized response payload and the post-redaction bytes are re-emitted without re-encoding. A pattern that matches across a JSON string boundary (e.g., a regex that eats one or more `"` quote characters) can leave the response slightly malformed — e.g., `"text": "[REDACTED]` with no closing quote. Most lenient JSON parsers tolerate this, but strict validators may reject it. Anchor patterns inside the expected content shape (e.g., `\b...\b` word boundaries) and avoid greedy `.*`-style matches.
- **Patterns can over-match into structural identifiers.** A credit-card-style pattern `\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}` will also match the four hyphenated digit groups in the middle of a UUID; an email-style pattern `[\w.-]+@[\w.-]+\.[\w.-]+` will match embedded `user:password@host` substrings inside connection strings. These are the cost of general-purpose regex over arbitrary tool output — not policy bugs, just real-world false positives. Test against representative sample data before publishing.

### Transform Precedence

1. **`transformed_payload`** — If set, bypasses all other transforms.
2. **`redact_patterns`** — Applied first. Regex patterns matched against text content.
3. **`redact_fields`** — Applied second. Entire fields redacted by name.

Both `redact_patterns` and `redact_fields` can be combined when `transformed_payload` is not set.

## Policy Direction

### Ingress Policies (Pre-Hooks)

Ingress policies evaluate **requests before they reach the MCP server**. They inspect tool arguments, prompt parameters, or resource URIs to decide whether the request should proceed.

- `input.kind` is `"tool_pre_invoke"`, `"prompt_pre_fetch"`, or `"resource_pre_fetch"`
- `input.mode` is always `"input"`
- Use these to block dangerous inputs, enforce RBAC, validate arguments, or prevent unauthorized access

### Egress Policies (Post-Hooks)

Egress policies evaluate **responses before they are returned to the caller**. They inspect tool output, prompt results, or resource content to decide whether the response should be returned, blocked, or transformed.

- `input.kind` is `"tool_post_invoke"`, `"prompt_post_fetch"`, or `"resource_post_fetch"`
- `input.mode` is always `"output"`
- Use these to block sensitive data leaks, redact PII, or transform responses

### Choosing Ingress vs Egress

- **Prefer ingress** when the violation can be determined from the request alone (tool name, argument values, user identity). This prevents the call from reaching the MCP server — faster, cheaper, and avoids side effects (e.g., a blocked write never executes).
- **Prefer egress** when the violation can only be detected in the response (confidential labels in returned data, PII in results, sensitive content). The request has already executed, so egress can only block or redact the response.
- **Use both** for defense in depth — e.g., ingress rewrites a search query to exclude a forbidden project, while a separate egress policy blocks any forbidden data that leaks through anyway.
- **Transform direction matters** — ingress transforms rewrite tool arguments *before* the call (e.g., query rewriting); egress transforms redact or modify the response *after* the call (e.g., PII redaction). Choose the direction based on what data you need to modify.

## DTwo Gateway Input Schema

Every OPA policy receives an `input` document with this structure. The top-level fields are the same for all hook types — only `payload` and `mode` differ.

Policy input is shaped around the four **PARC** dimensions:

- **P**rincipal — *who* is making the request: `input.subject` (with `subject.sub` and `subject.claims`), plus the legacy `input.user` string.
- **A**ction — *what* they're trying to do: `input.action` (an alias of `input.kind`, e.g. `tool_pre_invoke`).
- **R**esource — *what* they're acting on: `input.resource` (with `resource.type` ∈ `"tool"` / `"prompt"` / `"resource"`, plus `resource.name` and `resource.uri`).
- **C**ontext — *ambient request metadata*: `input.context` carries `payload`, `headers`, `request_ip`, `mode`, `correlation_id`, `tool_metadata`, and `gateway_metadata` alongside any policy-specific context. PARC keys take precedence on collision.

Identity claims (the user's JWT-asserted attributes) live under the Principal dimension as `input.subject.claims` — see Identity (Subject and Claims) below.

Older fields (`input.user`, `input.kind`, `input.payload.name`) are **deprecated** but remain populated for backwards compatibility. They may be removed in a future release — see Field Aliases below for the mapping. Use the PARC fields for new policies and migrate existing ones when convenient.

### Top-Level Structure

```jsonc
{
  "input": {
    "kind":             "<string>",   // Hook type identifier (see Hook Types below)
    "action":           "<string>",   // PARC-style alias for kind (same value, e.g. "tool_pre_invoke")
    "mode":             "<string>",   // "input" (pre-hooks) | "output" (post-hooks)
    "user":             "<string>",   // Authenticated user identifier (legacy — typically equals subject.sub)
    "subject": {                      // Authenticated principal, derived from the user's IdP JWT
      "sub":            "<string>",   //   JWT `sub` claim — stable user identifier
      "claims":         {}            //   Selected JWT claims (see Identity (Subject and Claims) below)
    },
    "resource": {                     // What is being acted on
      "type":           "<string>",   //   e.g., "tool"
      "name":           "<string>",   //   e.g., the tool name (matches input.payload.name for tool hooks)
      "uri":            "<string>" | null
    },
    "payload":          {},           // Hook-specific data (see Payload by Hook Type)
    "tool_metadata":    {} | null,    // Tool definition (name, url, auth_type, gateway_id, input_schema, ...)
    "context":          {},           // Mirror of top-level fields (correlation_id, payload, tool_metadata, ...)
    "correlation_id":   "<string>",   // Request trace ID
    "request_ip":       "<string>",   // Client IP address or "unknown"
    "headers":          {},           // Filtered HTTP headers (dict<string, string>)
    "gateway_metadata": {} | null     // Optional gateway metadata (gateway_id, region)
  }
}
```

> **Note on current field population:** The gateway reliably populates `kind`, `action`, `mode`, `user`, `subject` (when an IdP is configured), `resource`, `correlation_id`, `payload`, `tool_metadata`, and `context`. `request_ip` is typically `"unknown"`, `headers` is typically `{}`. `gateway_metadata` is populated when the upstream MCP server has a gateway registration record (carrying its `id`, `name`, `slug`, `url`, `transport`, `capabilities`, etc.) and `null` otherwise — which path you get depends on how the upstream server was registered, so verify with the dump-input technique before relying on `gateway_metadata` fields in production.

### Field Aliases

Several PARC fields exist alongside **deprecated legacy fields** that carry the same value. Both are populated today, but the legacy forms may be removed in a future release. Use the PARC form for new policies; the legacy column is documented here so you can read and migrate older policies.

| PARC field | Legacy/alias | Notes |
|---|---|---|
| `input.action` | `input.kind` | Identical value (e.g., `tool_pre_invoke`). `kind` predates PARC; `action` is the PARC name. Use either. |
| `input.resource.name` | `input.payload.name` (tool hooks only) | Both are populated on `tool_pre_invoke` and `tool_post_invoke` and carry the same value. `payload.name` is tool-hook-specific — other hook types use `payload.prompt_id` (`prompt_*_fetch`) or `payload.uri` (`resource_*_fetch`). `resource.name` is the unified PARC form across all hook types. |
| `input.resource.type` | (none) | New with PARC. Set to `"tool"` for tool hooks, `"prompt"` for prompt hooks, and `"resource"` for resource hooks. |
| `input.subject.sub` | `input.user` | `input.user` typically equals `subject.sub` (e.g., `google-apps|paul@dtwo.ai`). Prefer `subject.sub` when working with claims; keep `input.user` for legacy policies that already use it. |
| `input.subject.claims` | (none) | New with PARC. No legacy equivalent — claims were not exposed to policies before. |

**Egress note:** Tool name discovery on egress was previously only available via `input.tool_metadata.name`. With PARC, `input.resource.name` is also populated on egress and matches `tool_metadata.name`. Either works.

### Identity (Subject and Claims)

When the gateway has an IdP configured, identity is exposed in two forms:

- **`input.user`** — a single string (typically the JWT `sub`), kept for backwards compatibility with older policies.
- **`input.subject`** — a richer object derived from the user's **IdP-issued JWT**, intended for fine-grained authorization.

```jsonc
{
  "subject": {
    "sub": "google-apps|paul@dtwo.ai",
    "claims": {
      "iss":      "https://<tenant>.us.auth0.com/",
      "sub":      "google-apps|paul@dtwo.ai",
      "scope":    "openid profile email",
      "org_id":   "org_g6zdgXkQGLlQPa37",
      "org_name": "asgind"
      // ...plus any other IdP-enriched claims (groups, roles, tenant_id, etc.)
    }
  }
}
```

Key facts:

- **Identity is the Principal dimension of PARC** — `input.subject` is the structured form; `input.user` is a legacy string kept for backwards compatibility.
- **Claims come from the JWT the user was issued by the IdP**, not from a separate gateway store. Whatever the IdP put in the access token (subject to filtering — see below) is what the policy sees. `subject.claims` is source-agnostic — it is currently populated from JWT but is designed to extend to other identity sources (e.g., SAML) without schema changes.
- **`subject.sub` is the only normalized top-level identity field.** Everything else lives under `subject.claims`. For tokens issued by ContextForge itself, `subject.sub` is the user's email; for external IdP tokens, it is whatever the IdP put in the `sub` claim (typically an IdP-prefixed string like `google-apps|paul@dtwo.ai`).

#### Filtered claims

Three categories of JWT claim are **stripped** before populating `subject.claims`. Use these as a guide to what *won't* show up, regardless of what the JWT itself contained:

1. **Bearer credentials** — `access_token`, `refresh_token`, `id_token`, `password`, `secret`, `token`, `client_secret`, `code_verifier`. Stripped to prevent credential leakage into decision logs.
2. **Validation-layer claims** — `aud`, `exp`, `iat`, `nbf`, `jti` (validator-enforced), plus `authorization`, `azp`, `nonce`, `auth_time`, `at_hash`, `c_hash`, `s_hash` (OIDC artifacts inspected but not enforced). Stripped so Rego doesn't become a parallel JWT validator that silently disagrees with the real one. **Exception**: `iss` is intentionally retained — it's also a validation-layer claim, but the gateway uses it as a per-issuer scope key for claim-schema discovery.
3. **ContextForge-internal claims** — `is_admin`, `teams`, and the nested `user` dict. These are minted by ContextForge's own JWT issuer for **its own internal RBAC**, *not* upstream IdP assertions.

> **Critical: do not use `is_admin`, `teams`, or `user` for authorization in policies.** They are stripped from `subject.claims` and will silently never match. A policy that does `input.subject.claims.is_admin == true` is always false, regardless of who is calling. For role-based authorization, use IdP-supplied claims like `groups`, `roles`, or namespaced custom claims (e.g., `https://acme.com/roles`) — those pass through.

Anything else the IdP put in the JWT — `iss`, `sub`, `scope`/`scp`, `email`, `org_id`, `groups`, `roles`, custom-namespaced claims — passes through to `subject.claims`. The exact set varies by IdP, by the scopes the client requested, and by the gateway's `jwt_audience` configuration. **Do not assume a claim is present** — use `object.get(input.subject.claims, "<claim>", "<default>")` and confirm the actual shape before relying on a specific claim in production. To enumerate the claim *names* a gateway has observed, call `dtwo-list-claims(gatewayUid)` (see `dtwo-gateway-policy` Tool Discovery → Finding Identity Claims). For actual claim *values* on a specific caller, use the dump-input technique (see Debugging Policies).

If `input.subject` is empty or `input.subject.claims == {}`, the gateway's `jwt_audience` likely does not match the JWS `aud` claim, or the gateway has not yet observed any traffic from this caller's audience. Cross-check by calling `dtwo-list-claims(gatewayUid)`: if it returns an empty `claims` array the gateway has never discovered claims for any caller (a systemic misconfig affecting everyone); if it returns claims but the caller's `input.subject.claims` is still empty, the audience mismatch is specific to that caller's token. The policy should fail closed in either case rather than silently allow.

#### Notes on common claims

A few claims that frequently show up and have policy-relevant quirks:

- **`scope`** — a single space-separated string (e.g., `"openid profile email"`), **not** an array. Use `contains(input.subject.claims.scope, "write:tickets")` for membership, not `==`. Represents what the token is permitted to do (client-asserted at consent time), not who the user is — don't use it as a role substitute.
- **`iss`** — the JWT issuer URL. Retained despite being a validation-layer claim because the gateway uses it as a scope key for claim-schema discovery. Useful in policies for distinguishing tokens from different IdPs (e.g., a CF-issued internal token vs an external Auth0 token).
- **`email`** — when present, is the user's email address. Optional in OIDC: only emitted when the client requests the `email` scope *and* the IdP is configured to issue it. Always use `object.get(input.subject.claims, "email", "")`; fall back to `subject.sub` only when you've confirmed the IdP issues email-shaped subs.
- **`permissions`** *(Auth0-specific)* — an array of permission strings (e.g., `["read:tickets", "write:tickets"]`) emitted when Auth0 RBAC is enabled and "Add Permissions in the Access Token" is configured on the API. The closest built-in surface to roles/permissions on Auth0 tenants. For other IdPs, the equivalent typically lives under a custom-namespaced claim like `https://acme.com/roles`. **Auth0 does not include role names in the JWT by default** — without explicit configuration (RBAC + permissions, or a Post-Login Action), no role information reaches the policy regardless of what's assigned in the Auth0 dashboard.

Example — gate by an IdP-enriched claim:

```rego
package jira.ingress.org_scoped

default allow := false

allow if {
    object.get(input.subject.claims, "org_id", "") == "org_g6zdgXkQGLlQPa37"
}

reason := "This tool is restricted to the asgind org." if not allow
```

Example — fail closed when claims are not populated:

```rego
package jira.ingress.require_claims

default allow := false

allow if {
    count(object.keys(input.subject.claims)) > 0
    object.get(input.subject.claims, "scope", "") != ""
    # ...further checks
}

reason := "Identity claims are not available for this caller. Verify the gateway's jwt_audience matches the token's aud." if not allow
```

### Hook Types (`kind` values)

| Kind | Direction | Mode | Description |
|------|-----------|------|-------------|
| `tool_pre_invoke` | Ingress | `"input"` | Before a tool is called |
| `tool_post_invoke` | Egress | `"output"` | After a tool returns a result |
| `prompt_pre_fetch` | Ingress | `"input"` | Before a prompt is fetched |
| `prompt_post_fetch` | Egress | `"output"` | After a prompt is rendered |
| `resource_pre_fetch` | Ingress | `"input"` | Before a resource is fetched |
| `resource_post_fetch` | Egress | `"output"` | After a resource is fetched |

### Quick Reference: Key Fields by Direction

| Direction | Tool name | Tool arguments | Tool output | Identity |
|-----------|-----------|----------------|-------------|----------|
| Ingress | `input.resource.name` (PARC) or `input.payload.name` (legacy) | `input.payload.args` | N/A | `input.subject.sub`, `input.subject.claims`, `input.user` (legacy) |
| Egress | `input.resource.name` (PARC) or `input.tool_metadata.name` (legacy) | N/A | `input.payload.text` | `input.subject.sub`, `input.subject.claims`, `input.user` (legacy) |

`input.request_ip`, `input.headers`, and `input.correlation_id` are available in both directions.

> **Note on identity:** Identity is injected by the gateway when an IdP is configured — it is not part of the MCP specification. Prefer `input.subject` (rich JWT-derived claims; see Identity (Subject and Claims) above) over the legacy `input.user` string. `input.user` may equal `"anonymous"` when no IdP is configured. Do not rely on either for access control unless the gateway is known to have authentication enabled.

### Payload by Hook Type

#### tool_pre_invoke (Ingress)

```jsonc
{
  "name": "tool-name",           // Name of the tool being invoked
  "args": {                      // Tool invocation arguments (arbitrary key-value pairs)
    "query": "SELECT * FROM ...",
    "database": "prod"
  },
  "headers": null                // HttpHeaderPayload (also extracted to top-level headers)
}
```

#### tool_post_invoke (Egress)

```jsonc
{
  "name": "tool-name",                          // Name of the tool that was invoked (matches the ingress payload.name)
  "text": ["result line 1", "result line 2"]    // Tool output content blocks
}
```

> **Note:** Per the MCP specification, tool output can include one or more content blocks. Each entry may be plain text, JSON, or another format — the structure is tool-specific. If there is no documentation for the tool's output format, test it using MCP Inspector or similar tooling to determine the shape before writing egress policies. JSON entries must be parsed with `json.unmarshal` before field-level inspection.

#### prompt_pre_fetch (Ingress)

```jsonc
{
  "prompt_id": "greeting",       // Prompt identifier
  "args": { "user": "alice" }   // Prompt template arguments
}
```

#### prompt_post_fetch (Egress)

```jsonc
{
  "text": ["Hello Alice, welcome back!"]   // Rendered prompt content
}
```

#### resource_pre_fetch (Ingress)

```jsonc
{
  "uri": "https://example.com/data/report.csv",   // Resource URI
  "metadata": {}                                    // Optional metadata
}
```

#### resource_post_fetch (Egress)

```jsonc
{
  "text": ["file content here"]   // Resource content
}
```

## Examples

The following examples demonstrate common policy patterns. They use **PARC field names** (`input.resource.name`, `input.action`, `input.subject.*`); the legacy aliases (`input.payload.name`, `input.kind`, `input.user`) are **deprecated** but still populated for backwards compatibility — see Field Aliases for the mapping. All examples use Jira tool names but the patterns apply to any MCP server.

> **Tool names are illustrative.** Examples use short tool names like `atlassian-getjiraissue` for readability. In practice, tool names in `input.resource.name` (or the legacy `input.payload.name`) are prefixed with the MCP server name as configured on the gateway (e.g., `atlassian-jira-mcp-getjiraissue` if the server is named `atlassian-jira-mcp`). Always use the debug technique (see Debugging Policies) to confirm exact tool names before writing policies.

> **One policy, one job:** Each example below is a standalone policy that handles a single concern. To build comprehensive access control, compose multiple policies on the gateway — e.g., one policy to block direct HR issue access + a separate policy to rewrite JQL searches to exclude HR. This makes each policy independently testable and easier to reason about.

> **Allowlist vs blocklist:** Allowlist policies (permit only specific tools) are more secure but require updates when new tools are added to the MCP server. Blocklist policies (deny specific tools, allow everything else) are more permissive but don't need updating for new tools. Choose based on the security posture required.

### Example 1: Readonly Tool Access (Ingress)

Only allow read-only tools; deny all others with a reason.

```rego
package jira.ingress.readonly

default allow := false

allow if {
    lower(input.resource.name) == "atlassian-getjiraissue"
}

allow if {
    lower(input.resource.name) == "atlassian-searchjiraissuesusingjql"
}

allow if {
    lower(input.resource.name) == "atlassian-getvisiblejiraprojects"
}

reason := "You are not allowed to modify JIRA issues. Ask your InfoSec team for access." if not allow
```

### Example 2: Block Access to Specific Tool Arguments (Ingress)

Deny adding comments to a specific JIRA issue.

```rego
package jira.ingress.deny_comment

default allow := false

# Allow all tool calls except the blocked one
allow if {
    not is_blocked_comment
}

# Block adding comments to DEV-1
is_blocked_comment if {
    lower(input.resource.name) == "atlassian-addcommenttojiraissue"
    object.get(input.payload.args, "issueIdOrKey", "") == "DEV-1"
}

reasons contains "For testing purposes, adding comments to the DEV-1 task has been disabled. Ask your InfoSec team to re-enable it." if {
    is_blocked_comment
}

reason := joined if {
    count(reasons) > 0
    reason_list := sort([r | some r in reasons])
    joined := concat("; ", reason_list)
}
```

### Example 3: Block Access to a Forbidden Project (Ingress)

Deny viewing issues belonging to specific projects.

```rego
package jira.ingress.project_access

default allow := false

# Projects the caller is not allowed to access
forbidden_projects := {"HR"}

# Allow tool calls that don't target forbidden projects
allow if {
    lower(input.resource.name) == "atlassian-getjiraissue"
    not issue_belongs_to_forbidden_project(issue_key)
}

# Allow all other tools
allow if {
    lower(input.resource.name) != "atlassian-getjiraissue"
}

# Helpers
issue_key := upper(object.get(input.payload.args, "issueIdOrKey", ""))

issue_belongs_to_forbidden_project(key) if {
    some project in forbidden_projects
    startswith(upper(key), concat("", [project, "-"]))
}

reasons contains "You are not allowed to view issues in the HR project. Ask your InfoSec team for access." if {
    lower(input.resource.name) == "atlassian-getjiraissue"
    issue_belongs_to_forbidden_project(issue_key)
}

reason := joined if {
    count(reasons) > 0
    reason_list := sort([r | some r in reasons])
    joined := concat("; ", reason_list)
}
```

> **Note:** This policy only blocks direct issue fetches by key. To fully restrict project access, add a **separate** policy to guard `searchjiraissuesusingjql` (see Example 8 for a JQL rewriting approach). Keep them as independent policies rather than combining them — this makes each one easier to test and debug.

### Example 4: Limit Editable Fields (Ingress)

Allow editing only specific fields; deny changes to any others.

```rego
package jira.ingress.limited_editing

default allow := false

# Fields that are allowed to be edited
allowed_fields := {
    "description",
    "labels",
    "priority",
    "environment",
    "comment"
}

# Allow non-edit tools
allow if {
    lower(input.resource.name) != "atlassian-editjiraissue"
}

# Allow edits that only touch permitted fields
allow if {
    input.action == "tool_pre_invoke"
    lower(input.resource.name) == "atlassian-editjiraissue"
    not disallowed_field
}

# Extract the fields being edited in the request
edited_fields := {k |
    fields := object.get(input.payload.args, "fields", {})
    k := object.keys(fields)[_]
}

# Detect if any disallowed field is being modified
disallowed_field := f if {
    f := edited_fields[_]
    not allowed_fields[f]
}

reasons contains msg if {
    input.action == "tool_pre_invoke"
    lower(input.resource.name) == "atlassian-editjiraissue"
    f := disallowed_field
    msg := sprintf("Editing the field '%s' is not allowed. Only description, labels, priority, environment, and comment may be edited.", [f])
}

reason := joined if {
    count(reasons) > 0
    reason_list := sort([r | some r in reasons])
    joined := concat("; ", reason_list)
}
```

### Example 5: Block Egress Containing Confidential Labels (Egress)

Block responses that contain issues with the "confidential" label.

```rego
package jira.egress.deny_confidential

default allow := false

# Allow responses without confidential content
allow if {
    not has_confidential_label
}

has_confidential_label if {
    some text in input.payload.text
    parsed := json.unmarshal(text)
    fields := object.get(parsed, "fields", {})
    labels := object.get(fields, "labels", [])
    some label in labels
    lower(label) == "confidential"
}

reasons contains "You are not allowed to view issues with the label 'confidential'. Ask your InfoSec team for access." if {
    has_confidential_label
}

reason := joined if {
    count(reasons) > 0
    reason_list := sort([r | some r in reasons])
    joined := concat("; ", reason_list)
}
```

### Example 6: PII Redaction (Egress)

Allow all responses but redact PII patterns and sensitive fields. Note that `redact_fields` only operates on structured JSON field names — to catch plain-text occurrences like `password: hunter2`, use `redact_patterns` with a regex (see the last two patterns below).

```rego
# Package name omits the tool segment because this policy is not tool-specific —
# it applies PII redaction to every egress response. See Core Rules for the convention.
package egress.pii_redaction

# Transform-only policy — never denies, only redacts sensitive data
default allow := true

transform := {
    "redact_patterns": [
        "\\d{3}-\\d{2}-\\d{4}",
        "\\d{4}[- ]?\\d{4}[- ]?\\d{4}[- ]?\\d{4}",
        "[\\w.-]+@[\\w.-]+\\.[\\w.-]+",
        "\\+?1?[- .]?\\(?\\d{3}\\)?[- .]?\\d{3}[- .]?\\d{4}",
        "AKIA[0-9A-Z]{16}",
        "(?i)(?:api[_-]?key|apikey|secret[_-]?key)\\s*[:=]\\s*\\S+",
        "(?i)(?:password|secret|token|credentials)\\s*[:=]\\s*\\S+"
    ],
    "redact_fields": ["password", "secret", "api_key", "token"],
    "replacement": "[REDACTED]",
}
```

### Example 7: Tool-Scoped Egress Transform (Egress)

Apply a transform only to a specific tool's output. This example redacts profanity only from the echo tool's responses.

```rego
package echo.egress.profanity_filter

# Transform-only policy — never denies, only redacts profanity
default allow := true

transform := {
    "redact_patterns": [
        "(?i)\\b(?:damn|shit|fuck|ass|bitch|bastard|crap|hell|dick|piss)\\b",
        "(?i)\\b(?:fucking|shitting|asshole|bullshit|dumbass|dickhead|motherfucker)\\b"
    ],
    "replacement": "[PROFANITY]",
} if {
    input.mode == "output"
    lower(input.tool_metadata.name) == "echo-echo"
}
```

> **Note:** When a tool-scoped transform's condition does not match (e.g., a non-echo tool call), the `transform` rule is undefined and the aggregator silently skips this policy for that request. Other transforms attached to the same pipeline direction still apply — the chain composes whichever transforms are defined for the current request (see Transform Composition).

### Example 8: Ingress Transform — Rewrite Search Query (Ingress)

Transform tool arguments before they reach the MCP server. This example rewrites JQL queries to exclude a forbidden project.

```rego
package jira.ingress.hr_search

# Transform-only policy — never denies, just rewrites JQL
default allow := true

# Rewrite the JQL to exclude the HR project
transform := {
    "transformed_payload": object.union(
        input.payload.args,
        {"jql": new_jql}
    )
} if {
    input.action == "tool_pre_invoke"
    lower(input.resource.name) == "atlassian-searchjiraissuesusingjql"
    original_jql := object.get(input.payload.args, "jql", "")
    new_jql := build_jql(original_jql)
}

# Find the position of "order by" — check both mid-string (" order by ") and start-of-string ("order by ")
order_by_idx(jql) := idx if {
    lower_jql := lower(jql)
    idx := indexof(lower_jql, " order by ")
    idx >= 0
}

order_by_idx(jql) := 0 if {
    lower_jql := lower(jql)
    indexof(lower_jql, " order by ") == -1
    startswith(lower_jql, "order by ")
}

# Build JQL with HR exclusion — filter + ORDER BY
build_jql(original_jql) := new_jql if {
    idx := order_by_idx(original_jql)
    filter_part := trim_space(substring(original_jql, 0, idx))
    order_part := trim_space(substring(original_jql, idx, count(original_jql) - idx))
    filter_part != ""
    new_jql := sprintf("project != HR AND (%s) %s", [filter_part, order_part])
}

# Build JQL with HR exclusion — ORDER BY only, no filter
build_jql(original_jql) := new_jql if {
    idx := order_by_idx(original_jql)
    filter_part := trim_space(substring(original_jql, 0, idx))
    order_part := trim_space(substring(original_jql, idx, count(original_jql) - idx))
    filter_part == ""
    new_jql := sprintf("project != HR %s", [order_part])
}

# Build JQL with HR exclusion — filter only, no ORDER BY (no order_by_idx match means no ORDER BY)
build_jql(original_jql) := new_jql if {
    not order_by_idx(original_jql)
    filter_part := trim_space(original_jql)
    filter_part != ""
    new_jql := sprintf("project != HR AND (%s)", [filter_part])
}

# Build JQL with HR exclusion — empty query
build_jql(original_jql) := "project != HR" if {
    not order_by_idx(original_jql)
    trim_space(original_jql) == ""
}
```

### Example 9: Tenant-Scoped Access by JWT Claim (Ingress)

Allow a specific tool only when the caller's IdP-issued `org_id` claim is in an allowlist. Demonstrates reading `input.subject.claims` for authorization while leaving other tools unaffected.

```rego
package jira.ingress.org_scoped

default allow := false

# Orgs allowed to call atlassian-getjiraissue — typically populated from IdP claims
# like Auth0's `org_id` or a custom-namespaced claim such as `https://acme.com/tenant_id`.
allowed_orgs := {
    "org_g6zdgXkQGLlQPa37",
    "org_h7ahxYrLHMmRPbQR",
}

# Pass through any tool other than the one we're gating
allow if {
    lower(input.resource.name) != "atlassian-getjiraissue"
}

# Allow the gated tool only when the caller's org_id is on the list
allow if {
    lower(input.resource.name) == "atlassian-getjiraissue"
    allowed_orgs[object.get(input.subject.claims, "org_id", "")]
}

reason := sprintf(
    "atlassian-getjiraissue is restricted to specific orgs. Your org_id is %v.",
    [object.get(input.subject.claims, "org_id", "<not set>")],
) if {
    lower(input.resource.name) == "atlassian-getjiraissue"
    not allowed_orgs[object.get(input.subject.claims, "org_id", "")]
}
```

Notes:

- Use `object.get(input.subject.claims, "<claim>", "<default>")` for claim access. Direct access (`input.subject.claims.org_id`) silently fails if the claim isn't present, which makes the entire rule body fail to match — easy to mistake for a different bug.
- The default value matters. `object.get(..., "")` ensures the membership check `allowed_orgs[""]` is false (the empty string is not in the set), so a missing claim deterministically denies. If you used a default like `null` or omitted the default entirely, you'd get a "rule body failed to match" silently rather than a clean deny + reason.
- The exact claim names available depend on the IdP — Auth0 uses `org_id`, Okta might use `tenant`, custom IdPs might emit namespaced claims like `https://acme.com/tenant_id`. See Identity (Subject and Claims) for guidance on discovering the actual claim shape for your gateway.

## Policy Composition

Multiple policies are composed on the gateway through an **aggregator policy** that references each step policy by its package path. Understanding this aggregation is critical — package path mismatches are a common source of blanket denies.

### How It Works

Each step policy (e.g., `ingress_step_0.rego`) declares its own package and evaluates `allow`, `reasons`, and `transform` independently. An aggregator policy (e.g., `ingress_policy.rego`) combines them:

```rego
package dtwo.ingress

default allow := false

# Both step policies must allow for the request to proceed
allow if {
    data.jira.ingress.readonly.allow
    data.jira.ingress.hr_search.allow
}

# Collect transforms from each step policy
transform := data.jira.ingress.readonly.transform
transform := data.jira.ingress.hr_search.transform

# Collect reasons from each step policy
reasons contains reason if {
    some reason in data.jira.ingress.readonly.reasons
}

reasons contains reason if {
    some reason in data.jira.ingress.hr_search.reasons
}
```

### Key Rules

- The `data.<package-path>.allow` reference must **exactly match** the step policy's `package` declaration. If the step policy declares `package jira.ingress.readonly` but the aggregator references `data.jira.readonly.allow`, the value is `undefined` and the aggregator's `default allow := false` takes effect — denying everything.
- When the aggregator ANDs multiple step policies (`allow if { policy_a.allow; policy_b.allow }`), **all** must evaluate to `true`. If any step policy's package path is wrong, its `allow` is `undefined`, and the AND fails.
- Transform-only step policies should use `default allow := true` so they don't block requests when their transform doesn't apply.

## Handling Parse and Access Failures

Rego rules fail **silently** — if any expression in a rule body fails (e.g., `json.unmarshal` on non-JSON text, or accessing a missing key), the entire rule body does not match. No error is raised. This means the policy's behavior on bad data depends on how the rules are structured.

### Fail-open vs fail-closed

- **Fail-open (default for positive checks):** If a rule checks for a specific condition (e.g., `has_confidential_label`) and the parse fails, the condition is `false`, and `not has_confidential_label` is `true` — the response is **allowed**. This is appropriate when the absence of evidence means there's nothing to block.

- **Fail-closed (deny on parse failure):** If you want to **block** when data can't be parsed or verified, structure the `allow` rule so that a successful parse is required for it to fire. If the parse fails, `allow` never becomes `true`, and the default deny takes effect.

### Example: Fail-closed pattern

```rego
# Only allow if we can parse the response AND it passes the check
allow if {
    some text in input.payload.text
    parsed := json.unmarshal(text)
    not contains_sensitive_data(parsed)
}
```

If `json.unmarshal` fails here, `allow` never fires, and the default `deny` holds — the response is blocked.

### Example: Fail-open pattern

```rego
# Block only if we can confirm sensitive data is present
allow if {
    not confirmed_sensitive
}

confirmed_sensitive if {
    some text in input.payload.text
    parsed := json.unmarshal(text)
    contains_sensitive_data(parsed)
}
```

If `json.unmarshal` fails, `confirmed_sensitive` is `false`, so `allow` fires — the response is allowed through.

### Guidelines

- Use **fail-closed** when the policy protects high-sensitivity data and you'd rather block an unparseable response than risk leaking it
- Use **fail-open** when the check targets a specific data pattern (e.g., a label) and non-matching formats are safe to pass through
- Use `object.get(obj, key, default)` instead of direct key access (`obj.key`) to avoid silent failures on missing keys
- When iterating over `input.payload.text` with `some text in ...`, be aware that if *any* entry matches a blocking condition, the rule fires — but if *none* can be parsed, the rule won't fire at all

## Commonly Used Rego Built-in Functions

The functions below are frequently used in DTwo policies. All standard OPA Rego built-ins are also available.

### String Matching & Manipulation
- `contains(string, search)` — check if string contains substring
- `startswith(string, prefix)` / `endswith(string, suffix)`
- `lower(string)` / `upper(string)` — case conversion
- `concat(delimiter, array)` — join array elements
- `sprintf(format, values)` — formatted string output
- `split(string, delimiter)` — split string into array
- `indexof(string, search)` — find position of substring
- `trim_space(string)` — trim whitespace

### Regex
- `regex.match(pattern, value)` — test if value matches pattern
- `regex.replace(string, pattern, replacement)` — regex replace

### Object & Collection
- `object.get(obj, key, default)` — safe key access with default
- `object.keys(obj)` — get object keys
- `object.union(a, b)` — merge objects
- `object.remove(obj, keys)` — remove keys from object
- `count(collection)` — length of string/array/set/object
- `sort(array)` — sort array
- `some x in collection` — iteration / membership test

### Encoding
- `json.marshal(x)` / `json.unmarshal(string)` — JSON encode/decode

### Time
- `time.now_ns()` — current time in nanoseconds
- `time.parse_rfc3339_ns(string)` — parse RFC 3339 timestamp
- `time.weekday(ns)` — day of week as string

## Debugging Policies

When a policy isn't behaving as expected, use these techniques to inspect what the gateway is actually sending to OPA.

### Finding the Correct Tool Name

Tool names in `input.payload.name` are constructed as `<server-name>-<tool-name>`, where `<server-name>` is the name given to the MCP server when it was configured on the gateway. For example, if an Atlassian MCP server is named `atlassian-jira-mcp` on the gateway, its `getjiraissue` tool appears as `atlassian-jira-mcp-getjiraissue`. A Slack server named `slack-mcp` would have tools like `slack-mcp-slack-send-message`.

The client may display a different name (e.g., `mcp__dtwo__atlassian-jira-mcp-getjiraissue` in Claude Code) — the gateway prefix is stripped, but the server name prefix is preserved.

> Note: this is the gateway-to-OPA name (what `input.payload.name` contains inside a Rego policy), **not** the MCP client invocation name you call as a tool. The latter is covered in the companion `dtwo-gateway-config` and `dtwo-gateway-policy` instructions.

**Do not guess tool names.** The server name is configured by the gateway admin and is not standardized. Use a debug policy to discover the exact name the gateway passes, or follow the tool-discovery guidance in the companion `dtwo-gateway-policy` instructions to discover tool names and argument schemas via the DTwo MCP server when available.

### Debug Policy: Dump Tool Name and Arguments

Temporarily add rules that force a deny and include the full input in the reason. This lets you see the exact tool name and argument keys/values:

```rego
# --- TEMPORARY DEBUG RULES — remove after debugging ---
allow := false if {
    true
}

reasons contains sprintf("Debug - name: %s, args: %v", [input.payload.name, input.payload.args]) if {
    true
}
# --- END DEBUG RULES ---
```

This blocks all tool calls and returns the tool name and arguments in the denial message.

To inspect **identity** (the `subject` block and the JWT-derived claims), add:

```rego
reasons contains sprintf("Debug - user: %s, subject.sub: %s, claims: %v", [
    object.get(input, "user", "<not set>"),
    object.get(object.get(input, "subject", {}), "sub", "<not set>"),
    object.get(object.get(input, "subject", {}), "claims", "<not set>"),
]) if { true }
```

Use this to confirm what specific claim *values* are present in `input.subject.claims` for the current caller. To enumerate just the *names* a gateway has observed (across all callers, without attaching a policy), prefer `dtwo-list-claims(gatewayUid)` from the DTwo MCP server.

> **Self-lock warning.** An always-deny dump policy attached to a gateway will block **every** tool call on that gateway, including any DTwo MCP tools your client routes through it. If you manage policies via an MCP client that goes through the same gateway, you will lock yourself out and have to detach the policy from the DTwo web UI (or another client/gateway) to recover. Attach to a gateway you are **not** using for policy management, or be prepared to detach via the UI.

To scope the debug to a specific tool pattern (e.g., only Atlassian tools):

```rego
# --- TEMPORARY DEBUG RULES — remove after debugging ---
allow := false if {
    startswith(lower(input.payload.name), "atlassian-")
}

reasons contains sprintf("Debug - name: %s, args: %v", [input.payload.name, input.payload.args]) if {
    startswith(lower(input.payload.name), "atlassian-")
}
# --- END DEBUG RULES ---
```

For **egress** policies, the input structure is different — use `input.tool_metadata.name` and `input.payload.text` instead:

```rego
# --- TEMPORARY EGRESS DEBUG RULES — remove after debugging ---
allow := false if {
    true
}

reasons contains sprintf("Debug - tool: %s, text: %v", [input.tool_metadata.name, input.payload.text]) if {
    true
}
# --- END EGRESS DEBUG RULES ---
```

### Diagnosing Blanket Denies

If all tool calls are being denied (including tools on unrelated MCP servers), the most common causes are:

1. **Syntax errors in any `.rego` file:** A Rego compilation error in one file can cause the entire policy bundle to fail to load, causing the gateway to fall back to a default deny. Check for incomplete rules (e.g., `reasons contains sprintf()` with no arguments or body).

2. **Package path mismatch:** If the ingress/egress aggregator policy references a package path that doesn't match the step policy's `package` declaration, the aggregator can't find the step policy's `allow` value. With `default allow := false` in the aggregator, this results in a blanket deny. Verify the `package` declaration in each step policy matches the `data.<path>.allow` reference in the aggregator.

3. **Empty `.rego` files:** OPA fails with `rego_parse_error: empty module` if a `.rego` file has no content.

4. **OPA stuck on a failed compilation after deployment:** During deployment, the gateway writes policy files by first deleting all existing files (`rm -f *`) and then writing new ones sequentially. OPA's file watcher may pick up intermediate states during this process — empty files, stale files before deletion, or partially written files — and fail to compile. Even after all files are correctly in place, OPA may remain stuck on the failed compilation and never successfully reload. **Fix:** Restart OPA after deployment (e.g., `pm2 restart opa`) to force a clean load of the current files.

5. **Transient log errors during deployment are expected:** Errors like `rego_parse_error: empty module` or `multiple default rules` in OPA logs during a deployment are typically transient — they reflect OPA's file watcher reacting to intermediate file states, not actual policy problems. Compare the error timestamps against the deployment time. If the errors only appear during the deployment window and the files on disk are correct afterward, an OPA restart resolves the issue.

### Debugging Checklist

1. **Verify tool names:** Use the debug policy above to confirm `input.payload.name`
2. **Verify argument keys:** Check the exact keys in `input.payload.args` (e.g., `issueIdOrKey` vs `issueKey`)
3. **Check compilation:** Ensure every `.rego` file has valid syntax and a `package` declaration
4. **Check package paths:** Ensure step policy packages match the aggregator's `data.*` references
5. **Test incrementally:** Start with a permissive policy (`default allow := true`) and add deny rules one at a time

## Valid Rego Patterns (Not Bugs)

The following patterns are valid Rego and should **not** be flagged as issues when reviewing policies.

### `default allow := true` with `allow := false if { ... }`

This is valid. The `default` only applies when no rule body matches. When the condition in `allow := false if { ... }` matches, `allow` is `false`. When it doesn't match, the default `true` takes effect. There is no complete rule conflict — this is a standard pattern for policies that allow by default and deny specific conditions.

```rego
default allow := true

# This is NOT a conflict — the default only fires when the condition below doesn't match
allow := false if {
    input.payload.name == "some-tool"
    some_blocking_condition
}
```

### Silent failure on missing keys in deny conditions

When a rule accesses a key that doesn't exist (e.g., `input.payload.args.transition.id`), the rule body silently fails and doesn't match. In a deny-specific-condition policy with `default allow := true`, this is **correct behavior** — if the key doesn't exist, the request isn't the one being blocked, so it should be allowed. Only flag this as a bug if the policy uses `default allow := false` and the missing key would prevent an `allow` rule from firing when it should.

### Hardcoded IDs and values

Policies often contain hardcoded values like transition IDs, project keys, or tool names. These are **implementation details, not bugs** — they reflect the specific environment the policy targets. At most, suggest adding a comment documenting what the value represents, but do not flag them as issues.

## Common Pitfalls

- **Identifying the tool in egress policies:** For `tool_post_invoke`, the tool name is available in three places — `input.tool_metadata.name`, `input.resource.name` (with PARC), and `input.payload.name`. All three carry the same value. Prefer `input.tool_metadata.name` or `input.resource.name` for direction-agnostic policies; treat `input.payload.name` as ingress-canonical and verify with the dump-input technique before relying on it for non-tool egress hooks (`prompt_post_fetch`, `resource_post_fetch`).
- **Assuming fields are always present:** External APIs don't always return the same fields. For example, Jira may expose `emailAddress` for some users but not others depending on privacy settings. Always use `object.get(obj, key, default)` and consider fallback checks (e.g., matching on `displayName` when `emailAddress` is missing).
- **Forgetting the `default allow` declaration:** Without a default, `allow` is `undefined` when no rule matches, which OPA treats differently than `false`. Always include `default allow := false` (for deny policies) or `default allow := true` (for transform-only policies).
- **Direct key access on optional fields:** `input.payload.args.someField` will cause the rule to silently fail if `someField` doesn't exist. Use `object.get(input.payload.args, "someField", "")` instead.
- **Guessing tool names:** Tool names in `input.payload.name` are prefixed with the MCP server name as configured on the gateway (e.g., `atlassian-jira-mcp-getjiraissue`, not just `atlassian-getjiraissue`). Examples in this skill use shortened names for readability, but real policies must match the exact name the gateway sends. Use the debug policy technique to confirm.
- **Case-sensitive tool name comparisons:** By default, compare tool names case-insensitively using `lower(input.payload.name) == "..."` (or `lower(input.tool_metadata.name)` for egress). Tool names are strings configured on the gateway, and a case mismatch will silently cause the policy to not match — which is a hard bug to debug. Use case-sensitive comparisons only when the user has an explicit reason to do so.
- **Direct access on `subject.claims`:** `input.subject.claims.org_id` silently fails if the claim isn't present, making the entire rule body fail to match — easy to mistake for a different bug. Always use `object.get(input.subject.claims, "<claim>", "<default>")`. Choose the default carefully so a missing claim produces a clean deny (e.g., `""` for string compares, `[]` for `some x in ...`).
- **Assuming standard JWT claims are in `subject.claims`:** `aud`, `exp`, `iat`, `nbf`, `jti`, `azp`, `nonce`, and other validation-layer/OIDC claims are stripped before they reach the policy — Rego is not meant to be a parallel JWT validator. `iss` is the documented exception. See Identity (Subject and Claims) for the full strip set.
- **Using `is_admin`, `teams`, or `user` from `subject.claims` for authorization:** These claims are stripped because they are ContextForge-internal RBAC plumbing minted by CF's own JWT issuer, not upstream IdP assertions. A policy that does `input.subject.claims.is_admin == true` is *always* false. For role-based authorization, use IdP-supplied claims like `groups`, `roles`, or namespaced custom claims.
- **Treating `input.subject.sub` as an email address:** For tokens issued by ContextForge itself, `sub` is the user's email. For external IdP tokens, `sub` is whatever the IdP put in the `sub` claim — typically an IdP-prefixed identifier like `google-apps|paul@dtwo.ai`, not a clean email. If you need a stable user identifier, compare against the full `sub` value; if you need an email, prefer `input.subject.claims.email` (when the IdP emits it) and fall back to `sub` only when you've confirmed the IdP issues email-shaped subs.
- **Self-locking with an always-deny ingress policy:** Attaching a `default allow := false` policy (or one that denies broadly during debugging, like a dump-input policy) to a gateway will block *every* tool call on that gateway — including any DTwo MCP management tools your client routes through it. **This only applies when the DTwo MCP server itself is configured behind that gateway** (a common but not universal setup); if your DTwo MCP server runs outside the gateway, calls to it bypass the gateway's policies and self-locking does not happen. When in doubt, check the gateway config: if `mcp_servers` includes a Dtwo entry that your client connects through, you are at risk.

  **Mitigation: management-tool passthrough.** Add a single `allow if` rule that exempts `dtwo-*` tools from the deny:

  ```rego
  # Management bypass — keep DTwo MCP management tools usable while this policy is attached
  allow if {
      startswith(lower(input.resource.name), "dtwo-")
  }
  ```

  Place this near the top of your policy, before the deny conditions. If your gateway also fronts a different management surface, add similar passthroughs for that prefix. Recovery if you skip the bypass and lock yourself out: detach the policy via the DTwo web UI, or via an MCP client that goes through a different gateway.

## Limitations

- This skill cannot version, revert, or deploy policies — see the companion `dtwo-gateway-policy` instructions for lifecycle operations
- This skill does not know what specific tools are available on an MCP server or what arguments they accept — follow the tool-discovery guidance in the companion `dtwo-gateway-policy` instructions or the debug policy technique (see Debugging Policies) to discover tool names and argument shapes
- This skill does not have access to runtime policy evaluation results
