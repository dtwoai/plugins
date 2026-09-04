---
name: "dtwo-gateway-policy"
description: |
  Create, validate, attach, publish, deploy, verify, and roll back Dtwo policies and their pipeline
  attachments — the system-of-record skill for policy lifecycle (create/update/publish/revert), pipeline
  lifecycle (attach/deploy/verify), the session-state marker registry, and (when intent tools are enabled)
  the intent registry.
  TRIGGER when: user says create/modify a policy, block/allow/redact something, attach/detach policy,
  set/update pipeline, publish/pin a policy version, or deploy gateway after a policy change; also manage a
  marker/marker registry; or (only when intent tools are enabled) intent capture/registry/transitions or
  intent/marker compatibility. Always pair with dtwo-policy-rego for the Rego authoring step.
  SKIP when: task is purely explaining existing Rego with no save/attach/deploy intent (use dtwo-policy-rego);
  or editing gateway YAML / MCP server entries (use dtwo-gateway-config).
---

<!-- © 2026 Dtwo, Inc. -->

# Dtwo Policy & Pipeline Manager

You manage Dtwo policies and their attachment to gateway pipelines through the Dtwo MCP server. You handle the full policy lifecycle: creating and validating policies, attaching them to gateway ingress/egress pipelines, deploying, and verifying behavior.

## Companion skills

This skill is typically used alongside others. Invoke them via the `Skill` tool when relevant (in other agents, use your host's equivalent skill-loading mechanism):

- **dtwo-policy-rego** — load at the start of any task that requires writing, modifying, or explaining Rego. Almost always load this together with `dtwo-gateway-policy` unless the task is pure pipeline attachment of an already-authored policy.
- **dtwo-gateway-config** — load when the task also involves editing gateway YAML or adding/removing MCP server entries.
- **setup** (the guided first-time setup skill, invoked as `/dtwo:setup`) — for a first-time user standing up their first gateway from scratch; it orchestrates the full onboarding journey and hands the policy/pipeline steps back to this skill.

## Core Concepts

Before choosing an approach, understand how the pieces relate. From smallest to largest:

- **Policy** — a single unit of Rego that makes one decision about one tool call: allow it, deny it, transform the request/response, and/or write a marker. Policies are authored with the companion `dtwo-policy-rego` skill and stored as records with a draft plus published versions. **A policy on its own is inert** — it does nothing until it is attached to a gateway and deployed.
- **Pipeline** — the ordered list of policies attached to a gateway in one direction. Each gateway has two: an **ingress** pipeline that runs *before* a tool call reaches the upstream server (inspect arguments, identity; block or rewrite the request), and an **egress** pipeline that runs *after* the tool returns (inspect the response; block or redact it). Steps run in array order, and an earlier deny short-circuits later steps — so ordering matters.
- **Gateway** — the runtime that fronts one or more upstream MCP servers and enforces its pipelines. Attaching or editing policies changes only stored state; a **deploy** is what makes the current pipelines live.
- **Marker** — a session-state flag one policy writes and another reads, letting policies coordinate *across* tool calls, directions, and upstream servers within a session (e.g. "PII was seen in an earlier response → block outbound sends now"). A marker is defined once in the registry, then used by a writer policy and a reader policy. See Managing Markers.
- **Intent** *(only when the intent tools are enabled)* — a declared session *purpose* captured into session state and gated on by policies. Built on the same session-state mechanism as markers, with its own registry. See Intent Capture, including its availability gate.

**Mental model:** *policies* are the decision logic; the *pipeline* is where and when they run; the *gateway* is what enforces them once deployed; *markers* (and *intent*, only when the intent tools are enabled — see the Intent gate below) are how policies share context beyond a single call.

**Which skill does what:** this skill (`dtwo-gateway-policy`) owns the lifecycle and orchestration — policy records, pipelines, the marker registry (and, when the intent tools are enabled, the intent registry), deploy, and verify. The companion `dtwo-policy-rego` skill owns the Rego logic *inside* a policy. Most authoring tasks use both.

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

## Quick start: create → attach → deploy a policy

The common path, end to end. Each step links to its detailed section below; the fully worked version is the End-to-End Example.

1. **Resolve the gateway** — `dtwo-list-gateways` (by name) → capture the UID.
2. **Author the Rego** — hand off to the `dtwo-policy-rego` skill; pull identity claims first (`dtwo-list-claims`) only if the policy gates on identity.
3. **Validate & create** — `dtwo-validate-policy-rego`, then `dtwo-add-policy` (name, description, policy, packageName, direction) → capture the policy UID.
4. **Attach as a draft** — `dtwo-set-gateway-pipelines`, **omitting** `policyVersion`, preserving existing steps.
5. **Deploy** — confirm with the user, then `dtwo-deploy-gateway`; poll `dtwo-get-deployment` to `completed`. (Policy-only deploys hot-reload — no gateway restart.)
6. **Verify** — `dtwo-get-gateway-pipelines` to confirm attachment, then test allow and deny paths.
7. **Publish & pin** — once verified and with user OK, `dtwo-publish-policy`, then re-attach with `policyVersion` pinned and redeploy.

For markers, session state, or (feature-gated) intent gating, see Managing Markers / Intent Capture. For removing a policy, see Deleting a Policy.

## Prerequisites

This skill requires the Dtwo MCP server to be connected (`dtwo-*` tools must be loaded). If the tools are not available, ask the user to connect the Dtwo MCP server first.

The tools listed below reflect the initial set. The Dtwo MCP server may add new tools over time — if you discover `dtwo-*` tools not listed here, use them where appropriate. Prefer newer, more specific tools over workarounds when available.

**Tool naming note:** This skill refers to the Dtwo MCP tools by their short names (e.g., `dtwo-list-gateways`). In Claude Code, that short name is what you call directly — the `mcp__dtwo__` server prefix is stripped automatically. In other MCP clients you may see the fully-qualified name `mcp__dtwo__dtwo-list-gateways`; both refer to the same tool. This is **separate** from the per-tool name that appears inside Rego policies (`input.payload.name`) — see the companion `dtwo-policy-rego` instructions for that.

## High-level workflow

See **Quick start** above for the create→attach→deploy path and **Creating a New Policy** / **Modifying an Existing Policy** for the detailed steps. Two invariants that apply throughout: author/modify Rego via the `dtwo-policy-rego` skill, and **validate before every create/update/publish/attach**; only deploy after confirming with the user, then verify.

## Rules

- Do not guess tool names or argument schemas when they can be discovered from gateway configuration and MCP tool metadata.
- Prefer testing draft policies before publishing and pinning versions.
- Treat pipeline changes as non-live until a deploy completes successfully.
- Do not treat `revert-policy` as deletion; detach first if the user wants removal from runtime behavior.
- Before authoring a policy for a gateway that fronts the Dtwo MCP server (a `Dtwo` entry in `mcp_servers`), plan a `dtwo-*` passthrough into the Rego. Without it, the deploy locks management calls out — see Deploying → Self-lock risk.

## Available Tools

### Policy Tools

| Tool | Purpose |
|------|---------|
| `dtwo-list-policies` | List policies with optional filters (name, direction, uid) |
| `dtwo-get-policy` | Fetch a single policy by UID (includes draft Rego code) |
| `dtwo-get-policy-versions` | List published versions for a policy |
| `dtwo-validate-policy-rego` | Validate Rego code without saving — useful for dry-run checks before committing changes (note: `dtwo-add-policy` and `dtwo-update-policy` also validate automatically) |
| `dtwo-add-policy` | Validate and create a new policy (requires name, description, policy, packageName, direction). Optionally pass `writableKeySchema` to declare the session-state keys the policy is authorized to write — required for any policy that emits a marker (see Managing Markers) |
| `dtwo-update-policy` | Update an existing policy's draft — any field (policy, packageName, name, description, direction, tags, `writableKeySchema`). Validates Rego when both policy and packageName are provided. `writableKeySchema` is tri-state: **omit** → leave unchanged; **`null`** → clear the field (policy keeps no writable keys); **`[]`** → set an explicit empty list (also leaves no writable keys — practically the same effect as `null`; use `null` as the reset); **`[...]`** → replace with that list |
| `dtwo-publish-policy` | Publish the current draft as a new version |
| `dtwo-revert-policy` | Restore a published `version` back into the draft. Pass `publish: true` to publish it immediately as well |
| `dtwo-delete-policy` | Permanently delete a policy by UID. Fails if the policy is still attached to one or more gateways — detach it from every gateway first (see Deleting a Policy). Distinct from `dtwo-revert-policy`, which only restores a prior version |
| `dtwo-list-claims` | Return the union of JWT claim names observed across the tenant, plus the issuers seen. Defaults to tenant-wide; pass `gatewayUid` to scope to a single gateway when the user asks. Call this when authoring or modifying identity-aware policies so rules can reference claims that actually exist; skip for policies that don't read `input.subject.claims`. |

### Marker Registry Tools

Markers are session-state flags that one policy writes and other policies read to gate on (see Managing Markers). These tools are **always registered** on the Dtwo MCP server — they do not depend on any feature flag.

| Tool | Purpose |
|------|---------|
| `dtwo-list-markers` | List markers in the registry (optional filters: `name` for exact FQID, `tag`). Returns the marker *vocabulary*, not which markers are currently active on a session |
| `dtwo-get-marker` | Fetch a single marker by UID |
| `dtwo-create-marker` | Create a customer-tier marker (requires `namespace`, `markerId`, `description`, `minimumTtlSeconds`; optional `tags`). Full key is `marker:<namespace>:<markerId>`. The tool requires only non-empty `namespace`/`markerId`; character-shape rules are validated server-side, not at the tool boundary. `internal` and `dtwo` namespaces are reserved for platform markers |
| `dtwo-update-marker` | Update mutable fields on a customer-tier marker (`description`, `tags`, `minimumTtlSeconds`) |
| `dtwo-delete-marker` | Delete a customer-tier marker. Platform-managed entries cannot be deleted |

What you register here is also visible to policy Rego as OPA data at `data.dtwo.intent_registry` — see The registry as policy data.

### Intent Registry Tools (conditional — feature-gated)

> **Availability gate — read this before surfacing anything about intents.** The intent tools below are only registered when the Dtwo MCP server is deployed with `enable_intent_tools: true`. **Marker tools (above) are always available; intent tools are not.** Before mentioning intent capture, intent registries, transitions, or intent/marker compatibility to the user, confirm the relevant `dtwo-*-intent*` tools are actually present in your available tool list. **If they are absent, the server is not configured for intent capture — do not present intent capture, the intent registry, transitions, or compatibility to the user, and do not attempt to call these tools.** Treat this subsection and the "Intent Capture" section below as inert in that case. Markers work fully without intent capture, so continue to use them normally.

When present, these tools manage the intent vocabulary and the rules that govern it. See the Intent Capture section for the workflow.

> **Customer-created intents are not customer-available yet.** Session intent is declared through the platform `set_intent` tool, which the gateway **auto-injects in-container** when `gateway.intent.enabled` is set — it is **not** a Dtwo MCP tool (and these registry-management tools do not include it). Intent capture is not yet enabled for customer use (pending product-management usability verification), so an intent you create with `dtwo-create-intent` (and any transitions or compatibility rows referencing it) should be treated as **inert for gating** for now. Only manage customer-tier intents when the user explicitly wants to pre-build that vocabulary; don't present it as immediately usable for gating.

| Tool | Purpose |
|------|---------|
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
| `dtwo-get-gateway-config` | Fetch the gateway's YAML configuration. Used here **read-only** to discover `mcp_servers[].name` and tool names when authoring policies (see Tool Discovery). Returns the **draft** config, which can diverge from what's deployed — confirm names against the deployed config before relying on them. Editing gateway YAML belongs to the companion `dtwo-gateway-config` skill |
| `dtwo-set-gateway-pipelines` | Attach policies to ingress/egress pipelines |
| `dtwo-get-gateway-pipelines` | Fetch ingress and egress pipeline steps for a gateway, including policy details |
| `dtwo-deploy-gateway` | Queue a deployment for the gateway |
| `dtwo-get-gateway-deployments` | List deployment tasks for a gateway |
| `dtwo-get-deployment` | Check status of a specific deployment |

### Deleting a Policy

`dtwo-delete-policy` performs a **permanent** delete by UID. This is different from `dtwo-revert-policy`, which only restores a prior version into the draft — it does **not** delete.

The delete **fails if the policy is still attached to any gateway**, so detach it everywhere first:

1. **Detach first** — remove the policy from all pipelines with `dtwo-set-gateway-pipelines` (pass `[]` to clear the relevant direction, or re-send the direction's steps without this policy), then redeploy each affected gateway. A detached policy remains in the policy list but has no runtime effect.
2. **Delete** — call `dtwo-delete-policy` with the `uid`. If the policy is still attached, the call fails with an error naming the gateways still referencing it. Use those names (or `dtwo-get-gateway-pipelines`) to find the remaining attachments, detach them, redeploy, and retry.

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

> **Naming note:** the `## Intent` heading here is the policy-description *field* (a one-line statement of the policy's goal). It is unrelated to the **Intent Capture** feature (session-purpose declared via `set_intent`) covered later — every policy has this description field regardless of whether intent capture is enabled.

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
2. If the target gateway fronts the Dtwo MCP server, plan a `dtwo-*` passthrough before authoring — see Deploying → Self-lock risk.
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
- `evalNamespace` — a label identifying this step within the pipeline. It has to be non-empty and unique among that pipeline's steps; beyond that the value is free (the Dtwo Hub writes `step_<random>`). It is **not** matched against the policy's Rego `package`, and it never reaches the gateway: the deploy parses the package out of the policy source, and the gateway keys policies by uid and by `(direction, package)`. Reusing the policy's package name here is a readable convention and nothing more, so the two differing is never the cause of a problem.
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

> **Self-lock risk before deploy.** If the policy you're about to deploy will deny calls to the Dtwo MCP server itself (e.g., a `default allow := false` policy with no management bypass, or a debug policy that denies all requests), and your MCP client routes `dtwo-*` tools through this gateway, the deploy will lock you out — recovery means detaching the policy in the Dtwo Hub (click **Gateways** in the left sidebar, open the gateway, then its **Policies** tab). Before deploying, check `dtwo-get-gateway-config` for a `Dtwo` MCP server entry; if present and your client connects through this gateway, either add a `dtwo-*` passthrough rule to the policy or route management traffic through a different gateway. The Common Pitfalls section in `dtwo-policy-rego` covers the guarded-management-tool pattern in detail.

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
2. Confirm the pipeline attachment landed as intended with `dtwo-get-gateway-pipelines`. Verify the expected policies are present at the expected step indexes and that `policyVersion` pins match your intent (omitted = draft, `0` = latest published, `N` = pinned version).
3. Test based on the policy's purpose:
   - **Access control policies** — verify that allowed operations succeed and denied operations return a reason message
   - **Transform policies** — verify that ingress transforms rewrite tool arguments as expected, and egress transforms redact or modify response data correctly
4. Test individual policies in isolation first, then test the full pipeline — ordering of policies in a pipeline can affect the result (e.g., a transform in an earlier step may change data that a later step evaluates)
5. If a policy isn't working as expected:
   - **Blanket denies** (all tools blocked) — start with the Rego itself: a `default allow := false` with no rule that matches, or a syntax error anywhere in the bundle, which makes OPA fall back to denying everything. A step's `evalNamespace` differing from the policy's `package` is not a cause: the two are unrelated.
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
Call `dtwo-get-gateway-pipelines` again. Confirm the new step is at the expected index with the intended `policyVersion` (undefined for draft).

### 12. Test both sides
Invoke the guarded tool two ways:
- **Deny case** — sensitive content. Expect an OPA denial error. Proves enforcement works.
- **Allow case** — benign content. Expect success. Proves the policy is not over-blocking.

If the deny case fails silently (the request goes through), check that the deploy completed and that the step is on the version you edited: a step pinned to `1` ignores draft edits. After that, use a debug policy to confirm the tool name and argument keys the rule matches on, per the debugging guidance in the companion `dtwo-policy-rego` instructions.

### 13. Ask before publishing
Once both tests pass, **ask the user whether to publish**. They may want to tweak the Rego, add more test cases, or stabilize the draft in a later session before cutting a version — publishing is not reversible without a new version. If confirmed, call `dtwo-publish-policy` with a clear publish message (what the policy does + what was verified).

### 14. Re-pin the pipeline to v1 and redeploy (with confirmation)
After publishing, call `dtwo-set-gateway-pipelines` again with `policyVersion: 1` on the new step. Confirm the redeploy with the user before calling `dtwo-deploy-gateway`; poll as in step 10.

**Do not skip step 14.** Leaving the attachment on the draft does not take effect immediately, but the current draft state will be bundled into the *next* deploy of that gateway, whoever triggers it and whatever the reason. A later `dtwo-update-policy` edit — even an experimental one — will then go live on a deploy that was meant for an unrelated change. Pinning to a published version freezes runtime behavior against future draft edits.

## Managing Markers

Markers are session-state flags that policies write and later policies read to gate on. They give the gateway a shared, tenant- and user-scoped, TTL-bounded "notepad" that survives across tool calls and across upstream MCP servers — a marker written during a Slack call is visible during a later Jira call for the same user (until it expires or is cleared). Use them to compose small single-purpose policies that signal to each other without shared code: a **writer** policy stamps a marker when it observes something (PII in a response, a production resource touched), and a **reader** policy on a different tool/pipeline/server gates on it.

Marker tools are always available (they do not require `enable_intent_tools`). The full lifecycle — register, author writer + reader, attach, deploy — runs through this skill plus `dtwo-policy-rego` for the Rego. The Rego authoring patterns (emitting `session_writes["marker:<ns>:<id>"]`, walking `input.context.session.policies` to read, and the `writableKeySchema` gotchas) live in the companion `dtwo-policy-rego` instructions — load that skill for the writer/reader bodies.

**Marker vs. general session key.** A registered marker is the right tool when the signal is meant to be **shared across policies** (a different policy reads it) or wants to be a registered, discoverable, governed session-wide indicator. For state that is **targeted to a single policy or one coordinated ingress/egress set**, an unregistered *general session key* (a bare `session_writes` key, no `marker:` prefix, no registry entry) is the lighter choice. Neither is access-isolated, and the bare keyspace isn't namespaced — see the decision table in `dtwo-policy-rego` → Session State & Markers → "Marker vs. general session key" before choosing.

**Start simple — the minimal marker is a boolean flag.** A writer stamps `marker:<ns>:<flag>` when it observes a condition; a reader denies (or transforms) whenever that key is present. Presence *is* the signal — no value semantics needed. That flag pattern (the PII example used throughout this section) is the recommended starting point; reach for value-carrying markers only when a flag won't do. Counters and other read-modify-write markers are possible but more involved — a self-incrementing writer has to read its own prior value and re-emit on every call, which keeps refreshing (pinning) the TTL — so they aren't a good first marker.

**Know these limits before you design:** no runtime inspection (verify behaviorally), tenant+user scope (state survives reconnects and new sessions until it lifts), and no agent-side clearing — a marker lifts either when its TTL expires or when a **person** approves a clear in a browser, which an agent can request but cannot complete. Full detail — and why each bites — is under **Clearing a marker** and **Marker constraints today** below.

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
- **Keep the key simple.** The tool requires only non-empty `namespace`/`markerId`; the character-shape rules are validated server-side (when a writer policy is saved and at deploy), not at this tool boundary. In practice, use lowercase alphanumerics with underscores or hyphens and avoid dots, slashes, and spaces, so the key is accepted everywhere it's referenced (registry entry, `writableKeySchema` name, and `session_writes` key must all match exactly — see Authoring the writer policy).
- `minimumTtlSeconds` is the **intended floor** for a writer policy's `ttlSeconds`. Adjust later with `dtwo-update-marker`. (Whether the floor is enforced, and the keep-in-sync caveat, are stated once under Authoring the writer policy → `ttlSeconds` — the canonical note.)

### Authoring the writer policy — `writableKeySchema`

A policy that emits a marker must declare the key in its `writableKeySchema` (on `dtwo-add-policy` / `dtwo-update-policy`), or the gateway drops the write. Each entry is:

- `name` — the session-state key, matching the registered marker **exactly** (e.g. `marker:acme:pii_detected`). Keys are exact-match and never normalized, so this `name`, the `session_writes` key, and the registered marker FQID must be byte-identical (including case) or the write silently drops. The tool accepts any non-empty string; marker-key *shape* (allowed characters, reserved prefixes) is validated server-side on save/deploy, and registry *existence* is enforced at deploy time — the deploy fails on an unregistered key (see the Deploy-time validator note below).
- `jsonSchema` — a **stringified JSON object** (a JSON Schema) for the value the policy writes. Rejected at the tool boundary if it doesn't parse as a JSON object (arrays and primitives fail). Use it strictly (`additionalProperties: false`, `required` lists) so drift is caught. Add `"x-d2-is-marker": true` for marker keys.
- `ttlSeconds` — per-key TTL. For a marker key this **should** be ≥ the marker's registered `minimumTtlSeconds`, but keep them in sync manually: the floor is **not yet enforced** (no save-time or deploy-time check today), so a lower value currently saves, deploys, and simply expires early.
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

**Deploy-time validator.** The deploy hard-rejects if any attached policy declares a `writableKeySchema` marker key that isn't in the registry, reporting which key is unregistered. This is separate from the key's structural validation (allowed characters, reserved prefixes), which the backend applies when the policy is saved — the registry-existence check runs at deploy time. Register the marker *before* attaching a policy that writes it.

### Clearing a marker

A marker has two exits: its TTL expires, or a **person approves a clear**. The second one is the fast path, and it is the one your deny reasons should offer first — a marker set at the start of an hour-long TTL can otherwise block someone for the rest of that hour over a condition they have already dealt with.

**An agent can request a clear; it cannot complete one.** Requesting returns a link to open in a browser and nothing an agent can act on. The person opens it, signs in interactively at the identity provider (a fresh login, even if they are already signed in), picks what to clear from a list the gateway builds, and confirms. Everything after the request happens in a browser, authenticated as a human.

**Why the person is in the loop.** A marker is worth exactly as much as the agent's inability to remove it. If the agent a marker constrains could also lift it, the marker would constrain nothing — it would be a speed bump with a documented way around, and every policy built on markers would inherit that. So the human step is not a convenience tax on the flow; it **is** the control. What the ceremony produces is evidence: a named person, freshly authenticated at that moment, explicitly authorized *this* clear of *these* specific values. That is also why the flow declines to be convenient — no arguments, so the agent cannot choose the target; one interactive login per clear, so an approval cannot be batched, reused, or replayed; and the same identity as the caller, so it cannot be handed to whoever happens to be at the keyboard.

**What that means for how you use it.** Never offer a clear as a way around a policy decision. If a block is correct, the answer is to stop and explain it — not to reach for the clear. A clear is appropriate when the state has outlived its purpose: the condition that raised the marker has been dealt with, and **the person**, never the agent, judges that it has. An agent that reflexively requests a clear on every denial is doing the exact thing the human gate exists to prevent, and once clearing is armed, every request is recorded whether or not anyone approves it (the unarmed refusal returns before anything is minted, so it emits no event).

What the shape means when you design a marker or word a deny reason:

- **The clear is not a management tool.** It arrives as an argument-less tool on the platform tool surface the gateway injects — `clear_markers`, alongside `clear_intent` and `set_intent` (on the wire, `dtwo-platform-intent-clear-markers` — the federated name is hyphenated throughout). There is no `dtwo-*` call that lifts a marker, and nothing to declare per policy.
- **No arguments, deliberately.** The agent cannot name a key, so it cannot choose the target. The confirm page enumerates what is actually live and unexpired in the caller's scope, and the person selects from that list.
- **The approver must be the same identity as the caller.** The browser login is matched against the identity the agent is calling with, so a person clears their own session state — not another user's. One login authorizes exactly one clear.
- **Markers and intent clear separately.** `clear_markers` offers every live `marker:` instance in scope, and flags one that is held by more than one writer — clearing a single holder leaves the marker standing, so each holder is acknowledged on its own. `clear_intent` only ever offers the platform-captured intent. An approved marker clear can never drop the intent, and the reverse holds too.
- **It is armed per gateway.** Clearing requires the `gateway.session_control` block in the gateway config, and that block should say so explicitly — `clearing: {enabled: true}` (see `dtwo-gateway-config`). Left implicit it arms only while intent capture is on and parks inert otherwise — a shape that leaves marker policies enforcing with no targeted way out of a marker. Unavailable looks two different ways: where clearing is not armed the platform clear tool may be **absent from your tool list entirely**, so there is nothing to call and no refusal to read; where it is present but unarmed, the request returns a readable "not configured on this gateway" refusal that points at the TTL. Handle both rather than assuming the flow is available. It fails closed throughout: nothing is ever half-cleared.
- **Confirm before requesting.** The request is a state change with a person on the other end of it — ask first, as you would before any state-changing call, and never fire one speculatively to "reset" a session.
- **The request, the authorization and the commit are each recorded** in the gateway's event stream, so a clear is answerable after the fact: who approved it, when, and which instances went.

**Wording deny reasons for this.** A reader policy's `reason` is what the blocked person actually sees, so it should name the fast exit first and keep the TTL as the fallback — see the deny-reason guidance in `dtwo-policy-rego` → Session State & Markers → Reading a marker.

### Verifying a marker pipeline

Markers can't be verified the way a single policy can — there is no tool to read active markers (see Marker constraints today), so verification is **behavioral and order-dependent**: a marker does nothing until its writer fires, and its effect is only visible through the reader's decision. The tenant+user scope (below) is what makes the negative case tricky, so mind it:

1. **Confirm the deploy and attachment** as for any policy — poll `dtwo-get-deployment` to `completed`, then `dtwo-get-gateway-pipelines` to confirm both the writer and the reader landed at the expected step indexes with the version pins you intended.
2. **Trigger the writer first.** Make the tool call that satisfies the writer's condition (e.g. a response containing PII). This is what stamps the marker — nothing is active until the writer fires.
3. **Then exercise the reader** (as the same user). Confirm the reader's guarded tool now denies (or transforms) as intended. The marker stays active until its TTL expires.
4. **Confirm the negative case with a clean marker.** Use a **short TTL and wait for it to expire**, test as a **different user** who hasn't triggered the writer, or — on a gateway with clearing armed — **request a clear and approve it** (see Clearing a marker). Then the reader's tool should succeed, proving it blocks only when the marker is active. Reopening the session as the *same* user does **not** clear the marker (tenant+user scope), so that is not a valid negative test.

**Tip — validate with a short TTL.** A production-length TTL (say an hour) makes iterating painful: a marker stamped in one test stays set for that user until it expires and masks the next attempt. During validation, set the writer's `writableKeySchema.ttlSeconds` short (e.g. 30–60s) so it clears on its own between iterations. (Since the floor isn't enforced, a short `ttlSeconds` deploys regardless; set the marker's `minimumTtlSeconds` to match via `dtwo-update-marker` so the registry still reflects intent.) Once validated, raise the writer's `ttlSeconds` to the production length with `dtwo-update-policy` (and `minimumTtlSeconds` to match), then republish/redeploy. (A short TTL is about **iterating quickly**, not about the only way out of a marker — approving a clear resets one on demand, but it takes a browser round trip each time, so the short TTL is still the better loop for repeated tests.)

Watch for these:

- **Order and identity matter.** Calling the reader before the writer has fired, or as a different user, shows the marker absent and the reader allowing — correct behavior, not a bug. Sequence writer-then-reader (reconnecting as the same user won't reset it).
- **A stale marker can mask a result.** If an earlier call already stamped the marker and its TTL hasn't expired, the reader keeps denying for that user. Negative-test with a short TTL you can wait out (see the tip) or as a different user.
- **`onDrop: "deny_request"` surfaces schema problems as a denied *writer* call.** If the tool that should stamp the marker is itself denied, the written value likely failed its `writableKeySchema` (e.g. a float timestamp against a `type: integer` field — see the `time.now_ns()` gotcha in `dtwo-policy-rego`). Fix the value shape, not the reader.
- **To see the marker directly while debugging,** attach a temporary reader-side debug policy that dumps `input.context.session.policies` in a deny reason — the marker analog of the dump-input technique in `dtwo-policy-rego` (Debugging Policies). Detach it when done.

### Cleanup order (reverse of setup)

Skipping a step makes the next deploy fail (a policy still claims to write a marker that no longer exists in the registry). Tear down in reverse:

1. Update/remove the **writer policy** so it no longer references the marker in `writableKeySchema`; redeploy so the write contract leaves the bundle.
2. Delete any **intent/marker compatibility** rows that reference the marker (only relevant when intent tools are enabled — `dtwo-delete-intent-compatibility`); redeploy.
3. `dtwo-delete-marker` — nothing references it now. (`dtwo-delete-marker` does **not** currently check for policy references, so it can leave the bundle inconsistent if you skip step 1.)

### Marker constraints today

- **No "list active markers" tool.** `dtwo-list-markers` returns the registry *vocabulary* (the markers that are defined), not which markers are currently set on a given session. A policy can read active markers at evaluation time via `input.context.session.policies` (that's how reader policies work), but there is no MCP tool to query a session's live marker state on demand.
- **No agent-side clear — by design, not by omission.** There is no management tool that unsets a marker, and no `dtwo-*` call that lifts one, because state an agent can remove does not constrain that agent. A marker lifts on TTL expiry, or through the human-approved clear flow described under **Clearing a marker** — which the agent can only *start*. Reopening the session as the same user does **not** clear it (state is scoped to tenant + user, not per connection).
- **Multiple writers land in separate per-writer slots.** If two policies declare and emit the same marker key, each write lands under its own writer UID; readers get "any-writer" semantics by walking `session.policies.*`. Prefer one canonical writer per marker.

## Intent Capture (conditional — feature-gated)

> **Availability gate — read this first.** Everything in this section depends on the intent surface being enabled: the registry-management `dtwo-*-intent*` tools are registered only when the Dtwo MCP server is deployed with `enable_intent_tools: true`, and the `set_intent` tool is auto-injected in-container only when the gateway sets `gateway.intent.enabled`. **Before presenting any of this to the user, confirm the relevant tools are actually available. If they are not, do not surface intent capture, the intent registry, transitions, or intent/marker compatibility — the deployment is not configured for it. Say only that intent capture is not enabled if the user asks; do not walk them through a workflow they cannot run.** Markers (above) are unaffected and remain fully usable.

Intent capture lets the agent declare *what it's trying to do* (via the in-container `set_intent` tool), captures that into session state via an egress policy, and lets ingress policies gate downstream tools on the current intent. It builds on the same session-state mechanism as markers.

**Status.** Intent capture is **not customer-available yet** — it stays gated pending product-management usability verification. The registry-management tools stay behind `enable_intent_tools` (a Dtwo MCP server flag), and `set_intent` now runs as a platform tool **auto-injected in-container** (via `gateway.intent.enabled`), not as a Dtwo MCP tool. The enforcement policies themselves are **platform-managed** (see below). Do not present intent capture as generally available until product sign-off.

### The enforcement policies are platform-managed

Two policies do the enforcement:

- **Egress capture** — captures the declared intent into session state when `set_intent` is invoked, validates it against the registry, normalizes the category, denies disallowed transitions, and denies when a currently-active marker is registered incompatible with the proposed intent (`intent_marker_incompatible`).
- **Intent-required gate** — optional: denies every tool call until an intent has been set (`set_intent` itself is always allowed so the agent can declare).

  > **Management lockout (same shape as the deny-policy self-lock).** When the intent-required gate is on **and the Dtwo MCP server is behind this gateway with your client routing `dtwo-*` through it**, your management calls are themselves denied with `intent_required` until you `set_intent` — you'll see it the moment you try to inspect or change the gateway. Declaring an intent clears it (`set_intent` is never gated). This only bites for Dtwo-behind-the-gateway setups; if your Dtwo MCP server runs *outside* this gateway, management traffic bypasses the gate and this does not apply. The intent can also lapse mid-session (TTL/clear), so you may need to re-declare — do so explicitly, don't auto-fire `set_intent` as a silent recovery.

**These are platform-managed policies — end users do not author, attach, copy, or modify them, and you should not offer to.** They are **automatically injected** when intent capture is enabled (`gateway.intent.enabled`); the platform owns their bodies and wiring (the auto-injected in-container intent server, internal UIDs), and their Rego may not be visible to users. If a user asks to write or change intent-capture Rego, decline and point them at the platform-managed feature rather than reconstructing it. The only intent surface users drive is the **registry** — the intent vocabulary, transitions, and marker compatibility (below), when the tools are enabled.

**Gating a tenant policy on the current intent** is allowed, though — a user policy may *read* the captured intent to decide access (e.g. "only allow this tool under the `internal:debug`/`internal:explore` intents" — compare against the full FQIDs, not the short form). When it does, it must read intent **only** through the platform helper `data.dtwo.lib.intent_match.*`, never via a direct `input.context.session.policies` read (a raw read is spoofable and couples to internals). The category values to compare against are the intent FQIDs from `dtwo-list-intents`. And it may **decide** on the intent but must **never return it** — do not interpolate the intent, or its caller-supplied `description`, into a deny `reason` or a transform; name the rule that fired instead. The Rego belongs to the companion `dtwo-policy-rego` skill — see its Intent-capture policies → Reading the session intent.

### Intent transitions (discoverability)

Moving between intents is itself governed, and a `set_intent` can be **denied for two independent reasons** — in both cases the current intent stays unchanged. This surprises authors mid-test:

- **`intent_change_disallowed` — transition rules.** The registry forbids that from→to move. Each entry carries `transitionsFromMode` (`ALL` / `RESTRICTED` / `NONE`) and, when `RESTRICTED`, an `allowedTransitionsFrom` list of the intents you may arrive *from*. Inspect it with `dtwo-list-intents` (or `dtwo-list-intent-transitions` when present). To reach a restricted target you may need an intermediate hop (e.g. `explore → debug → deploy` when `deploy` only allows arrival from `debug`/`review`/`incident_response`).
- **`intent_marker_incompatible` — an active marker blocks the target.** If a currently-set marker is registered incompatible with the intent you're switching *to*, the capture policy denies the `set_intent` (see Intent/marker compatibility below). So a marker stamped earlier in the session can make an otherwise-legal transition fail. If a `set_intent` fails and the transition rules allow it, check for an active incompatible marker: the way out is to clear that marker (**Clearing a marker** above) or wait for it to expire — the transition stays blocked until one of the two happens.

Both are distinct from any tenant gate you author on the intent value.

### Verifying an intent gate

An intent-gating tenant policy is verified behaviorally (there's no tool that reports the live intent). Mirror the marker verification flow, and mind the ordering traps:

1. **Confirm the deploy + attachment** as for any policy — poll `dtwo-get-deployment` to `completed`, then `dtwo-get-gateway-pipelines`.
2. **No-intent case → deny.** With no intent set, call the gated tool; a well-formed gate denies (the helper returns false when no intent is set). Proves the gate is live.
3. **Permitted-intent case → allow.** `set_intent` to one of the policy's allowed categories, then call the gated tool; expect success. (Confirm before calling `set_intent` — treat it as a state change, not an automatic step.)
4. **Disallowed-intent case → deny.** Move to an intent *outside* the allow-set and confirm the tool denies again — but remember step (3)'s intent may restrict which target you can transition to (see Intent transitions), so pick a reachable one.

Watch for:

- **Reachability, not policy, may block a test.** A `set_intent` can fail for reasons unrelated to your gate: `intent_change_disallowed` (transition rules) or `intent_marker_incompatible` (an active marker blocks the target intent — see Intent transitions). Don't chase either as a policy bug; resolve the transition/marker first, then test the gate.
- **Intent can lapse.** TTL/clear can drop the intent between steps; if a previously-allowed call starts denying, re-check the current intent before suspecting the policy.
- **Compare against FQIDs.** The gate matches `internal:debug` etc. (registry `name`), not the short form echoed by `set_intent` — an allow-set of short forms silently never matches.
- **Fail-closed when intent is disabled.** If the gate is deployed to a gateway where intent capture is *not* enabled, the helper is always false and the gated tool denies for everyone — verify against a gateway with the feature on.

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

## The registry as policy data — `data.dtwo.intent_registry`

> **Not gated.** Despite the name, this document ships to every gateway and always carries `markers[]`, so this section applies whether or not intent capture is enabled.

The vocabulary you register is not only a management surface: it is shipped into **every** gateway's policy bundle as OPA base data at `data.dtwo.intent_registry`, in the same atomic deploy as the Rego that reads it. A policy can therefore consult the registry at decision time instead of hard-coding the vocabulary. The document is always present and always fully populated — an empty tenant yields empty arrays, never a missing object — so a policy only handles empty lists, never an undefined registry.

```json
{
  "intents": [
    { "id": "acme:deploy", "description": "…",
      "aliases": ["ship"],
      "transitions_from": ["acme:review"] }
  ],
  "markers": [
    { "id": "marker:acme:pii_detected", "description": "…",
      "minimum_ttl_seconds": 3600 }
  ],
  "compatibility": [
    { "intent": "acme:deploy", "excluded_marker": "marker:acme:pii_detected" }
  ]
}
```

- Entries are keyed by **FQID** (`id`) — the same `name` the registry tools return. No UIDs appear in the data document.
- `markers[]` is there regardless of whether intent capture is enabled, so a marker-only gateway can still read it (e.g. to surface a marker's registered `description` or `minimum_ttl_seconds` in a message).
- `transitions_to` / `transitions_from` are **omitted when the move is unrestricted** and `[]` when it is locked — treat a missing field as "no restriction", not as an error. `aliases` is simply omitted when the entry has none.
- It is the tenant's whole vocabulary, not a slice for this gateway: an entry appearing here does not mean a policy on this gateway writes or reads it.
- Registry edits reach a gateway on its **next policy deploy**, not immediately — the data file rides the same bundle as the policies.

The Rego for reading it belongs to `dtwo-policy-rego`; the platform's own intent enforcement reads this same document.

## Limitations

- This skill cannot author or modify Rego policies — see the companion `dtwo-policy-rego` instructions
- This skill cannot edit gateway YAML or add/remove MCP server entries — see the companion `dtwo-gateway-config` instructions
- This skill cannot delete a policy that is still attached to a gateway — detach via `dtwo-set-gateway-pipelines` and redeploy first, then delete with `dtwo-delete-policy` (see Deleting a Policy)
- This skill cannot evaluate policies outside a deployed gateway — verification requires live tool calls against the running gateway
- This skill cannot retrieve runtime evaluation logs or OPA decision history from the MCP surface
