---
name: "dtwo-gateway-policy"
description: |
  Create, validate, attach, publish, deploy, verify, and roll back DTwo policies and their pipeline attachments.
  This is the system-of-record skill: it owns the DTwo MCP tools for policy lifecycle (create, update,
  publish, revert) and pipeline lifecycle (attach, deploy, verify), and is responsible for confirming
  pipeline attachments before and after deployment.
  TRIGGER when: user says "create/add a policy", "modify/update a policy", "block/allow/redact something",
  "attach/detach policy", "set/update pipeline", "publish/pin policy version", "deploy gateway" after a
  policy change. Always pair with dtwo-policy-rego for the Rego authoring/modification step.
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
| `dtwo-add-policy` | Validate and create a new policy (requires name, description, policy, packageName, direction) |
| `dtwo-update-policy` | Update an existing policy's draft — any field (policy, packageName, name, description, direction, tags). Validates Rego when both policy and packageName are provided |
| `dtwo-publish-policy` | Publish the current draft as a new version |
| `dtwo-revert-policy` | Restore a published version back into the draft |
| `dtwo-list-claims` | Return the union of JWT claim names observed across the tenant, plus the issuers seen. Defaults to tenant-wide; pass `gatewayUid` to scope to a single gateway when the user asks. Call this when authoring or modifying identity-aware policies so rules can reference claims that actually exist; skip for policies that don't read `input.subject.claims`. |

### Pipeline & Gateway Tools

| Tool | Purpose |
|------|---------|
| `dtwo-list-gateways` | List gateways with optional filters (name, status, uid) |
| `dtwo-get-gateway` | Fetch a single gateway by UID |
| `dtwo-set-gateway-pipelines` | Attach policies to ingress/egress pipelines |
| `dtwo-get-gateway-pipelines` | Fetch ingress and egress pipeline steps for a gateway, including policy details |
| `dtwo-deploy-gateway` | Queue a deployment for the gateway |
| `dtwo-get-gateway-deployments` | List deployment tasks for a gateway |
| `dtwo-get-deployment` | Check status of a specific deployment |

### Deletion (not supported via MCP)

The DTwo MCP server does not expose a `delete-policy` tool. `revert-policy` restores a prior version — it does **not** delete.

When the user asks to delete a policy:

1. **Detach first** — remove the policy from all pipelines with `dtwo-set-gateway-pipelines` (pass `[]` to clear the relevant direction), then redeploy. A detached policy remains in the policy list but has no runtime effect.
2. **Delete via the DTwo web UI** — the MCP surface does not offer deletion.

If a `dtwo-delete-policy` tool later appears (see the tool-discovery note under Prerequisites), prefer it over this workaround.

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

Every policy must have a structured `description` written in markdown. Use the three-section template below. The field is rendered in a markdown editor that supports headings, bold, italic, lists, and code blocks.

```markdown
## Description
<General description of the policy — what it is and what it governs.>

## Intent
<One short sentence describing what the policy is trying to achieve, written so an LLM can understand the purpose at a glance. Example: "Prevent access to personal emails.">

## Implementation
<What the policy allows, blocks, redacts, or transforms, and how.>
```

**Field rules:**
- **Description**: 1–3 sentences, human-readable, general.
- **Intent**: 1 sentence max. Focus on the *goal*, not the mechanism. Written for LLM consumption — this is what a downstream agent reads to understand policy intent at a glance.
- **Implementation**: Always include this heading. If the Description already makes the behavior self-evident, say so briefly. Otherwise, describe the mechanism (specific tool names blocked, claim values checked, redaction patterns).

**Example** (Slack DM content filter):

```markdown
## Description
Blocks Slack direct messages to John (user ID U12345678) when the message contains sensitive information such as passwords, API keys, or PII.

## Intent
Prevent accidental or deliberate exfiltration of sensitive data via Slack DMs to a specific user.

## Implementation
Blocks ingress calls to `slack-mcp-slack-send-message` where `channel_id` equals `U12345678` and the `message` argument matches a sensitive-content pattern. All other Slack tools and DMs to other users are allowed.
```

## Policy Workflow

### Creating a New Policy

1. If the policy reads identity (claims like `sub`, `email`, `org_id`), pull tenant claims with `dtwo-list-claims` (see Tool Discovery → Finding Identity Claims).
2. If the target gateway fronts the DTwo MCP server, plan a `dtwo-*` passthrough before authoring — see Deploying → Self-lock risk.
3. Generate the Rego code using the guidance in the companion `dtwo-policy-rego` instructions
4. Validate with `dtwo-validate-policy-rego`
5. Create with `dtwo-add-policy` — provide:
   - `name` — human-readable policy name
   - `description` — structured markdown using the three-section template in Policy Description Format (Description / Intent / Implementation)
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
   - Preserve the existing **Intent** unless the user's goal changes.
   - Update **Description** or **Implementation** when behavior changes.
   - If the description is missing or unstructured, backfill it using the three-section template in Policy Description Format before saving.
3. If the change might introduce or alter identity gating, pull tenant claims with `dtwo-list-claims` (see Tool Discovery → Finding Identity Claims).
4. Modify the Rego code using the guidance in the companion `dtwo-policy-rego` instructions
5. Save the updated Rego with `dtwo-update-policy` — provide `uid`, `policy`, and `packageName` (Rego is validated automatically when both are provided). Also pass `description` when it was updated, normalized, or backfilled; preserve it unchanged for mechanical refactors that do not alter behavior and already have a structured description.
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

Use the Policy Description Format three-section template for `description`. For this example:

```markdown
## Description
Blocks Slack direct messages to John (user ID U12345678) when the message contains sensitive information such as passwords, API keys, or PII.

## Intent
Prevent accidental or deliberate exfiltration of sensitive data via Slack DMs to a specific user.

## Implementation
Blocks ingress calls to `slack-mcp-slack-send-message` where `channel_id` equals `U12345678` and the `message` argument matches a sensitive-content pattern. All other Slack tools and DMs to other users are allowed.
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

## Limitations

- This skill cannot author or modify Rego policies — see the companion `dtwo-policy-rego` instructions
- This skill cannot edit gateway YAML or add/remove MCP server entries — see the companion `dtwo-gateway-config` instructions
- This skill cannot delete a policy via the MCP surface — detach via `dtwo-set-gateway-pipelines`, then delete in the DTwo web UI
- This skill cannot evaluate policies outside a deployed gateway — verification requires live tool calls against the running gateway
- This skill cannot retrieve runtime evaluation logs or OPA decision history from the MCP surface
