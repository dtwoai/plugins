---
name: "dtwo-gateway-policy"
description: |
  Create, validate, attach, publish, deploy, verify, and roll back DTwo policies and their pipeline attachments.
  This is the system-of-record skill: it owns the DTwo MCP tools for policy lifecycle (create, update,
  publish, revert) and pipeline lifecycle (attach, deploy, verify), and is responsible for confirming
  pipeline attachments before and after deployment. Also manages the session-state marker registry, and
  the intent registry when the intent tools are enabled.
  TRIGGER when: user says "create/add a policy", "modify/update a policy", "block/allow/redact something",
  "attach/detach policy", "set/update pipeline", "publish/pin policy version", "deploy gateway" after a
  policy change; also "register/create/manage a marker", "marker registry", or (only when the intent tools
  are enabled) "intent capture", "intent registry", "intent transitions", "intent/marker compatibility".
  Always pair with dtwo-policy-rego for the Rego authoring/modification step.
  SKIP when: task is purely *explaining* existing Rego with no save/attach/deploy intent
  (use dtwo-policy-rego alone); task is editing gateway YAML or MCP server entries (use dtwo-gateway-config).
---

<!-- © 2026 DTwo, Inc. -->

# DTwo Policy & Pipeline Manager

You manage DTwo policies and their attachment to gateway pipelines through the DTwo MCP server. You handle the full policy lifecycle: creating and validating policies, attaching them to gateway ingress/egress pipelines, deploying, and verifying behavior.

## Companion skills

This skill is typically used alongside others. Invoke them via the `Skill` tool when relevant (in other agents, use your host's equivalent skill-loading mechanism):

- **dtwo-policy-rego** — load at the start of any task that requires writing, modifying, or explaining Rego. Almost always load this together with `dtwo-gateway-policy` unless the task is pure pipeline attachment of an already-authored policy.
- **dtwo-gateway-config** — load when the task also involves editing gateway YAML or adding/removing MCP server entries.

## Core Concepts

Before choosing an approach, understand how the pieces relate. From smallest to largest:

- **Policy** — a single unit of Rego that makes one decision about one tool call: allow it, deny it, transform the request/response, and/or write a marker. Policies are authored with the companion `dtwo-policy-rego` skill and stored as records with a draft plus published versions. **A policy on its own is inert** — it does nothing until it is attached to a gateway and deployed.
- **Pipeline** — the ordered list of policies attached to a gateway in one direction. Each gateway has two: an **ingress** pipeline that runs *before* a tool call reaches the upstream server (inspect arguments, identity; block or rewrite the request), and an **egress** pipeline that runs *after* the tool returns (inspect the response; block or redact it). Steps run in array order, and an earlier deny short-circuits later steps — so ordering matters.
- **Gateway** — the runtime that fronts one or more upstream MCP servers and enforces its pipelines. Attaching or editing policies changes only stored state; a **deploy** is what makes the current pipelines live.
- **Marker** — a session-state flag one policy writes and another reads, letting policies coordinate *across* tool calls, directions, and upstream servers within a session (e.g. "PII was seen in an earlier response → block outbound sends now"). A marker is defined once in the registry, then used by a writer policy and a reader policy. See Managing Markers.
- **Intent** *(only when the intent tools are enabled)* — a declared session *purpose* captured into session state and gated on by policies. Built on the same session-state mechanism as markers, with its own registry. See Intent Capture, including its availability gate.

**Mental model:** *policies* are the decision logic; the *pipeline* is where and when they run; the *gateway* is what enforces them once deployed; *markers* and *intent* are how policies share context beyond a single call.

**Which skill does what:** this skill (`dtwo-gateway-policy`) owns the lifecycle and orchestration — policy records, pipelines, marker/intent registries, deploy, and verify. The companion `dtwo-policy-rego` skill owns the Rego logic *inside* a policy. Most authoring tasks use both.

## Choosing the Right Approach

Match the user's goal to the **smallest** mechanism that solves it, then follow that section:

| The user wants to… | Use | Where |
|---|---|---|
| Block, allow, or restrict a tool call based on the call itself (tool name, arguments, caller identity) | One **ingress policy** (deny) | Creating a New Policy |
| Block or redact a response based on its content | One **egress policy** (deny or transform) | Creating a New Policy |
| Rewrite a tool's arguments before it runs (e.g. force a filter) | One **ingress transform policy** | Creating a New Policy + `dtwo-policy-rego` |
| Make a decision that depends on something earlier in the session (a prior tool, a prior response, another upstream server) | A **marker** — a writer policy stamps it, a reader policy gates on it | Managing Markers |
| Gate tools on *what the agent is currently doing* | **Intent** *(only if the intent tools are enabled — otherwise not available; do not offer it)* | Intent Capture |
| Turn a policy on/off, reorder it, or pin a version at runtime | **Pipeline attachment** + deploy | Pipeline Attachment |
| Stop a policy's runtime effect, or remove it entirely | **Detach** + redeploy (then `dtwo-delete-policy` only if the record should also go) | Deleting a Policy |

Guidance:

- **Prefer one policy.** If a single call carries everything needed to decide, a single ingress or egress policy is the answer — don't reach for markers.
- **Markers are for cross-call state**, not for anything decidable from the current call alone. They add a second policy and a registry entry, so use them only when the decision genuinely depends on earlier session activity.
- **Intent is for session-purpose gating** and is only available when the intent tools are present. If they are not, solve the request with policies and markers and do not mention intent.
- **Compose small policies over one large one** — the companion `dtwo-policy-rego` skill explains why (single-concern policies are easier to test, order, and debug).

## Prerequisites

This skill requires the DTwo MCP server to be connected (`dtwo-*` tools must be loaded). If the tools are not available, ask the user to connect the DTwo MCP server first.

The tools listed below reflect the initial set. The DTwo MCP server may add new tools over time — if you discover `dtwo-*` tools not listed here, use them where appropriate. Prefer newer, more specific tools over workarounds when available.

**Tool naming note:** This skill refers to the DTwo MCP tools by their short names (e.g., `dtwo-list-gateways`). In Claude Code, that short name is what you call directly — the `mcp__dtwo__` server prefix is stripped automatically. In other MCP clients you may see the fully-qualified name `mcp__dtwo__dtwo-list-gateways`; both refer to the same tool. This is **separate** from the per-tool name that appears inside Rego policies (`input.payload.name`) — see the companion `dtwo-policy-rego` instructions for that.

## High-level workflow

1. If the policy reads identity (claims like `sub`, `email`, `org_id`), pull tenant claims with `dtwo-list-claims` (see Tool Discovery → Finding Identity Claims). Skip for policies that only gate on tool names, arguments, or other non-identity inputs.
2. Identify the target gateway and relevant policy or policies.
3. Inspect the current policy draft, published versions, and pipeline attachments.
4. For any Rego authoring or modification, invoke `Skill("dtwo-policy-rego")` (or your host's equivalent) to produce or revise the code before proceeding.
5. Validate before creating, updating, publishing, or attaching.
6. Only deploy after confirming with the user, then verify both deployment completion and policy behavior.

## Rules

- Do not guess tool names or argument schemas when they can be discovered from gateway configuration and MCP tool metadata.
- Prefer testing draft policies before publishing and pinning versions.
- Treat pipeline changes as non-live until a deploy completes successfully.
- Do not treat `revert-policy` as deletion; detach first if the user wants removal from runtime behavior.
- Before authoring a policy for a gateway that fronts the DTwo MCP server (a `Dtwo` entry in `mcp_servers`), plan a `dtwo-*` passthrough into the Rego. Without it, the deploy locks management calls out — see Deploying → Self-lock risk.

## Available Tools

### Policy Tools

| Tool | Purpose |
|------|---------|
| `dtwo-list-policies` | List policies with optional filters (name, direction, uid) |
| `dtwo-get-policy` | Fetch a single policy by UID (includes draft Rego code) |
| `dtwo-get-policy-versions` | List published versions for a policy |
| `dtwo-validate-policy-rego` | Validate Rego code without saving — useful for dry-run checks before committing changes (note: `dtwo-add-policy` and `dtwo-update-policy` also validate automatically) |
| `dtwo-add-policy` | Validate and create a new policy (requires name, description, policy, packageName, direction). Optionally pass `writableKeySchema` to declare the session-state keys the policy is authorized to write — required for any policy that emits a marker (see Managing Markers) |
| `dtwo-update-policy` | Update an existing policy's draft — any field (policy, packageName, name, description, direction, tags, `writableKeySchema`). Validates Rego when both policy and packageName are provided. `writableKeySchema` is tri-state: omit → leave unchanged, `null` → clear, `[]` → explicit-empty, `[...]` → set |
| `dtwo-publish-policy` | Publish the current draft as a new version |
| `dtwo-revert-policy` | Restore a published version back into the draft |
| `dtwo-delete-policy` | Permanently delete a policy by UID. Fails if the policy is still attached to one or more gateways — detach it from every gateway first (see Deleting a Policy). Distinct from `dtwo-revert-policy`, which only restores a prior version |
| `dtwo-list-claims` | Return the union of JWT claim names observed across the tenant, plus the issuers seen. Defaults to tenant-wide; pass `gatewayUid` to scope to a single gateway when the user asks. Call this when authoring or modifying identity-aware policies so rules can reference claims that actually exist; skip for policies that don't read `input.subject.claims`. |

### Marker Registry Tools

Markers are session-state flags that one policy writes and other policies read to gate on (see Managing Markers). These tools are **always registered** on the DTwo MCP server — they do not depend on any feature flag.

| Tool | Purpose |
|------|---------|
| `dtwo-list-markers` | List markers in the registry (optional filters: `name` for exact FQID, `tag`). Returns the marker *vocabulary*, not which markers are currently active on a session |
| `dtwo-get-marker` | Fetch a single marker by UID |
| `dtwo-create-marker` | Create a customer-tier marker (requires `namespace`, `markerId`, `description`, `minimumTtlSeconds`; optional `tags`). Full key is `marker:<namespace>:<markerId>`. `namespace` and `markerId` are each validated at the tool boundary (must start with an alphanumeric; alphanumerics, underscores, or hyphens only). `internal` and `dtwo` namespaces are reserved for platform markers |
| `dtwo-update-marker` | Update mutable fields on a customer-tier marker (`description`, `tags`, `minimumTtlSeconds`) |
| `dtwo-delete-marker` | Delete a customer-tier marker. Platform-managed entries cannot be deleted |

### Intent Registry Tools (conditional — feature-gated)

> **Availability gate — read this before surfacing anything about intents.** The intent tools below are only registered when the DTwo MCP server is deployed with `enable_intent_tools: true`. **Marker tools (above) are always available; intent tools are not.** Before mentioning intent capture, intent registries, transitions, or intent/marker compatibility to the user, confirm the relevant `dtwo-*-intent*` tools are actually present in your available tool list. **If they are absent, the server is not configured for intent capture — do not present intent capture, the intent registry, transitions, or compatibility to the user, and do not attempt to call these tools.** Treat this subsection and the "Intent Capture" section below as inert in that case. Markers work fully without intent capture, so continue to use them normally.

When present, these tools manage the intent vocabulary and the rules that govern it. See the Intent Capture section for the workflow.

| Tool | Purpose |
|------|---------|
| `dtwo-set-intent` | Declare the current session intent (the working intent captured by the gateway's egress capture policy). Accepts only intents registered in the registry |
| `dtwo-list-intents` | List intents in the registry (platform `system=true` entries are read-only; customer-tier entries are tenant-scoped) |
| `dtwo-get-intent` | Fetch a single intent by UID |
| `dtwo-create-intent` / `dtwo-update-intent` / `dtwo-delete-intent` | Manage customer-tier intents in the registry vocabulary |
| `dtwo-list-intent-transitions` / `dtwo-set-intent-transition-mode` / `dtwo-add-intent-transition` / `dtwo-delete-intent-transition` | Govern which intent→intent moves are allowed |
| `dtwo-list-intent-compatibility` / `dtwo-create-intent-compatibility` / `dtwo-delete-intent-compatibility` | Govern which markers block which intents at `set_intent` time. `dtwo-create-intent-compatibility` takes `intentUid` + `excludedMarkerUid` |

### Pipeline & Gateway Tools

| Tool | Purpose |
|------|---------|
| `dtwo-list-gateways` | List gateways with optional filters (name, status, uid) |
| `dtwo-get-gateway` | Fetch a single gateway by UID |
| `dtwo-get-gateway-config` | Fetch the gateway's YAML configuration. Used here **read-only** to discover `mcp_servers[].name` and tool names when authoring policies (see Tool Discovery). Editing gateway YAML belongs to the companion `dtwo-gateway-config` skill |
| `dtwo-set-gateway-pipelines` | Attach policies to ingress/egress pipelines |
| `dtwo-get-gateway-pipelines` | Fetch ingress and egress pipeline steps for a gateway, including policy details |
| `dtwo-deploy-gateway` | Queue a deployment for the gateway |
| `dtwo-get-gateway-deployments` | List deployment tasks for a gateway |
| `dtwo-get-deployment` | Check status of a specific deployment |

### Deleting a Policy

`dtwo-delete-policy` performs a **permanent** delete by UID. This is different from `dtwo-revert-policy`, which only restores a prior version into the draft — it does **not** delete.

The delete **fails if the policy is still attached to any gateway**, so detach it everywhere first:

1. **Detach first** — remove the policy from all pipelines with `dtwo-set-gateway-pipelines` (pass `[]` to clear the relevant direction, or re-send the direction's steps without this policy), then redeploy each affected gateway. A detached policy remains in the policy list but has no runtime effect.
2. **Delete** — call `dtwo-delete-policy` with the `uid`. If it errors that the policy is still attached, a detach was missed (or a deploy hasn't landed) — re-check attachments with `dtwo-get-gateway-pipelines` before retrying.

Deletion is irreversible and confirmation-worthy — confirm with the user before calling `dtwo-delete-policy`. If they only want to stop the policy's runtime effect (not remove the record), detaching and redeploying is sufficient; leave the policy in place.

## Identifying the Target Gateway

Users typically refer to gateways by name. Use `dtwo-list-gateways` with the `name` filter to resolve a name to a UID. If the user hasn't specified a gateway and more than one exists, list the gateways and ask which one to use.

## Tool Discovery

When writing policies, you need exact tool names, argument schemas, and (for identity-aware policies) the shape of `input.subject.claims`. Use `dtwo-get-gateway-config` for tool names and `dtwo-list-claims` for claim names (details in Finding Identity Claims below) — falling back to the dump-input debug technique when you need actual claim *values* rather than just names — instead of guessing.

### Finding Tool Names

1. Use `dtwo-get-gateway-config` to retrieve the gateway's YAML configuration — the `mcp_servers[].name` values are the server name prefixes used in tool names.
2. The tool name appears in policies as `input.resource.name` (PARC) or `input.payload.name` (legacy alias) — both carry the same value, constructed as `<server-name>-<tool-name>`. The names visible when listing tools from the MCP server match what the gateway passes to OPA — no prefix stripping is needed.
3. Tool schemas include the full argument definitions (parameter names, types, required fields). Use these to write policies that check specific argument keys in `input.payload.args` — no guessing required.

### Finding Identity Claims

Pull claims when the policy will read `input.subject.claims` — i.e. when gating on identity such as `sub`, `email`, `org_id`, or `scope`. Skip for policies that only inspect tool names, arguments, or other non-identity inputs (content filters, channel allowlists, simple tool gating). When identity is in scope, knowing what claims the tenant has actually observed often surfaces a cleaner policy shape (for example, gating on `org_id` instead of a brittle email-substring match). The projected claim set varies by IdP, by the scopes the client requested, and by each gateway's `jwt_audience`, so don't assume — query.

**When to pull (decision triggers).** Pull when the user's request mentions any of:

- *Roles or groups:* "admins", "team", "department", "Marketing/Engineering/etc."
- *Identity attributes:* "user", "owner", "email", "external/internal", "contractor"
- *Authentication context:* "logged-in user", "service account", "API token"
- *Tenant/org concepts:* "tenant", "org_id", "customer X"

Skip when the request only references:

- *Tool names* ("block calls to slack-send-message")
- *Payload content* ("when message contains 'password'")
- *Channels or resources by ID* ("block writes to channel C123")
- *Pure rate or time constraints* ("after 5pm", "more than 10/min")

If ambiguous, ask the user one question rather than guessing — the call is cheap but pulling claims for a content-only policy clutters the agent's context.

**Primary path: `dtwo-list-claims`.** Returns the tenant-wide union of JWT claim names and issuers. Call it with no arguments by default. Pass `gatewayUid` only when the user has explicitly asked to scope the result to a single gateway (e.g., "what claims does the PARC Gateway see"); otherwise tenant-wide is the right default and gives a more complete picture.

**Fallback: dump-input policy.** Fall back to the dump-input technique (described in `dtwo-policy-rego` — see Debugging Policies + Identity (Subject and Claims)) when you need actual claim *values* for a specific caller (e.g. the exact `org_id` for a particular user), not just claim names — `dtwo-list-claims` only returns names and issuers. Rare edge case: if `dtwo-list-claims` returns an empty set the tenant has not yet observed *any* JWT traffic anywhere; making one real call populates the discovery store.

Detach the dump policy when done — the `dtwo-policy-rego` Common Pitfalls section warns about leaving an always-deny policy attached.

### Example

If `dtwo-get-gateway-config` shows an MCP server named `atlassian-jira-mcp`, and that server exposes a tool `atlassian-jira-mcp-getjiraissue` with parameters `{cloudId, issueIdOrKey, ...}`:

- Policy tool name: `atlassian-jira-mcp-getjiraissue` (matched against `input.resource.name` or `input.payload.name`)
- Available argument keys: `cloudId`, `issueIdOrKey`, etc.

## Policy Description Format

Every policy `description` is structured markdown with up to three sections. The field is rendered in a markdown editor that supports headings, bold, italic, lists, and code blocks.

```markdown
## Intent
<One sentence. The policy's durable goal — no tool names, claim names, or argument identifiers.>

## Description
<Optional. Free-form. History, ticket links, owners, expiry plans — anything that doesn't fit the other sections.>

## Implementation
<Optional. Only when there's something the Rego doesn't make obvious on its own.>
```

**Field rules:**
- **Intent** (required) — 1 sentence. The policy's durable goal, written so it remains true even if tool names, claim names, or argument schemas change. No tool/claim/argument identifiers. Agents should not edit Intent unless the user's goal has changed.
  - Good: *"Prevent exfiltration of secrets through outbound chat."*
  - Bad: *"Block `slack-mcp-slack-send-message` when `message` matches a secret regex."* (that's Implementation)
- **Description** (optional) — Free-form, user-owned. Any length. Use for context that doesn't fit the other two sections: history, ticket links, owners, expiry plans. Agents should not edit this unless explicitly asked.
- **Implementation** (optional) — Include only when there's something the Rego doesn't make obvious on its own. Most useful for:
  - **Interactions with other policies** in the same pipeline (e.g., "depends on `slack.ingress.allowlist` running first"; "must precede any redaction step that rewrites `message`")
  - Non-obvious choices (why a specific regex, threshold, or bypass exists)
  - Known limitations the Rego doesn't cover
  
  If the Rego is self-explanatory and stands alone, omit the section entirely.

**Examples:**

Common case — Intent + context notes, no Implementation needed:

```markdown
## Intent
Prevent secrets and PII from leaking to John via Slack DMs.

## Description
Added 2026-04 after a near-miss where an API key was almost pasted
into John's DM during an oncall handoff. Owner: paul@dtwo.ai.
Revisit once the org-wide secrets-DLP egress policy ships (DTWO-1234)
— this can likely be retired then.
```

With Implementation — when pipeline ordering matters:

```markdown
## Intent
Block Jira ticket creation from contractors outside business hours.

## Description
Compliance request from legal (DTWO-2210). Contractors are identified
by the absence of an `employee_id` claim.

## Implementation
Runs **after** `jira.ingress.tenant_isolation` in the pipeline —
relies on that earlier step having already rejected cross-tenant
calls, so this policy only inspects `input.subject.claims` and
business-hours, not `cloudId`. Reordering will produce false
allows.
```

## Policy Workflow

### Creating a New Policy

1. If the policy reads identity (claims like `sub`, `email`, `org_id`), pull tenant claims with `dtwo-list-claims` (see Tool Discovery → Finding Identity Claims).
2. If the target gateway fronts the DTwo MCP server, plan a `dtwo-*` passthrough before authoring — see Deploying → Self-lock risk.
3. Generate the Rego code using the guidance in the companion `dtwo-policy-rego` instructions
4. Validate with `dtwo-validate-policy-rego`
5. Create with `dtwo-add-policy` — provide:
   - `name` — human-readable policy name
   - `description` — structured markdown using the template in Policy Description Format (Intent required; Description and Implementation optional)
   - `policy` — the Rego code
   - `packageName` — the Rego package name (e.g., `jira.ingress.readonly`)
   - `direction` — `ingress` or `egress`
6. Attach the **draft** (unpublished) policy to a gateway with `dtwo-set-gateway-pipelines` — **omit** `policyVersion` to reference the draft
7. Deploy with `dtwo-deploy-gateway` and test the policy behavior
8. Once the draft is working as desired, publish with `dtwo-publish-policy`
9. Update the gateway pipeline to pin the published version with `dtwo-set-gateway-pipelines` and redeploy

### Modifying an Existing Policy

1. Fetch the current Rego and `description` with `dtwo-get-policy`
2. Review the current `description` before editing:
   - Preserve the existing **Intent** unless the user's goal has changed.
   - Update **Implementation** if the behavior change affects how this policy interacts with others or introduces non-obvious detail; otherwise leave it.
   - **Description** is the user's notes — do not edit unless explicitly asked.
   - If the description is missing or unstructured, backfill it using the three-section template in Policy Description Format before saving.
3. If the change might introduce or alter identity gating, pull tenant claims with `dtwo-list-claims` (see Tool Discovery → Finding Identity Claims).
4. Modify the Rego code using the guidance in the companion `dtwo-policy-rego` instructions
5. Save the updated Rego with `dtwo-update-policy` — provide `uid`, `policy`, and `packageName` (Rego is validated automatically when both are provided). Also pass `description` when Implementation was updated or the description was backfilled; preserve it unchanged otherwise.
6. If the policy is already attached to the gateway pipeline as a draft (no `policyVersion`), just deploy to pick up the new draft. If it was pinned to a published version, update the pipeline step by omitting `policyVersion` with `dtwo-set-gateway-pipelines`, then deploy.
7. Once working, publish with `dtwo-publish-policy`
8. Update the gateway pipeline to pin the new published version and redeploy

### Rolling Back a Policy

1. List versions with `dtwo-get-policy-versions`
2. Restore a previous version with `dtwo-revert-policy` (optionally publish immediately with `publish: true`)

## Pipeline Attachment

Use `dtwo-set-gateway-pipelines` to attach policies to a gateway's ingress and/or egress pipelines. Each pipeline step requires:

- `policyUid` — the policy's UID (from `dtwo-list-policies` or `dtwo-add-policy`)
- `evalNamespace` — the Rego package name declared in the policy (e.g., `jira.ingress.readonly`)
- `policyVersion` (optional) — controls which version of the policy to use:
  - **Omit** — use the **draft** (current unpublished version). Use this when testing a draft policy.
  - **`0`** — use the **latest published** version. Requires at least one published version to exist.
  - **`N`** (e.g., `1`, `2`) — pin to a **specific published** version.

Once a draft is working as desired, publish the policy and update the pipeline step to pin the published version number for stability.

Steps are evaluated in array order — place broader policies (e.g., access control) before narrower ones (e.g., argument transforms). If an earlier step denies, later steps are not evaluated.

Ingress and egress steps are independent arrays. Omitting a direction leaves it unchanged; pass `[]` to clear it.

## Deploying

`dtwo-deploy-gateway` is the only operation that affects a running gateway — all other changes (policy edits, pipeline attachment, publishing, reverting) modify draft or published state that is not live until a deploy happens. Always confirm with the user before deploying.

After attaching or modifying policies, you **must** deploy the gateway for changes to take effect on the running instance.

> **Self-lock risk before deploy.** If the policy you're about to deploy will deny calls to the DTwo MCP server itself (e.g., a `default allow := false` policy with no management bypass, or a debug policy that denies all requests), and your MCP client routes `dtwo-*` tools through this gateway, the deploy will lock you out — recovery requires the DTwo web UI. Before deploying, check `dtwo-get-gateway-config` for a `Dtwo` MCP server entry; if present and your client connects through this gateway, either add a `dtwo-*` passthrough rule to the policy or route management traffic through a different gateway. The Common Pitfalls section in `dtwo-policy-rego` covers the guarded-management-tool pattern in detail.

**Does the gateway restart on deploy?** It depends on what changed:

- **Policy-only deploys** (policy attach/detach, publish, pin/unpin, draft updates picked up by a deploy) — **no gateway restart.** Policy bundles are hot-reloaded into OPA without interrupting the gateway process or MCP client connections. Testing can begin as soon as the deployment status is `completed`.
- **Gateway configuration deploys** (YAML changes — adding/removing MCP servers, changing auth/JWKS, SSRF, CORS, etc.) — the gateway restarts, briefly disconnecting MCP clients (typically 5–10 seconds).

`dtwo-deploy-gateway` returns the task UID immediately; poll `dtwo-get-deployment` with that UID until `status: "completed"` before testing or further changes.

> **Client quirks during a configuration restart (Claude Code).** These only apply to gateway-config deploys, not policy-only deploys. Claude Code's MCP client surfaces two distinct transient error states; other MCP clients may reconnect transparently or surface different errors.
>
> 1. **`Streamable HTTP error: 502 Bad Gateway`** — the gateway is restarting but the MCP client connection is still alive. Keep retrying — this recovers automatically.
> 2. **`MCP server "<name>" is not connected`** — the MCP client has fully disconnected and will **not** auto-recover. Ask the user to reconnect the MCP server in their client (e.g., via the MCP server panel in VS Code or the CLI reconnect command), then resume polling.
>
> **Do not ask the user to reconnect unless you see the "is not connected" error.** The 502 errors resolve on their own. For policy-only deploys, neither error is expected.

## Verification

After deploying a gateway:

1. Poll `dtwo-get-deployment` until it returns `status: "completed"`. For policy-only deploys, polling is uneventful — the gateway doesn't restart, so no transient errors are expected. For gateway-configuration deploys, the gateway restarts; if a poll call fails with a 502 error, retry — the gateway is still restarting. If you get `"MCP server is not connected"`, ask the user to reconnect, then resume polling. Once status is `"completed"`, the gateway is live and ready to test.
2. Confirm the pipeline attachment landed as intended with `dtwo-get-gateway-pipelines`. Verify the expected policies are present at the expected step indexes, that `evalNamespace` matches each policy's `package` declaration, and that `policyVersion` pins match your intent (omitted = draft, `0` = latest published, `N` = pinned version).
3. Test based on the policy's purpose:
   - **Access control policies** — verify that allowed operations succeed and denied operations return a reason message
   - **Transform policies** — verify that ingress transforms rewrite tool arguments as expected, and egress transforms redact or modify response data correctly
4. Test individual policies in isolation first, then test the full pipeline — ordering of policies in a pipeline can affect the result (e.g., a transform in an earlier step may change data that a later step evaluates)
5. If a policy isn't working as expected:
   - **Blanket denies** (all tools blocked) — the most common cause is a package path mismatch between the policy's `package` declaration and the `evalNamespace` used when attaching. Verify they match exactly.
   - For deeper debugging, see the debugging guidance in the companion `dtwo-policy-rego` instructions (debug policies, blanket deny diagnosis)

## End-to-End Example

This section walks through one complete request — from natural-language prompt to a pinned, deployed policy — using a Slack DM content filter as the example. It stitches the abstract sections above (Tool Discovery, Policy Workflow, Pipeline Attachment, Deploying, Verification) into one correct assembly.

**User request:** "Create a policy that blocks DMs to John in Slack when the message contains sensitive information."

This example gates on tool name + payload content rather than identity, so the workflow's claims-fetch step is skipped (per Tool Discovery → Finding Identity Claims). For an identity-aware request like "block DMs to John from non-admin users", you'd insert a `dtwo-list-claims` call before step 1.

### 1. Resolve the gateway
Call `dtwo-list-gateways`. If the user hasn't named one and multiple exist, ask. Record the UID.

### 2. Inspect current pipeline state
Call `dtwo-get-gateway-pipelines` for that UID. This tells you whether new steps append cleanly, or risk colliding with existing transforms / deny policies.

### 3. Discover the tool name and arguments
Call `dtwo-get-gateway-config`. Read `mcp_servers[].name` — the server name prefixes policy tool names. For Slack, the send tool is typically `slack-mcp-slack-send-message` with args `{channel_id, message, thread_ts, ...}`. Do not guess; confirm from the config.

### 4. Look up resource IDs the policy depends on
For "DMs to John", you need John's Slack user ID (DMs use user IDs as `channel_id`). Use `slack-search-users` or equivalent. Capture the ID, and note the assumption that DM = user ID.

### 5. Hand off Rego authoring to `dtwo-policy-rego`
Invoke `Skill("dtwo-policy-rego")` (or your host's equivalent) with the exact tool name, channel ID, and the sensitive-content patterns agreed with the user. It returns a fenced Rego block.

### 6. Validate before creating
Call `dtwo-validate-policy-rego` with the Rego and its `packageName`. If validation fails, loop back to step 5 — do *not* create a broken policy.

### 7. Create the policy
Call `dtwo-add-policy` with `name`, `description`, `policy`, `packageName`, `direction`. Capture the returned `uid`. The draft is stored but not live.

Use the Policy Description Format template for `description`. For this example (Intent is required; Implementation is omitted because the Rego is self-explanatory):

```markdown
## Intent
Prevent secrets and PII from leaking to John via Slack DMs.

## Description
Requested by the security team after an oncall near-miss. Revisit
if a tenant-wide egress DLP policy ships — this may be redundant then.
```

### 8. Attach as a draft
Call `dtwo-set-gateway-pipelines` with the new step, **omitting `policyVersion`** so the draft is used. Preserve existing steps — do not overwrite them.

```json
{
  "ingressSteps": [
    { "policyUid": "<existing>", "evalNamespace": "...", "policyVersion": 1 },
    { "policyUid": "<new>",      "evalNamespace": "slack.ingress.no_sensitive_to_john" }
  ]
}
```

### 9. Confirm with the user, then deploy
Deployment is the first live-state change. State it plainly and wait for confirmation before calling `dtwo-deploy-gateway`. Capture the task UID. This example is a policy-only deploy, so no gateway restart and no MCP client disconnect is expected — see the *Deploying* section for the policy vs configuration distinction.

### 10. Poll until complete
Loop on `dtwo-get-deployment` until `status: "completed"`. For this policy-only deploy, polling should be uneventful — no 502s, no reconnect. If you ever do see a `502 Bad Gateway` or `"MCP server is not connected"` during a poll, the deploy probably also pulled in a pending gateway-config change; handle as described in *Deploying*.

### 11. Verify the attachment landed
Call `dtwo-get-gateway-pipelines` again. Confirm the new step is at the expected index with the right `evalNamespace` and the intended `policyVersion` (undefined for draft).

### 12. Test both sides
Invoke the guarded tool two ways:
- **Deny case** — sensitive content. Expect an OPA denial error. Proves enforcement works.
- **Allow case** — benign content. Expect success. Proves the policy is not over-blocking.

If the deny case fails silently (the request goes through), the most common cause is an `evalNamespace` / `package` mismatch — verify both match exactly.

### 13. Ask before publishing
Once both tests pass, **ask the user whether to publish**. They may want to tweak the Rego, add more test cases, or stabilize the draft in a later session before cutting a version — publishing is not reversible without a new version. If confirmed, call `dtwo-publish-policy` with a clear publish message (what the policy does + what was verified).

### 14. Re-pin the pipeline to v1 and redeploy (with confirmation)
After publishing, call `dtwo-set-gateway-pipelines` again with `policyVersion: 1` on the new step. Confirm the redeploy with the user before calling `dtwo-deploy-gateway`; poll as in step 10.

**Do not skip step 14.** Leaving the attachment on the draft does not take effect immediately, but the current draft state will be bundled into the *next* deploy of that gateway, whoever triggers it and whatever the reason. A later `dtwo-update-policy` edit — even an experimental one — will then go live on a deploy that was meant for an unrelated change. Pinning to a published version freezes runtime behavior against future draft edits.

## Managing Markers

Markers are session-state flags that policies write and later policies read to gate on. They give the gateway a shared, tenant-scoped, TTL-bounded "notepad" that survives across tool calls and across upstream MCP servers — a marker written during a Slack call is visible during the next Jira call in the same session. Use them to compose small single-purpose policies that signal to each other without shared code: a **writer** policy stamps a marker when it observes something (PII in a response, a production resource touched), and a **reader** policy on a different tool/pipeline/server gates on it.

Marker tools are always available (they do not require `enable_intent_tools`). The full lifecycle — register, author writer + reader, attach, deploy — runs through this skill plus `dtwo-policy-rego` for the Rego. The Rego authoring patterns (emitting `session_writes["marker:<ns>:<id>"]`, walking `input.context.session.policies` to read, and the `writableKeySchema` gotchas) live in the companion `dtwo-policy-rego` instructions — load that skill for the writer/reader bodies.

### Registering a marker

Register the marker in the vocabulary before any policy references it:

```
dtwo-create-marker(
  namespace = "acme",
  markerId  = "pii_detected",
  description = "Session received PII in a tool response",
  minimumTtlSeconds = 3600
)
```

- The full key is `marker:acme:pii_detected`. Customer markers live under any namespace except the reserved `internal` and `dtwo`.
- **`namespace` and `markerId` are validated here** — each must start with an alphanumeric and contain only alphanumerics, underscores, or hyphens (no dots, colons, spaces, etc.). This is the same per-segment rule enforced on `writableKeySchema[].name` (see Authoring the writer policy), so a marker you register is always writable via a policy's `writableKeySchema` — you can't register a key you then can't write to.
- `minimumTtlSeconds` is a **floor** — a writer policy may declare any TTL ≥ this. Raise it later with `dtwo-update-marker` if a writer needs a longer minimum.

### Authoring the writer policy — `writableKeySchema`

A policy that emits a marker must declare the key in its `writableKeySchema` (on `dtwo-add-policy` / `dtwo-update-policy`), or the gateway drops the write. Each entry is:

- `name` — the session-state key, matching the registered marker exactly (e.g. `marker:acme:pii_detected`).
- **Marker key format enforcement.** The tool boundary rejects `writableKeySchema[].name` values starting with `marker:` unless they match `^marker:[A-Za-z0-9][A-Za-z0-9_-]*:[A-Za-z0-9][A-Za-z0-9_-]*$` — exactly two colon-separated segments of alphanumerics, underscores, or hyphens, each segment starting with an alphanumeric (case-insensitive). Bare keys (no `marker:` prefix) are structurally validated by the backend instead. Registry *existence* — that the key is actually in the marker registry — is enforced separately at deploy time by the `marker-not-in-registry` rule (the deploy fails with `UnknownMarkerReferences`; see the Deploy-time validator note below).
- `jsonSchema` — a **stringified JSON object** (a JSON Schema) for the value the policy writes. Rejected at the tool boundary if it doesn't parse as a JSON object (arrays and primitives fail). Use it strictly (`additionalProperties: false`, `required` lists) so drift is caught. Add `"x-d2-is-marker": true` for marker keys.
- `ttlSeconds` — per-key TTL. For a marker key this must be **≥ the marker's registered `minimumTtlSeconds`**; a lower value is rejected at policy save time.
- `onDrop` — behavior when a write fails the schema: `"drop"` (default) silently drops the write (best-effort markers); `"deny_request"` hard-denies the tool call (use for security-critical writes so bugs surface loudly instead of silently letting the call through).

```
dtwo-add-policy(
  name = "acme-pii-detector",
  direction = "egress",
  packageName = "acme.egress.pii_detector",
  policy = <writer Rego — see dtwo-policy-rego>,
  writableKeySchema = [{
    name: "marker:acme:pii_detected",
    jsonSchema: "{\"type\":\"object\",\"required\":[\"marked_at\",\"source_action\"],\"properties\":{\"marked_at\":{\"type\":\"integer\",\"minimum\":0},\"source_action\":{\"type\":\"string\",\"minLength\":1}},\"x-d2-is-marker\":true,\"additionalProperties\":false}",
    ttlSeconds: 3600,
    onDrop: "deny_request"
  }]
)
```

### Attaching, deploying, and reading

1. Author the reader policy (walks `input.context.session.policies` for the marker key — see `dtwo-policy-rego`). The reader needs no `writableKeySchema`; it only reads.
2. Attach both with `dtwo-set-gateway-pipelines` — the writer on the direction that observes the signal (often egress), the reader on the direction that gates (often ingress). Preserve existing steps.
3. Deploy with `dtwo-deploy-gateway`. This is a **policy-only deploy** — hot-reloaded, no gateway restart, no MCP client disconnect (see Deploying).

**Deploy-time validator.** The deploy hard-rejects (`UnknownMarkerReferences`, the `marker-not-in-registry` rule) if any attached policy declares a `writableKeySchema` marker key that isn't in the registry. This is separate from the tool-boundary *format* check on the key (see Authoring the writer policy) — the format check runs at save time, the registry-existence check at deploy time. Register the marker *before* attaching a policy that writes it.

### Verifying a marker pipeline

Markers can't be verified the way a single policy can — there is no tool to read a session's active markers (see Marker constraints today), so verification is **behavioral, session-scoped, and order-dependent**. A marker does nothing until its writer fires, and its effect is only visible through the reader's decision:

1. **Confirm the deploy and attachment** as for any policy — poll `dtwo-get-deployment` to `completed`, then `dtwo-get-gateway-pipelines` to confirm both the writer and the reader landed with the expected `evalNamespace` and version pins.
2. **Trigger the writer first, in one session.** Make the tool call that satisfies the writer's condition (e.g. a response containing PII). This is what stamps the marker — nothing is active until the writer fires.
3. **Then exercise the reader in that same session.** Call the reader's guarded tool and confirm it now denies (or transforms) as intended. Because markers are session-scoped, this only proves out within the session where the writer fired.
4. **Confirm the negative case in a fresh session.** With no writer having fired (or after the TTL expires), the reader's tool should succeed — proving the reader blocks only when the marker is active, not unconditionally.

**Tip — validate with a short TTL, then raise it.** A production-length TTL (say an hour) makes iterating painful: a marker stamped in one test lingers and masks the next. During validation, give the marker a short TTL (e.g. 30–60s) so it self-clears between iterations and you can retest in the same session without waiting it out or starting fresh. The written TTL is the writer policy's `writableKeySchema.ttlSeconds`, and it must be ≥ the marker's registered `minimumTtlSeconds` — so lower **both** for testing: set the marker's `minimumTtlSeconds` low (`dtwo-create-marker`, or `dtwo-update-marker` if it already exists) and set the writer's `ttlSeconds` to match. Once the pipeline is validated, raise the writer's `ttlSeconds` to the desired length (`dtwo-update-policy`) and the marker's `minimumTtlSeconds` floor if you want to enforce it (`dtwo-update-marker`), then republish/redeploy.

Watch for these:

- **Order and session matter.** Calling the reader before the writer has fired, or in a different session, shows the marker as absent and the reader allowing — that is correct behavior, not a bug. Sequence the calls within one session.
- **A stale marker can mask a result.** If an earlier call already stamped the marker and its TTL hasn't expired, the reader keeps denying. Use a fresh session for a clean negative test, or test with a short TTL (see the tip above) so it clears on its own between iterations.
- **`onDrop: "deny_request"` surfaces schema problems as a denied *writer* call.** If the tool that should stamp the marker is itself denied, the written value likely failed its `writableKeySchema` (e.g. a float timestamp against a `type: integer` field — see the `time.now_ns()` gotcha in `dtwo-policy-rego`). Fix the value shape, not the reader.
- **To see the marker directly while debugging,** attach a temporary reader-side debug policy that dumps `input.context.session.policies` in a deny reason — the marker analog of the dump-input technique in `dtwo-policy-rego` (Debugging Policies). Detach it when done.

### Cleanup order (reverse of setup)

Skipping a step makes the next deploy fail with `UnknownMarkerReferences` (a policy still claims to write a marker that no longer exists). Tear down in reverse:

1. Update/remove the **writer policy** so it no longer references the marker in `writableKeySchema`; redeploy so the write contract leaves the bundle.
2. Delete any **intent/marker compatibility** rows that reference the marker (only relevant when intent tools are enabled — `dtwo-delete-intent-compatibility`); redeploy.
3. `dtwo-delete-marker` — nothing references it now. (`dtwo-delete-marker` does **not** currently check for policy references, so it can leave the bundle inconsistent if you skip step 1.)

### Marker constraints today

- **No "list active markers" tool.** `dtwo-list-markers` returns the registry *vocabulary* (the markers that are defined), not which markers are currently set on a given session. A policy can read active markers at evaluation time via `input.context.session.policies` (that's how reader policies work), but there is no MCP tool to query a session's live marker state on demand.
- **No "clear marker" tool.** Markers lift on their own when their TTL expires; there is no MCP tool to unset one mid-session. To recover from a marker that is blocking a session, wait out the TTL or start a new session.
- **Multiple writers land in separate per-writer slots.** If two policies declare and emit the same marker key, each write lands under its own writer UID; readers get "any-writer" semantics by walking `session.policies.*`. Prefer one canonical writer per marker.

## Intent Capture (conditional — feature-gated)

> **Availability gate — read this first.** Everything in this section depends on the DTwo MCP server being deployed with `enable_intent_tools: true`, which registers the `dtwo-set-intent` / `dtwo-*-intent*` tools listed under Intent Registry Tools. **Before presenting any of this to the user, confirm those tools are in your available tool list. If they are not, do not surface intent capture, the intent registry, transitions, or intent/marker compatibility — the deployment is not configured for it. Say only that intent capture is not enabled on this server if the user asks; do not walk them through a workflow they cannot run.** Markers (above) are unaffected and remain fully usable.

Intent capture lets the agent declare *what it's trying to do* (`dtwo-set-intent`), captures that into session state via an egress policy, and lets ingress policies gate downstream tools on the current intent. It builds on the same session-state mechanism as markers.

**Status.** This ships as **starter policies**, not an auto-injected platform feature — you attach them to a pipeline as drafts; nothing is auto-deployed. Registry-management tools are expected to stay on this server; `dtwo-set-intent` itself may move to a dedicated server later.

### The two starter policies

- **Egress capture** (package `set_intent.egress.intent_capture`, egress) — captures the declared intent into session state when `dtwo-set-intent` is invoked. Validates the proposal against the intent registry, normalizes the stored category, denies disallowed transitions, and denies when the registry marks the proposed intent incompatible with a marker currently active in the session (`intent_marker_incompatible`).
- **Intent-required gate** (package `set_intent.ingress.intent_required`, ingress) — **optional.** Denies every tool call until an intent has been set; `dtwo-set-intent` itself is always allowed so the agent can declare. Attach only when you want the gate enforced.

The Rego bodies and the two coupling requirements below are detailed in `dtwo-policy-rego` (Intent-capture policies). The two requirements that block them silently if missed:

- **Upstream server must be named `Dtwo`.** Both policies fire on tool names case-folding to `dtwo-set-intent` / `dtwo-set_intent`. The DTwo MCP upstream entry in the gateway's `mcp_servers` config **must** be named `Dtwo` (anything case-folding to `dtwo`). A different name silently bypasses capture and deadlocks the ingress gate.
- **UID placeholder swap.** Both policies share the capture policy's own UID (`REPLACE-WITH-INTENT-CAPTURE-POLICY-UID`). After `dtwo-add-policy` returns the real UID, replace the placeholder in both bodies and re-save. Until swapped, the ingress gate denies every non-`set_intent` call and the egress capture treats every set as first-set (no transition enforcement).

### Intent/marker compatibility

If a marker should block switching into a given intent, register a compatibility row so the egress capture denies `set_intent` while that marker is active:

```
dtwo-create-intent-compatibility(
  intentUid = <uid of the intent to protect>,
  excludedMarkerUid = <uid of marker:acme:pii_detected>
)
```

Example: once `marker:acme:pii_detected` is set, a `set_intent` to `incident_response` is blocked — the session already touched sensitive data.

**Set-time enforcement only.** The check runs at `set_intent` time. A marker raised *after* an intent is set does **not** retroactively invalidate the current intent. Markers accumulate; intents are validated at the decision point. Tell users this plainly so they don't design around a symmetric re-check that doesn't exist.

## Limitations

- This skill cannot author or modify Rego policies — see the companion `dtwo-policy-rego` instructions
- This skill cannot edit gateway YAML or add/remove MCP server entries — see the companion `dtwo-gateway-config` instructions
- This skill cannot delete a policy that is still attached to a gateway — detach via `dtwo-set-gateway-pipelines` and redeploy first, then delete with `dtwo-delete-policy` (see Deleting a Policy)
- This skill cannot evaluate policies outside a deployed gateway — verification requires live tool calls against the running gateway
- This skill cannot retrieve runtime evaluation logs or OPA decision history from the MCP surface
