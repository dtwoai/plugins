# CLAUDE.md

Guidance for Claude Code (and other agents) working in this repo. See [`README.md`](README.md) for the full maintainer walkthrough and [`dtwo/README.md`](dtwo/README.md) for end-user install docs.

## What this repo is

A **Claude Code plugin marketplace**. It ships one plugin today — `dtwo` — which bundles the Dtwo MCP server connection and the gateway/policy/Rego skills. Customers add the marketplace with `/plugin marketplace add dtwoai/plugins` and install with `/plugin install dtwo@dtwo`.

Layout: `.claude-plugin/marketplace.json` (marketplace manifest) at the root; the plugin lives under `dtwo/` (`.claude-plugin/plugin.json`, `.mcp.json`, `skills/<name>/SKILL.md`); `skill-harness/` holds tests/fixtures; `scripts/` holds generators.

## Bump the `plugin.json` version on every distributed-content change

Installs are **version-gated**: if the version doesn't change, `/plugin update` and fresh installs will **not** pick up the new content, even though the files changed. So any PR that changes distributed plugin content (a `SKILL.md`, `.mcp.json`, or anything else customers install) MUST bump `"version"` in `dtwo/.claude-plugin/plugin.json`.

The version lives **only** in `plugin.json`. Do not add a `version` to the plugin's entry in `.claude-plugin/marketplace.json`: Claude Code resolves the version as `plugin.json` → marketplace entry → git SHA, and the official docs warn that setting both lets a stale value silently mask the real one (`plugin.json` always wins without warning).

**When NOT to bump:** changes that touch only non-distributed paths — `skill-harness/`, `scripts/`, `README.md`, this file, CI config — do not ship to customers, so they don't need a version bump (see #19, a skill-harness dependency patch that correctly skipped it). The rule is: *bump when the installed plugin's content changes.*

If you add a second plugin to the marketplace later, the same rule applies: version in that plugin's own `plugin.json` only.

## Skills load `SKILL.md` only — keep grounding inline

Production Claude Code caches only each skill's `SKILL.md` in the system prompt; a skill's `references/` directory is **not** auto-loaded for real users. Anything a policy/skill author needs at authoring time must live inline in `SKILL.md`, not in a sidecar file.

The `dtwo-gateway-config` skill's `### Schema Digest` (between `<!-- BEGIN SCHEMA DIGEST -->` / `<!-- END SCHEMA DIGEST -->`) is **generated** from `dtwo/skills/dtwo-gateway-config/schema-reference.json` — do not hand-edit it. Regenerate with `node scripts/generate-schema-digest.mjs`; `--check` fails if it's stale, and the `skill-harness` suite runs exactly that, so `pnpm test` is what enforces it. The vendored schema is a verbatim copy of the artifact the product repo's schema generator emits; refresh it by copying, never by editing in place.

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
