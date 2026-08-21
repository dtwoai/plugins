# plugins

This repo is a **Claude Code plugin marketplace**. Today it ships one plugin — `dtwo` — which bundles the Dtwo MCP server connection and the gateway/policy/Rego skills for managing Dtwo gateways.

If you're a customer looking to install or use the plugin, jump to [`dtwo/README.md`](dtwo/README.md). The rest of this README documents the **layout and conventions** of the repo for maintainers and anyone adding another plugin to the marketplace.

## What's in here

```
plugins/
├── .claude-plugin/
│   └── marketplace.json     # marketplace manifest — lists every plugin in this repo
├── dtwo/                     # the dtwo plugin
│   ├── .claude-plugin/
│   │   └── plugin.json       # plugin manifest (name, version, metadata)
│   ├── .mcp.json             # MCP servers this plugin contributes (dtwo, HTTP + OAuth)
│   ├── skills/               # auto-discovered skills (each in its own dir with SKILL.md)
│   │   ├── setup/SKILL.md
│   │   ├── dtwo-gateway-config/SKILL.md
│   │   ├── dtwo-gateway-policy/SKILL.md
│   │   └── dtwo-policy-rego/SKILL.md
│   └── README.md             # end-user plugin docs
└── README.md                 # this file
```

## How a Claude Code plugin marketplace is structured

A **marketplace** is a git repo whose root contains `.claude-plugin/marketplace.json`. The manifest lists one or more **plugins**, each pointing at a subdirectory of the same repo (or a remote source). Customers add the marketplace once with:

```
/plugin marketplace add <owner>/<repo>
```

…then install individual plugins from it with:

```
/plugin install <plugin>@<marketplace>
```

Each plugin in turn is a directory laid out like this:

| Path                                  | Required | What it does                                                            |
| ------------------------------------- | -------- | ----------------------------------------------------------------------- |
| `.claude-plugin/plugin.json`          | yes      | Plugin manifest (`name`, `version`, metadata).                          |
| `.mcp.json`                           | optional | MCP servers the plugin registers when enabled.                          |
| `skills/<name>/SKILL.md`              | optional | Auto-discovered skills. One directory per skill, file must be `SKILL.md`. |
| `commands/*.md`                       | optional | Auto-discovered slash commands.                                         |
| `agents/*.md`                         | optional | Auto-discovered subagents.                                              |
| `hooks/hooks.json`                    | optional | Event hooks (`PreToolUse`, `Stop`, etc.).                               |

Auto-discovery scans these default paths automatically. Custom paths can be set in `plugin.json` but aren't needed for the standard layout.

The `dtwo` plugin uses only `skills/` and `.mcp.json` — the other optional paths (`commands/`, `agents/`, `hooks/`) are omitted.

## Adding another plugin to this marketplace

1. Create a new directory at the repo root, e.g. `dtwo-foo/`.
2. Add `dtwo-foo/.claude-plugin/plugin.json` with at minimum a `name` field.
3. Add the plugin's components (skills, `.mcp.json`, etc.) under that directory.
4. Add an entry to `.claude-plugin/marketplace.json`:

   ```json
   {
     "name": "dtwo-foo",
     "source": "./dtwo-foo",
     "description": "..."
   }
   ```

   The `source` string must start with `./` and point at a subdirectory — bare `"."` is rejected by the schema. Leave `version` out of the marketplace entry; it belongs in the plugin's own `plugin.json` (see [Releases](#releases)).

Customers will then install it alongside the existing plugin with `/plugin install dtwo-foo@dtwo`.

## Maintaining the schema digest (dtwo-gateway-config)

The `dtwo-gateway-config` skill's SKILL.md carries a `### Schema Digest` subsection between sentinel markers (`<!-- BEGIN SCHEMA DIGEST -->` / `<!-- END SCHEMA DIGEST -->`) that is **generated from `schema-reference.json`** — do not edit it by hand.

Why inline: production Claude Code does not auto-load a skill's `references/` directory; only `SKILL.md` is in the cached system prompt. To get field-level schema grounding to real users, the digest must live inline in SKILL.md.

To regenerate after a schema bump (or to confirm the digest is in sync):

```bash
# Copy the generated schema artifact from the product repo over the vendored
# copy, then regenerate
cp <path-to-generated-schema-reference.json> dtwo/skills/dtwo-gateway-config/schema-reference.json
node scripts/generate-schema-digest.mjs
git diff dtwo/skills/dtwo-gateway-config/SKILL.md

# Guardrail — exits 1 if SKILL.md is stale relative to the vendored schema.
# `skill-harness` runs this as a test, and CI (.github/workflows/skill-harness.yml) runs it on every PR.
node scripts/generate-schema-digest.mjs --check
```

Custom paths work too: `node scripts/generate-schema-digest.mjs --schema=PATH --skill=PATH`.

The generator refuses to write a digest that omits any user-audience field's
`target`, any cross-field constraint, or any `targetKind` the artifact emits —
so a schema refresh that introduces a field no renderer covers fails loudly
instead of silently dropping it. Add a renderer or an override-map entry.

**On every re-vendor**, also re-verify the three `GATEWAY_OWNED_SAFE_DEFAULTS`
entries in `skill-harness/src/safeDefaults.ts` against the corresponding
`rationale` strings in the refreshed artifact. Since artifact 1.1.0 those
fields declare their boot-time value as `gatewayDefault`, and
`buildSafeDefaults` throws when a hand-written entry disagrees with it — so a
refresh that flips one of these values fails loudly. The rationale re-read
still matters for what the machine check cannot see: whether the upstream
*guidance* about when to override the default has changed.

The generator is dependency-free (Node ESM, single file) so it runs anywhere
Node 17+ is available.

## Releases

Installs are **version-gated**: `/plugin update` and fresh installs only pick up changes when the version number changes. So **any change to distributed plugin content (a `SKILL.md`, `.mcp.json`, etc.) must bump the `version`** in the plugin manifest (`<plugin>/.claude-plugin/plugin.json`). The version lives only there — don't add one to the marketplace entry, since Claude Code always prefers the `plugin.json` value and a stale marketplace copy would silently mask it. Changes to non-distributed paths only (`skill-harness/`, `scripts/`, docs, CI) don't need a bump. Tag the release commit (e.g. `dtwo-v0.2.0`) so customers can pin to a specific version when needed. See [`CLAUDE.md`](CLAUDE.md) for the agent-facing version of this rule.

## Local development

To test changes without pushing:

```
/plugin marketplace add /absolute/path/to/plugins
/plugin install dtwo@dtwo
/reload-plugins
```

After edits, run `/plugin update dtwo@dtwo` followed by `/reload-plugins` to pick up changes.

When you're done, `/plugin uninstall dtwo@dtwo` and `/plugin marketplace remove dtwo` cleans up so the published GitHub install is unambiguous.

## License

[MIT](LICENSE). The plugin scaffold and skill prose are open source.
