# Suggestion-mode log

Research log of AI-generated proposals for closing skill defects.
**Entries are proposals, not merged changes.** A human reviews each
entry and decides whether to promote it to a `SKILL.md` PR, revise,
reject, or defer. The log captures the full loop so future
investigations can learn from past calls.

Pair with [`known-defects.md`](./known-defects.md) — every entry here
references a defect ID there.

## Why this exists

Running an AI meta-agent over bench failure data is cheap (~$1-3 per
pass, ~30s wall clock per defect). It sometimes surfaces explanations
or leverage points a human reviewer would miss. It also sometimes
hallucinates line numbers, misreads regexes, or forces a proposal
when "no change" is correct. The log is the mechanism for extracting
value from the first category without trusting the second.

## Workflow

### When to run

- **After any bench run where a fixture regresses below its
  `baseline.json` floor.** The fixture ID is the entry point; the
  failure breakdown is the input.
- **Opportunistically** when a defect in `known-defects.md` has
  stalled — a fresh meta-agent pass may reframe the hypothesis.
- **NOT** for fixtures that are currently `schema_gap_flagged` —
  those are schema issues, not skill issues, and the meta-agent
  has no leverage.

### How to run

Dispatch a subagent with a brief that:
1. Points at `SKILL.md`, the failing fixture(s), a counterexample
   fixture if one exists, and the relevant known-defects entry.
2. Summarizes the observed failure breakdown from results.json —
   specific rubric-check failures with short example messages, NOT
   the raw failure blob.
3. States the ambiguity honestly if there is one (SKILL.md fix vs
   harness fix vs fixture fix vs no fix). Do not pre-commit the
   framing; let the agent argue.
4. Requires the agent to quote the specific `SKILL.md` text it
   proposes to change, assess regression risk against a named
   counterexample fixture, give a confidence rating, and state an
   alternative hypothesis.
5. Gives an explicit escape hatch: "if minimal change is wrong,
   say so — don't force a proposal."
6. Caps output at 500 words.

See the three existing entries below for concrete brief shapes.

### How to review an entry

Review order matters. Verify facts before engaging with the
argument, because agent hallucination is frequent enough that an
unverified proposal is a trap.

1. **Verify the line-number citation.** Open `SKILL.md` at the
   quoted line. Confirm the text matches. Flag and discard the
   entry if it doesn't.
2. **Verify factual claims in the rationale.** Claims about "the
   regex accepts X", "the skill emits Y", or "fixture Z does W"
   must all pass a quick grep or a fixture read. This has caught
   errors in 1 of 3 entries so far.
3. **Apply the counterexample test.** The agent names a fixture
   that currently passes and argues the change won't regress it.
   Cross-check: does the proposed change plausibly affect the
   counterexample's success path? If yes, the agent's
   no-regression argument is weak.
4. **Weight the confidence.** `high` + sound reasoning is rare and
   valuable. `medium` means targeted bench validation before
   adopting. `low` means the proposal is interesting but
   speculative — run the validation plan, then decide.
5. **Consider the alternative hypothesis.** If it's clearly
   stronger than the primary proposal, use it instead.

### Verdict options

- **Accept** — write the `SKILL.md` PR as proposed. The human
  writes the final diff; do not commit the agent's raw output.
- **Accept with revision** — apply the core idea but edit the
  wording. Log the revision in this file's entry.
- **Reject** — note why. "Hallucinated citation", "regression
  risk unacceptable", "already covered elsewhere", etc.
- **Defer** — proposal is plausible but needs a held-out
  validation set, product conversation, or schema change first.
  Move to a parking-lot section of this file or the defect entry.
- **No-op** — agent correctly concluded no `SKILL.md` change
  fits. Entry closes without a PR.

### How to validate

For every `Accept` / `Accept with revision`:

1. Apply the change in a scratch SKILL.md (separate branch).
2. Run N=10 (minimum) at temperature=0 on the fixture that
   prompted the entry AND on any counterexample fixtures the
   agent named. Record in `history.jsonl`.
3. Pass criterion: the defect's failure mode drops to ≤1/10
   runs AND no counterexample regresses below its baseline
   floor.
4. If the signal is clean, commit the SKILL.md change as a
   product PR (separate from the harness PR). Update
   `known-defects.md` to mark the defect `resolved` with a
   link to the PR. Update this log entry's verdict to
   `Accept — landed in <commit>`.
5. If the signal is not clean, log the negative result in the
   entry and re-run suggestion-mode with the new data.

### Entry template

```
## <NN>. <defect-id> — <date>

**Status:** open | accepted | accepted-with-revision | rejected | deferred | no-op | landed
**Defect ID:** <matches known-defects.md>
**Fixtures referenced:** <list>
**Confidence (agent):** low | medium | high
**Verdict (reviewer):** <one line>

### Observed data
<brief summary of bench failures that prompted this>

### Proposed change
<diff or "none">

### Agent rationale (summary)
<2-3 sentences>

### Review notes
<citation verified? factual claims verified? counterexample risk?>

### Follow-up
<next action, linked PR, open questions>
```

## Parking lot

Ideas flagged for later — needs a held-out validation set, schema
conversation, or other prerequisite.

### Harness-side fixture linter for private-coded hostnames

**Source:** surfaced as the alternative in entry #3 (SSRF hostname).
**Scope:** harness-side, not SKILL.md.

Add a small linting pass over `fixtures/*.yaml` that warns (not
fails) when a fixture's `user_prompt` or explicit URL contains a
private-coded hostname — `.internal.`, `.corp.`, `.local`, bare
hostname, or an RFC 1918 IP literal — AND the fixture does not
declare `expect.safe_default_opt_out` containing
`gateway.ssrf.allow_private_networks`. Catches the authoring
mistake at authorship time (cheap — bench-free) rather than after
an N=10 run (~$30). One module, ~40 LOC, one test file.

**Why it's parked, not in scope this session:**
- Separates two concerns cleanly — suggestion-mode is about SKILL.md
  proposals; this is about fixture-authoring safety.
- Needs its own small plan (detection regex, warn-vs-fail policy,
  interaction with existing fixture loader).
- Good candidate for a future short harness PR, not an add-on to
  the current research commit.

**Prerequisites:** none — the detection patterns are already
enumerated in `known-defects.md` §3.

## Log

---

## 1. notion-jwks-drop — 2026-04-23

**Status:** open
**Defect ID:** `notion-jwks-drop` (known-defects.md §1)
**Fixtures referenced:** `notion-remote-oauth-dcr` (failing),
`linear-remote-dcr-streamable-http` (counterexample, passes 10/10)
**Confidence (agent):** medium-low
**Verdict (reviewer):** not yet decided — proposal is plausible;
validation pending

### Observed data

Pooled 30 runs (claude-cli, temperature=0, claude-sonnet-4-6):
~8/30 pass. Dominant failure in v2 batch (5/10): all four
`gateway.authentication.jwks_info.*` paths absent from emitted
YAML. Prompt supplies Auth0 tenant+audience (would populate them)
and an unusual "Notion only supports OAuth — bearer tokens are
not accepted" clause that Linear's prompt lacks.

### Proposed change

```
--- SKILL.md (line 98, Gateway Section → Authentication bullet)
+++ SKILL.md
 - **Authentication** defaults to enabled when omitted. Supports
   JWKS-based JWT verification, …
+- **Gateway-side `jwks_info` is independent of any
+  `mcp_servers[].authentication` block.** When the user supplies
+  an IdP tenant and audience (e.g. Auth0), always populate
+  `gateway.authentication.jwks_info` (`jwt_algorithm`,
+  `jwt_jwks_uri`, `jwt_issuer`, `jwt_audience`) — even when the
+  upstream MCP server uses OAuth/DCR, and even when the prompt
+  says the upstream server "only supports OAuth" or "does not
+  accept bearer tokens." Those statements describe the outbound
+  leg to the MCP server, not the inbound leg from clients to the
+  gateway.
```

### Agent rationale (summary)

The only Notion-vs-Linear prompt delta that plausibly suppresses
inbound JWT is the "bearer tokens are not accepted" clause — it
reads as a global anti-bearer instruction, and the skill generalizes
from it, skipping inbound `jwks_info`. The bullet disambiguates
inbound vs outbound legs.

### Review notes

- Line 98 citation **verified** (Gateway Section → Authentication).
- Hypothesis specifically names a Notion-vs-Linear prompt delta.
- Concern: "always populate" is strong; could regress rare gateways
  without inbound auth. Softened form ("when the prompt supplies
  IdP tenant+audience, populate…") preserves intent.
- Agent's own alternative (worked YAML contrast example in the
  Gateway Section) likely more effective than bullet-level prose —
  examples outweigh rules in LLM skill prompts empirically.

### Follow-up

If promoting: (a) soften to "when the prompt supplies…"; (b)
consider adding a short YAML example instead of or alongside the
bullet. Validate with N=10 on `notion-remote-oauth-dcr` (target
≥5/10 without regressing Linear below 9/10).

---

## 2. client-secret-not-placeholder — 2026-04-23

**Status:** open
**Defect ID:** `client-secret-not-placeholder` (known-defects.md §2)
**Fixtures referenced:** `entra-oauth-client-credentials` +
`cognito-oauth-client-credentials` (pre-coaching, 1-2/10 secret
failures); harness rubric `src/secrets.ts`
**Confidence (agent):** medium
**Verdict (reviewer):** revise-and-validate — direction is right,
wording needs trim

### Observed data

Pre-coaching: skill emitted bare `PLACEHOLDER` (no descriptive
suffix). Harness placeholder regex requires
`(REPLACE_|PLACEHOLDER_|CHANGE_?ME|YOUR[_-]|your[_-])` prefix with
suffix, or `${…}`. Bare `PLACEHOLDER` does NOT match — the harness
is strict by design. Post-coaching: skill emits
`REPLACE_WITH_CLIENT_SECRET`, `PLACEHOLDER_FILL_FROM_ENV`,
`CHANGE_ME`, `${OAUTH_CLIENT_SECRET}` — all accepted. Coaching
worked.

### Proposed change

```
--- SKILL.md (line ~129-130, MCP Server OAuth example)
+++ SKILL.md
-      client_id: "your-client-id"
-      client_secret: "your-client-secret"
+      client_id: "${OAUTH_CLIENT_ID}"
+      client_secret: "${OAUTH_CLIENT_SECRET}"
```

### Agent rationale (summary)

The skill imitates the SKILL.md OAuth example. Bare `PLACEHOLDER`
(the failing emission) is uninformative; switching the example to
`${ENV_VAR}` form steers the skill toward the more descriptive
variant that users actually want. The `${…}` branch is in the
regex, so any fixture currently passing with `your-…` continues to
pass (also in the regex).

### Review notes

- Line citation **not verified** yet (agent said 129-130; need to
  open SKILL.md and confirm the OAuth example lives there and
  uses `your-client-secret`).
- Factual claim **partially wrong:** agent wrote "Bare
  `PLACEHOLDER` is an accepted omission" — it is NOT (regex
  requires suffix). Proposal survives the error because it still
  pushes toward accepted forms; flag anyway.
- Changes two lines (`client_id` + `client_secret`) even though
  only `client_secret` is secret-typed. Reducing to one line is
  cleaner and avoids mis-steering the non-secret field.
- Counterexample test: a bearer-token fixture with `${…}` in the
  existing example must still work — probably fine since the
  example uses OAuth not bearer, but verify.
- Strongest move: agent's **alternative hypothesis** — one
  sentence under "Supported authentication types" explicitly
  stating that secret-typed fields must be emitted as `${ENV_VAR}`
  or `REPLACE_WITH_<FIELD>`, never as inferred values. This is
  more robust than example-imitation alone.

### Follow-up

If promoting: (a) verify line citation; (b) change only
`client_secret` in the example; (c) add the one-sentence rule
agent named as alternative. Validate with N=10 at temperature=0
on `entra-*` and `cognito-*` fixtures **with the current
post-coaching prompts reverted to pre-coaching form** — this
isolates the SKILL.md effect from the prompt-coaching effect.
Target: secret-placeholder failures drop from 1-2/10 to 0/10.

---

## 3. ssrf-opens-on-internal-hostname — 2026-04-23

**Status:** no-op
**Defect ID:** `ssrf-opens-on-internal-hostname` (known-defects.md
§3, status `won't-fix`)
**Fixtures referenced:** `entra-*`, `cognito-*`,
`mcp-server-refresh-interval` (pre-swap triggers); `ssrf-*`
(counterexamples that intentionally exercise SSRF opening)
**Confidence (agent):** high
**Verdict (reviewer):** accept no-op; pursue harness-linter
alternative separately

### Observed data

When upstream URL contains `.internal.` / `.corp.` / `.local` the
skill auto-enables `gateway.ssrf.allow_private_networks: true`.
Correct inference — `.internal.` hosts resolve to RFC 1918 space
which SSRF default deny would block. Surprised fixture authors but
not real users.

### Proposed change

None to SKILL.md. Optional: one-sentence cross-reference from
`fixtures/README.md` §SSRF tier rationale back to
`known-defects.md` §3 so a new fixture author searching "internal"
in the README lands on the authoring constraint.

### Agent rationale (summary)

The behavior is semantically correct. SKILL.md already states the
SSRF defaults and when they flip; enumerating hostname heuristics
would lock SKILL.md to a non-exhaustive list (only `.internal.`
and `.corp.` are confirmed) that ages badly. Real users running
against `.internal.` upstreams want the flip; fixture authors are
the atypical caller.

### Review notes

- No SKILL.md citation to verify.
- Reasoning is crisp — especially "documenting fuzzy heuristics
  ages badly," which is a sharper version of the won't-fix
  justification in `known-defects.md`.
- Agent's alternative — a harness-side fixture linter that
  warns when a fixture's URL contains a private-coded host and
  lacks `safe_default_opt_out` — is actually more valuable than
  any SKILL.md or README change. Catches the authoring mistake
  at the point of authorship rather than after a full N=10 run.
  Not in scope here but worth parking.

### Follow-up

No SKILL.md action. Park the harness-linter idea for a future
harness-PR cycle (one small module: detect private-coded hosts in
`fixtures/*.yaml`, fail-or-warn if `safe_default_opt_out` is
missing). Optional: the fixtures/README cross-reference to
known-defects is cheap — if anyone is editing the README, fold
it in.

---

## 4. path-a-schema-digest-inline — 2026-05-13

**Status:** open
**Defect ID:** n/a (architectural intervention, not a single-defect
fix — supersedes the schema-delegation refactor attempt logged on
`dtwoai/dtwo-plugin#5`)
**Fixtures referenced:** the full aspirational tier (17 fixtures)
under `--skip-injected-schema`; full battery deferred
**Confidence (agent / author):** medium — implementation-complete,
empirical validation pending
**Verdict (reviewer):** implementation landed locally on
`iter/schema-delegation`; bench validation deferred to a future
session

### Observed data

A 4-expert review of `dtwoai/dtwo-plugin#5`'s original
schema-delegation refactor concluded that production Claude Code
does NOT auto-load a skill's `references/` directory the way the
harness's `loadSkillBundle` does — only `SKILL.md` body lands in
the cached system prompt. Bench wins claimed under default harness
conditions (artifact pre-loaded into a separate cached block) do
not transfer to production users.

The filtered `schema-reference.json` is ~30,728 chars (~8-12k
tokens depending on tokenizer) — smaller than initially estimated
but still meaningful, and likely too vague-cited to be Read on
demand reliably.

### Proposed change

Generate a compact markdown digest from `schema-reference.json` at
plugin release time and embed it INLINE in SKILL.md between
sentinel markers. The plugin repo gains:

- `scripts/generate-schema-digest.mjs` — dependency-free Node ESM
  generator that mirrors `audienceFilter.ts`, renders Design C of
  a three-design fanout (per-field-rich / variants-only /
  structured-intermediate; picked the structured intermediate at
  ~2,675 tokens because it preserves the inbound-vs-outbound
  `jwks_info` framing and both `crossFieldConstraints[]` rules
  verbatim).
- Vendored `schema-reference.json` colocated with the consumer
  skill so the generator runs hermetically.
- `--check` mode for CI drift detection.
- Sentinel markers + the rendered digest in
  `dtwo/skills/dtwo-gateway-config/SKILL.md`.

The harness gains `--skip-injected-schema` (off by default;
preserves existing baselines) so a future bench can measure the
skill under production-equivalent context.

Landed in `dtwoai/dtwo-plugin` branch `iter/schema-delegation`
(commit `f024315` on top of the original prose-pointer attempt
`44f5747`) and `dtwoai/d2` branch `feat/gateway-config-skill-harness`
(commit `e2887e9e`). Neither pushed.

### Agent rationale (summary)

The original schema-delegation refactor (44f5747) was strictly
worse for production users: SKILL.md trimmed and pointing at
content production users won't access. Path A fixes the access
problem by putting the schema data on the SKILL.md side of the
production / harness loading boundary.

### Review notes

- Design fanout (3 agents) produced verbatim digests at 4,410 /
  898 / 2,675 tokens. Picked the 2,675-token structured
  intermediate; A overflowed the ~3k budget, B dropped per-field
  rationale.
- Four-reviewer pass (correctness / determinism / SKILL.md
  tension+cohesion / subtractive scope) returned ship-with-revisions.
  Tier-1 revisions applied: iterate constraints array (was `[0]`),
  newline-safe pipe-escape, warn on unknown variant, error message
  tells maintainer to commit regenerated SKILL.md.
- Tier-2 deferred: prose trimming under `### MCP Servers Section`
  (auth-types table compression, secret-fields enumeration
  consolidation), GitHub Actions workflow for `--check`.
- Determinism: regen-and-`--check` returns "in sync" on re-run.
  161/161 harness tests pass with the new flag.

### Follow-up

- **Empirical validation pending.** A bench cycle on the
  aspirational tier under `--skip-injected-schema` was attempted
  on 2026-05-13 against the PR#4 baseline as control. The run hit
  claude-cli rate / timeout limits ~15 min in: 100 of 170 samples
  returned `runner_error` (4 timeouts at 180s, then a cascade of
  `exit 1`). Only `adversarial-reserved-in-advanced` produced a
  usable signal (70% pass@10 under control). Treatment was not
  run — would have been poisoned by the same infrastructure
  failure.
- Re-run when claude-cli quota has reset (typically a 5-hour
  window) or with `--provider=anthropic` + an
  `ANTHROPIC_API_KEY`. Consider N=5 for the first cut to halve the
  load; widen to N=10 if the targeted-fixture wins look real.
- If validation passes: ship PR #5 as the digest-bearing SKILL.md,
  add a GitHub Actions workflow for `node scripts/generate-schema-digest.mjs --check`,
  and promote the harness's `--skip-injected-schema` flag to
  reviewed-and-shipped status on dtwoai/d2#755.
- If validation fails: document the null result in this log,
  consider whether the digest's compression dropped a load-bearing
  fact, and (per the parent task) move the work toward the Path C
  MCP-tool lookup at dtwoai/d2#912.

---
