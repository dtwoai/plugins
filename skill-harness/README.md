# dtwo-skill-harness

Benchmark harness for the [`dtwo-gateway-config` Claude skill][adr] shipped
in this plugin repo. Two testing layers, both in this package:

- **Offline rubrics** — deterministic property checks against a raw YAML
  config. Run in CI, no LLM. Sub-second.
- **Live bench** — runs the skill against Claude (`claude-cli` or
  `--provider=anthropic`), samples N times per fixture, scores each output
  against the rubrics, aggregates pass@k + Wilson 95% CIs, optionally
  compares to a committed baseline.

## What the rubrics check

Each generated YAML is evaluated against five deterministic checks. Any
failing check marks the sample as failed; the per-prompt pass-rate is
`fraction passing` of N samples.

| Check | What it catches |
|---|---|
| `must_validate` | Parses cleanly through `parseConfig` (vendored from d2's `@workspace/utils` as `vendor/config-validator.bundle.mjs`), including the reserved-`advanced`-key blocklist and newline-injection rejection. |
| `no_hallucinated_keys` | Every path in the YAML resolves to a real field in `schema-reference.json` (record-leaf children accepted when they match the leaf's declared key pattern). |
| `no_dropped_keys` | Round-trip path-set subtraction: `paths(input) \ paths(parsed)` must be empty. |
| `safe_defaults_preserved` | A small curated seed list of safety-relevant defaults must not be silently weakened. Fixtures opt out per-path with `expect.safe_default_opt_out`. |
| `secrets_are_placeholders` | Every `secret: true` leaf is absent or holds a placeholder matching `/^<?(REPLACE_\|PLACEHOLDER_\|CHANGE_?ME\|YOUR[_-]\|your[_-])\|^\$\{/`. |

Plus per-fixture `required_paths`, `forbidden_paths`, and
`value_constraints` (regex / equals / min_length).

`semantic_rubric` bullets are accepted but not yet evaluated (deferred to
an LLM-judge pass).

## Usage

### Offline (no LLM)

From the `skill-harness/` directory:

```bash
pnpm test                       # 161 unit tests
pnpm biome:check
pnpm bench --dry-run --tier=required
```

The dry-run prints the fixture selection and system-prompt stats without
issuing any LLM calls.

### Live bench

Two providers:

- `--provider=anthropic` — uses the Anthropic SDK; requires
  `ANTHROPIC_API_KEY`.
- `--provider=claude-cli` — shells out to `claude -p` and uses your local
  Claude login. No API key needed.

```bash
# Single fixture, statistically sampled
pnpm bench \
  --provider=claude-cli --temperature=0 --samples=10 \
  --prompts=notion-remote-oauth-dcr \
  --output=./bench-results/notion

# Full aspirational tier with regression gate + history append
pnpm bench \
  --provider=claude-cli --temperature=0 --samples=10 \
  --tier=aspirational \
  --compare-baseline=./baseline.json \
  --append-history=./history.jsonl
```

Each run writes `results.json` (canonical), `results.md` (PR-comment
ready), and `results.html` (workflow-artifact ready) under `--output`.

### CLI flags

| Flag | Default | Notes |
|---|---|---|
| `--prompts=<glob>` | `*` | Tiny glob: `*` → `.*`, `?` → `.`. |
| `--tier=<required\|aspirational\|all>` | `all` | |
| `--samples=<int>` | per-tier defaults (5/3) | `--samples=1` is honored as 1 (a previous version conflated 1 with default). Supersedes `--n`. |
| `--n=<int>` | — | Override runs per fixture for both tiers. |
| `--temperature=<float>` | `0.2` | `0` for reproducible runs. |
| `--model=<id>` | `claude-sonnet-4-6` | |
| `--provider=<anthropic\|claude-cli>` | `anthropic` | |
| `--output=<dir>` | `./bench-results/` | |
| `--compare-baseline=<path>` | — | Loads baseline.json, runs comparison, exits non-zero on regression. |
| `--append-history=<path>` | — | Appends one JSON line per run. |
| `--write-baseline=<path>` | — | Derives a fresh baseline from the current run. Mutually exclusive with `--compare-baseline`. |
| `--skill-bundle=<path>` | sibling checkout of `dtwoai/plugins` | Path to the `dtwo-gateway-config` skill dir (contains `SKILL.md`). Falls back to `DTWO_SKILL_BUNDLE_PATH` env then well-known sibling paths. The skill was moved out of d2 in #775. |
| `--dry-run` | off | Prints fixture list + stats; no LLM calls. |

## Skill-bundle location

The `dtwo-gateway-config` skill was moved out of d2 via PR #775
(2026-04-28) and now lives canonically in [`dtwoai/plugins`][plugin]
at `dtwo/skills/dtwo-gateway-config/`. The harness resolves the bundle
in this order:

1. `--skill-bundle=<path>` CLI flag (cwd-relative or absolute).
2. `DTWO_SKILL_BUNDLE_PATH` env var.
3. Sibling-checkout paths next to the d2 worktree:
   `../plugins/dtwo/skills/dtwo-gateway-config` and
   `../../plugins/dtwo/skills/dtwo-gateway-config`.

Clone the plugin alongside this worktree for the defaults to work:

```bash
cd <parent-of-this-repo>
git clone git@github.com:dtwoai/plugins.git
```

The bench fails fast with an actionable error if none of the three
sources resolve to a directory containing `SKILL.md`.

[plugin]: https://github.com/dtwoai/plugins

## Document map

Read these in order when picking up the package cold:

- **`fixtures/README.md`** — fixture format, the 28-fixture battery, the
  coached-vs-raw policy, schema-gap convention.
- **`baseline.json`** — committed per-fixture pass-rate floors. Source of
  truth for the regression gate.
- **`known-defects.md`** — catalogued skill defects with repro rates,
  hypotheses, and harness-side treatment.
- **`suggestion-log.md`** — research log of AI-generated SKILL.md change
  proposals. Includes a workflow section for human reviewers. Entries are
  proposals, not merged changes.
- **`history.jsonl`** — append-only per-run log. One JSON line per bench
  invocation with headline + per-fixture stats.

## References

- [ADR 014 — Gateway Configuration Skill][adr] (in `dtwoai/d2`)
- `../dtwo/skills/dtwo-gateway-config/schema-reference.json` — canonical schema artifact (mirrored from d2's `@workspace/utils`)
- `vendor/config-validator.bundle.mjs` — bundled `parseConfig` + `ConfigSchema` (regenerated in d2 via `pnpm --filter @workspace/utils build:validator-bundle`)

[adr]: https://github.com/dtwoai/d2/blob/main/docs/adr/014-gateway-config-skill.md
