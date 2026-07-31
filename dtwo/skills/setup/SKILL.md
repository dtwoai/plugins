---
name: "setup"
description: |
  Guide a first-time user through complete DTwo gateway setup end to end — verify the DTwo MCP connection,
  choose a deployment type, create the gateway, configure authentication, add MCP servers, attach starter
  policies, publish, activate (self-hosted), deploy, and print ready-to-paste connection instructions.
  TRIGGER when: user is setting up DTwo for the first time, onboarding, just installed the plugin, or says
  "set up dtwo", "create my first gateway", "get me started", "walk me through setup".
  SKIP when: the user already has a gateway and wants a single focused change — editing gateway YAML or MCP
  server entries (use dtwo-gateway-config); attaching/detaching or publishing policies (use dtwo-gateway-policy);
  writing/modifying/explaining Rego (use dtwo-policy-rego).
---

<!-- © 2026 DTwo, Inc. -->

# DTwo Guided Setup

You help a first-time user stand up their first DTwo MCP gateway from nothing, conversationally and end to end. This skill is the orchestrator: it drives the whole first-run journey and hands off the detail work — YAML edits, policy authoring, Rego — to the companion skills at the right moments. Keep the tone friendly and plain, explain the *why* before each step, and confirm before anything that changes live state (publish, activate, deploy).

## Companion skills

This skill orchestrates the others. Invoke them via the `Skill` tool when a phase calls for their detail work (in other agents, use your host's equivalent skill-loading mechanism):

- **dtwo-gateway-config** — load for the MCP-servers phase (editing the draft config's `mcp_servers`, validating, saving) and any deeper config/auth questions. It owns the gateway YAML schema; don't duplicate that schema here.
- **dtwo-gateway-policy** — load for the policies and pipeline-attachment phases (creating/importing policies, `dtwo-set-gateway-pipelines`, publish/pin semantics).
- **dtwo-policy-rego** — load (usually via `dtwo-gateway-policy`) when the user wants to author a custom starter policy rather than import one from the catalog.

## Prerequisites

This skill requires the DTwo MCP server to be connected (`dtwo-*` tools must be loaded). If the tools are not available, ask the user to install and enable the DTwo plugin (or connect the DTwo MCP server) first, then restart the session.

The tools listed below reflect the current set. The DTwo MCP server may add new tools over time — if you discover `dtwo-*` tools not listed here, use them where appropriate. Prefer newer, more specific tools over workarounds when available. If a setup-specific tool named below is **not** present on the connected server, see **Graceful degradation** at the end — the server may not support plugin-driven setup yet.

**Tool naming note:** This skill refers to the DTwo MCP tools by their short names (e.g., `dtwo-list-gateways`, `dtwo-create-gateway`). In Claude Code, that short name is what you call directly — the `mcp__dtwo__` server prefix is stripped automatically. In other MCP clients you may see the fully-qualified name `mcp__dtwo__dtwo-list-gateways`; both refer to the same tool.

## Tools this skill uses

Setup-specific tools (may be newer — see Graceful degradation if any are missing):

| Tool | Purpose |
|------|---------|
| `dtwo-create-gateway` | Create a draft gateway with an empty config. Input `{ name, tags?, deploymentType? }` where `deploymentType` is `hostedAws` \| `standard` \| `localHttp`. For `hostedAws` it also queues AWS provisioning; errors clearly if a hosted gateway already exists (one per tenant) |
| `dtwo-set-gateway-auth` | Deterministically write the `gateway.authentication` block into the draft config. Input `{ uid, mode, customFields? }` where `mode` is `dtwo_default` \| `custom` \| `disabled` \| `removed`. `dtwo_default` uses the DTwo-managed Auth0 IdP (recommended default for `localHttp`). `customFields` carries `jwt_algorithm`, `jwt_jwks_uri`, `jwt_issuer`, `jwt_audience`, `sso_issuer` when `mode: custom` |
| `dtwo-get-gateway-connection-info` | Fetch client connection details. Input `{ uid }` → `{ mcpUrl, clientId?, audience, issuer, jwksUri, callbackPort: 33418 }`. For hosted gateways `mcpUrl` is `https://<hostname>/mcp`; may be unavailable for `standard` until you supply the hostname |
| `dtwo-get-gateway-activation` | Fetch the activation bundle for a **self-hosted** gateway. Input `{ uid }` → `{ activationId, activationCode, activationExpiresAt, composeText, composeFileName, activationCommand }`. Errors for `hostedAws` (nothing to activate — provisioning is managed) |
| `dtwo-refresh-gateway-activation` | Issue a fresh activation pair when the previous one has expired. Input `{ uid }` |

Existing lifecycle tools this skill leans on (documented in the companion skills):

| Tool | Purpose |
|------|---------|
| `dtwo-list-gateways` / `dtwo-get-gateway` | Discover existing gateways; check provisioning/heartbeat state |
| `dtwo-get-gateway-config` / `dtwo-save-gateway-draft-config` / `dtwo-validate-gateway-config` | Read, validate, and save the draft config (MCP servers) — via `dtwo-gateway-config` |
| `dtwo-list-catalog-policies` / `dtwo-get-catalog-policy-filters` / `dtwo-import-catalog-policy` | Browse and import starter policies from the policy catalog |
| `dtwo-add-policy` / `dtwo-publish-policy` | Create/publish a custom policy — via `dtwo-gateway-policy` + `dtwo-policy-rego` |
| `dtwo-set-gateway-pipelines` / `dtwo-get-gateway-pipelines` | Attach imported/created policies to the ingress/egress pipelines — via `dtwo-gateway-policy` |
| `dtwo-publish-gateway-config` | Publish the draft config as a version |
| `dtwo-deploy-gateway` / `dtwo-get-deployment` / `dtwo-get-gateway-deployments` | Deploy and poll deployment status |

## How to run this

Work through the phases below in order. Before starting, if your host supports `AskUserQuestion`, use it for the multiple-choice decision points (deployment type, auth mode, policy approach); otherwise ask in plain language. Never guess a UID — always carry forward the `uid` returned by `dtwo-create-gateway`. Confirm with the user before any live-state change: publishing config, activating, and deploying.

If the user is returning to a half-finished setup, jump to **Resuming a partial setup** first to figure out where to pick up.

---

### Phase 1 — Verify the connection

Call `dtwo-list-gateways`.

- **First-call OAuth.** The very first `dtwo-*` call in a session triggers a browser OAuth flow. Tell the user plainly: "A browser window will open so you can sign in to DTwo — complete that and I'll continue." If the call errors because the tool isn't available at all, see **Graceful degradation**.
- **No gateways yet** → this is a genuine first-time setup. Continue to Phase 2.
- **Gateways already exist** → ask whether they want to (a) set up a brand-new gateway anyway, or (b) switch to managing an existing one. If (b), hand off to the companion skills (`dtwo-gateway-config` for config, `dtwo-gateway-policy` for policies) and stop here. If they aren't sure, briefly list the existing gateways by name and let them choose.

### Phase 2 — Choose a deployment type and name

Explain the three options in one line each, then ask which they want:

- **hostedAws** — DTwo runs the gateway for you in the cloud. Zero local infrastructure. One hosted gateway per tenant.
- **localHttp** — runs on your machine via Docker. The quickest way to try DTwo with local MCP clients.
- **standard** — you self-host on your own infrastructure over HTTPS. Most control, most setup.

Then ask for a **gateway name** (short and memorable). Optionally ask for tags.

### Phase 3 — Create the gateway

Call `dtwo-create-gateway` with `{ name, tags?, deploymentType }`. Capture the returned `uid` — you'll carry it through every later phase.

- For **hostedAws**, creation also queues AWS provisioning; note that so the user knows something is happening in the background.
- **Hosted-already-exists error.** If `deploymentType: hostedAws` fails because a hosted gateway already exists (one per tenant), tell the user plainly and offer to either (a) reuse the existing hosted gateway (switch to managing it via the companion skills, or continue this flow against its `uid`), or (b) create a `localHttp` or `standard` gateway instead. Re-run `dtwo-create-gateway` with their choice.

### Phase 4 — Authentication

Authentication controls who may connect to the gateway. Choose per deployment type:

- **localHttp** — recommend `dtwo-set-gateway-auth` with `mode: dtwo_default`. This wires up the DTwo-managed Auth0 IdP so the gateway validates incoming tokens with no IdP setup on your side — the right default for trying DTwo locally. Also offer:
  - **custom IdP** (`mode: custom`) — collect `jwt_algorithm`, `jwt_jwks_uri`, `jwt_issuer`, `jwt_audience` (and `sso_issuer` if they have one) and pass them in `customFields`.
  - **disabled** (`mode: disabled`) — development only. Warn plainly: with auth disabled, anyone who can reach the gateway can call every tool behind it. Only for a local machine you control.
- **hostedAws / standard** — auth should be configured against a real IdP. Set it via `dtwo-set-gateway-auth` with `mode: custom` and the JWKS fields, but for anything beyond the four required fields defer to the **dtwo-gateway-config** skill's authentication section (the `jwks_info` block) rather than duplicating schema docs here. Load that skill if the user needs the full picture.

### Phase 5 — Add MCP servers

MCP servers are the tools the gateway fronts. Start with the fastest path, then offer custom servers.

**Quick start (recommended first).** Offer this curated list of zero-config remote MCP servers. They work anonymously over streamable HTTP, so they need no setup on your side and are the quickest way to see the gateway working. Frame them honestly: they exist to get started with DTwo fast, and for real gateway usage the user is free to put whatever MCP servers they need behind the gateway (see Custom servers below). Present them as a pick-list (use `AskUserQuestion` with multi-select where available; otherwise ask in plain language which the user wants, allowing several):

| Server | What it does | URL |
|---|---|---|
| Context7 | Up-to-date code documentation and examples for popular libraries | `https://mcp.context7.com/mcp` |
| DeepWiki | Ask questions about any public GitHub repository | `https://mcp.deepwiki.com/mcp` |
| Microsoft Learn | Official Microsoft and Azure documentation | `https://learn.microsoft.com/api/mcp` |
| Hugging Face | Search models, datasets, and Spaces on the Hub | `https://huggingface.co/mcp` |
| Cloudflare Docs | Search Cloudflare's developer documentation | `https://docs.mcp.cloudflare.com/mcp` |
| GitMCP | Turn any GitHub repository into a documentation source | `https://gitmcp.io/docs` |

For each one the user picks, add an `mcp_servers` entry with just three fields: `name`, `url` (the table URL), and `transport_type: streamablehttp` (one word, the value the config schema expects for new configs). Do not add an `authentication` block at all. These are public, anonymous servers, so they need no authentication, and leaving the block off is deliberate: writing `authentication: type: none` tells the gateway to forward your access token to the upstream, which public servers reject and which needlessly exposes your token. Omitting authentication is optional in the schema and validates cleanly. Use a kebab-cased id as the entry `name` (`context7`, `deepwiki`, `microsoft-learn`, `hugging-face`, `cloudflare-docs`, `gitmcp`), matching the DTwo Hub.

**Custom servers (anything else).** Any MCP server can go behind the gateway; this is the normal path for real usage. Collect its URL and transport from the user. When the upstream needs credentials, add an `authentication` block; the **dtwo-gateway-config** skill owns the supported types (bearer token, basic, custom headers, query parameter, OAuth, certificate) and how to author them, including the secret-placeholder rules. For a public or no-auth upstream, omit the block entirely, the same as the quick-start entries above. One caveat to state plainly: some servers, for example Slack, GitHub, or Jira, assume the user has the right access and need extra configuration on the app side (OAuth apps, API tokens, workspace approval) before the gateway can reach them, so they take a few more steps than the quick-start list.

Offer to add more than one server, from either group. Load the **dtwo-gateway-config** skill and follow its flow to edit `mcp_servers`, then `dtwo-save-gateway-draft-config` + `dtwo-validate-gateway-config`. Do not restate the config schema here, that skill owns it (including transport type, outbound auth variants, and secret-placeholder rules). If the user has no server in mind yet, it's fine to save an empty `mcp_servers` and add one later, but tell them the gateway won't front anything until a server is added.

### Phase 6 — Policies

Policies are what make the gateway *enforce* something rather than just proxy. Ask which approach they want:

- **Import recommended starter policies** — call `dtwo-list-catalog-policies` (use `dtwo-get-catalog-policy-filters` to find onboarding/starter tags and filter to those), show the user a short list, and `dtwo-import-catalog-policy` the ones they pick. This is the fastest safe start.
- **Author a custom policy** — hand off to **dtwo-gateway-policy** (which pulls in **dtwo-policy-rego** for the Rego) and create it with `dtwo-add-policy`.
- **Skip for now** — allowed, but warn plainly: with no policies attached, the gateway enforces nothing and every tool call passes through. They can add policies later with the companion skills.

Capture the `uid` of every imported or created policy for the next phase.

### Phase 7 — Attach policies to pipelines

Attach the imported/created policy UIDs to the gateway's ingress/egress pipelines with `dtwo-set-gateway-pipelines`, following **dtwo-gateway-policy** semantics (draft vs. published, version pinning, step ordering). If a policy must be published before it can be pinned, follow that skill's publish-then-pin flow. Skip this phase if the user skipped policies in Phase 6.

### Phase 8 — Publish the config

Confirm with the user, then call `dtwo-publish-gateway-config` to publish the draft as a version. This freezes the config the deploy will use; it is not yet live on a running gateway.

### Phase 9 — Activate (self-hosted only)

**Skip this phase entirely for `hostedAws`** — there is nothing to activate; provisioning was queued at creation. Instead, check `dtwo-get-gateway` (and `dtwo-get-gateway-deployments` if useful) to confirm provisioning has progressed before deploying in Phase 10.

For **localHttp / standard**, call `dtwo-get-gateway-activation` `{ uid }` to get `{ composeText, composeFileName, activationCommand, activationExpiresAt, ... }`. Then branch on whether your current environment can run shell commands:

- **Shell available (e.g. Claude Code with Bash).** Offer to do it for the user. If they agree: ask where to put the file, write `composeText` to `composeFileName` in that directory, then run `activationCommand` (it pulls and starts the gateway container, e.g. a `docker compose pull` / `up`). Stream the result back and confirm the container came up.
- **Shell NOT available (e.g. claude.ai / Claude Desktop without a local shell).** Present `composeText` as a copyable code block (named `composeFileName`) and the `activationCommand` as a copyable command, with a one-line explanation of each. Then wait for the user to confirm they've run it before continuing.

**Expired activation.** If `activationExpiresAt` has passed (or the activation command reports an expired/invalid code), call `dtwo-refresh-gateway-activation` `{ uid }` to get a fresh pair, then present/run the new one.

### Phase 10 — Deploy

Confirm with the user, then call `dtwo-deploy-gateway` `{ uid }`. Capture the returned task UID and poll `dtwo-get-deployment` until `status: "completed"` (or a failure).

- Follow the polling and transient-error guidance in **dtwo-gateway-config** / **dtwo-gateway-policy** (a config deploy briefly restarts the gateway; a `502` during the restart window is expected and recovers, while `"MCP server is not connected"` means the user must reconnect).
- **On failure**, surface the task error message plainly and offer concrete fixes (e.g. a config validation problem → back to Phase 5; provisioning not finished for hosted → wait and re-check `dtwo-get-gateway`; activation not completed for self-hosted → back to Phase 9).

### Phase 11 — Connect

Call `dtwo-get-gateway-connection-info` `{ uid }` and render ready-to-paste connection instructions from the returned `mcpUrl`, `clientId`, and `callbackPort` (33418).

Use a kebab-case token for `<name>` (derive it from the gateway name; the DTwo Hub falls back to `dtwo-local`). The static `<clientId>` is load-bearing, because without it the OAuth flow against the shared local-gateway app fails, so every client below must pass it.

Branch on whether your current environment can run shell commands, the same way Phase 9 does:

**Shell available (e.g. Claude Code with Bash).** Offer to register the gateway as an MCP server directly by running `claude mcp add` for the user. Confirm first, and confirm the server `<name>` (the kebab-case token described above). Then run the exact command:

```bash
claude mcp add --transport http \
  --client-id <clientId> --callback-port 33418 \
  <name> <mcpUrl>
```

After it succeeds, tell the user the server is registered, that the OAuth flow completes in the browser on first use, and that they may need a new or reloaded session before the server shows up. Mention that other client options (the `.mcp.json` form, or Cursor) are available if they want to connect a different client, and show those only if they ask.

**Shell NOT available (e.g. Claude Desktop).** Present all the connection options as copyable blocks for the user to apply themselves.

Claude Code, a CLI add plus an `.mcp.json` snippet:

```bash
claude mcp add --transport http \
  --client-id <clientId> --callback-port 33418 \
  <name> <mcpUrl>
```

```json
{
  "mcpServers": {
    "<name>": {
      "type": "http",
      "url": "<mcpUrl>",
      "oauth": {
        "clientId": "<clientId>",
        "callbackPort": 33418
      }
    }
  }
}
```

Cursor, an HTTP MCP server entry in `~/.cursor/mcp.json` (or a project-local `.cursor/mcp.json`) that carries the static client id under `auth.CLIENT_ID`:

```json
{
  "mcpServers": {
    "<name>": {
      "url": "<mcpUrl>",
      "auth": {
        "CLIENT_ID": "<clientId>"
      }
    }
  }
}
```

**If `dtwo-get-gateway-connection-info` returns no `clientId`** (common for hosted gateways), present the `mcpUrl` and explain that token/auth details depend on the gateway's configured IdP — the client completes auth against that IdP rather than the static-client flow above.

If `mcpUrl` isn't available yet (e.g. a `standard` gateway still needs its hostname, or hosted provisioning is mid-flight), say so and tell the user how to get it (re-run `dtwo-get-gateway-connection-info` once provisioning completes / the hostname is set).

Close by telling them what they can do next: make a real tool call *through* the gateway to confirm enforcement works, and manage config and policies going forward with the companion skills (`dtwo-gateway-config`, `dtwo-gateway-policy`, `dtwo-policy-rego`).

---

## Resuming a partial setup

Setup can be interrupted. Before starting from scratch, infer what's already done and continue from the first incomplete phase:

1. `dtwo-list-gateways` / `dtwo-get-gateway` — does the gateway exist? What's its `deploymentType` and provisioning/heartbeat state? (Exists → Phases 1–3 done.)
2. `dtwo-get-gateway-config` — is `gateway.authentication` set (Phase 4)? Are there `mcp_servers` entries (Phase 5)?
3. `dtwo-get-gateway-pipelines` — are policies attached (Phases 6–7)?
4. Published version present and a completed deployment (`dtwo-get-gateway-deployments`)? → Phases 8–10 done; likely just needs **Connect** (Phase 11).

Tell the user what you found ("Looks like your gateway exists with two MCP servers but no policies attached yet — want to pick up at the policies step?") and continue from there rather than redoing completed work.

## Graceful degradation

If a setup-specific tool this skill relies on (`dtwo-create-gateway`, `dtwo-set-gateway-auth`, `dtwo-get-gateway-connection-info`, `dtwo-get-gateway-activation`, `dtwo-refresh-gateway-activation`) is **not present** in your available tool list, the connected DTwo environment doesn't support plugin-driven setup yet. Don't try to reconstruct these steps by hand. Instead, tell the user plainly and point them to the guided setup in their DTwo Hub (their DTwo Hub → Dashboard → Setup), which walks through the same journey in the web UI. The other companion skills still work for managing a gateway once it exists.

## Limitations

- This skill orchestrates setup but does not itself own the config schema, policy lifecycle, or Rego — it hands those to the three companion skills.
- It cannot delete a gateway (do that in the DTwo Hub) or complete IdP-side setup for a custom identity provider (the user configures their IdP; the skill only records the JWKS parameters).
- Hosted provisioning and self-hosted activation happen partly outside the MCP surface (AWS provisioning, the user's Docker host) — the skill checks status and guides, but can't force those external steps to finish.
