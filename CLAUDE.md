# CLAUDE.md

Guidance for Claude Code (and other agents) working in this repo. See [`README.md`](README.md) for the full maintainer walkthrough and [`dtwo/README.md`](dtwo/README.md) for end-user install docs.

## What this repo is

A **Claude Code plugin marketplace**. It ships one plugin today — `dtwo` — which bundles the DTwo MCP server connection and the gateway/policy/Rego skills. Customers add the marketplace with `/plugin marketplace add dtwoai/plugins` and install with `/plugin install dtwo@dtwo`.

Layout: `.claude-plugin/marketplace.json` (marketplace manifest) at the root; the plugin lives under `dtwo/` (`.claude-plugin/plugin.json`, `.mcp.json`, `skills/<name>/SKILL.md`); `skill-harness/` holds tests/fixtures; `scripts/` holds generators.

## Bump the version on every distributed-content change — BOTH files, in lockstep

Installs are **version-gated**: if the version doesn't change, `/plugin update` and fresh installs will **not** pick up the new content, even though the files changed. So any PR that changes distributed plugin content (a `SKILL.md`, `.mcp.json`, or anything else customers install) MUST bump the version in **both** places:

- `dtwo/.claude-plugin/plugin.json` → top-level `"version"`
- `.claude-plugin/marketplace.json` → the plugin entry's `"version"`

They must stay equal. It is easy to bump `plugin.json` and forget `marketplace.json` — don't. Verify both with:

```bash
grep -n '"version"' dtwo/.claude-plugin/plugin.json .claude-plugin/marketplace.json
```

Precedent: #15 (1.0.0→1.0.1) and #16 (1.0.1→1.0.2) each bumped both files together; #18 added Entra guidance and bumped both to 1.0.3.

**When NOT to bump:** changes that touch only non-distributed paths — `skill-harness/`, `scripts/`, `README.md`, this file, CI config — do not ship to customers, so they don't need a version bump (see #19, a skill-harness dependency patch that correctly skipped it). The rule is: *bump when the installed plugin's content changes.*

If you add a second plugin to the marketplace later, the same lockstep applies to that plugin's own `plugin.json` and its `marketplace.json` entry.

## Skills load `SKILL.md` only — keep grounding inline

Production Claude Code caches only each skill's `SKILL.md` in the system prompt; a skill's `references/` directory is **not** auto-loaded for real users. Anything a policy/skill author needs at authoring time must live inline in `SKILL.md`, not in a sidecar file.

The `dtwo-gateway-config` skill's `### Schema Digest` (between `<!-- BEGIN SCHEMA DIGEST -->` / `<!-- END SCHEMA DIGEST -->`) is **generated** from `dtwo/skills/dtwo-gateway-config/schema-reference.json` — do not hand-edit it. Regenerate with `node scripts/generate-schema-digest.mjs` (add `--check` for the CI guardrail that fails if it's stale). The vendored schema comes from the d2 source of truth (`d2/packages/libs/utils/schema-reference.json`).

## Test locally before pushing

```
/plugin marketplace add /absolute/path/to/plugins
/plugin install dtwo@dtwo
# after edits:
/plugin update dtwo@dtwo && /reload-plugins
```

Clean up when done: `/plugin uninstall dtwo@dtwo` then `/plugin marketplace remove dtwo`.

## This repo is public (MIT)

The scaffold and skill prose are open source. Don't reference internal-only repos, ADR numbers, build tags, or infrastructure in committed content — keep it to what a customer or external contributor should see.
