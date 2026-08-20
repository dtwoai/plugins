# Known defects — `dtwo-gateway-config` skill and harness

Defects in the skill surfaced by the N=10 bench harness, and defects in
the harness itself that distort what the bench reports. **Scope**:
entries here document *what* the bench sees, not *how* to fix it.
Skill-side fixes are product work and live outside this package;
harness-side entries say what the harness does about the defect in the
meantime.

Add a new entry when a fixture produces a reliable non-success signal
that is NOT a fixture-authoring bug. When a skill-side change resolves
a defect, move the entry to the "Resolved" section and note the commit
/ change that closed it.

## Entry template

- **ID** — stable short slug, used in commit messages and baseline notes.
- **Fixture** — canonical fixture that reproduces the defect.
- **First observed** — ISO date.
- **Status** — `open` / `under investigation` / `won't-fix` / `resolved`.
- **Impact** — one line, what the user sees.
- **Repro rate** — N, pass@k, Wilson 95% CI, temperature, model.
- **Hypothesis** — best current explanation.
- **Caveat** — what the hypothesis does not cover.
- **Harness action** — what, if anything, the harness does (fixture tag,
  baseline floor, fixture comment).

---

## 1. Notion DCR jwks_info drop

- **ID** — `notion-jwks-drop`
- **Fixture** — `fixtures/notion-remote-oauth-dcr.yaml`
- **First observed** — 2026-04-22 (Phase 1 N=10 bench).
- **Status** — `open`.
- **Impact** — Skill emits a `mcp_servers[]` block with a DCR `issuer`
  but drops every `gateway.authentication.jwks_info.*` key from the
  top-level gateway config, even though the prompt supplies the Auth0
  tenant and audience. The resulting config would fail to validate
  inbound client tokens.
- **Repro rate** — Pooled across 30 runs (plan's pre-fix batch +
  post-Phase-1 v1 + post-Phase-1 v2, no constraint change between
  them), claude-cli at temperature 0, claude-sonnet-4-6: ~8/30 pass.
  Wilson 95% CI well below the 80% gate.
- **Hypothesis** — The skill conflates the gateway-IdP
  `jwks_info` (which validates inbound client tokens to the gateway)
  with the server-IdP DCR block (which configures outbound Notion
  OAuth) when `mcp_servers[].authentication` uses a DCR `issuer`.
  The two are independent and both are required in this fixture's
  shape.
- **Caveat** — `linear-remote-dcr-streamable-http` uses the same DCR
  shape (issuer set, no static client triple) and passes 10/10. So
  the raw conflation hypothesis is incomplete. A Notion-specific
  trigger (prompt mentions "OAuth only — bearer tokens are not
  accepted", longer no-bearer reasoning, or something else) has not
  been isolated.
- **Harness action** — `notion-remote-oauth-dcr` carries a
  `# Known skill defect (2026-04-23):` comment block in the fixture
  YAML. Baseline entry is `min_pass_at_k: 0.2` with a note flagging
  that the floor tracks further drift, not the happy path. No tag
  exclusion — we want a regression signal if the rate falls further.

## 2. Bare `PLACEHOLDER` emission (no descriptive suffix)

- **ID** — `client-secret-not-placeholder`
- **Fixture** — `fixtures/entra-oauth-client-credentials.yaml`,
  `fixtures/cognito-oauth-client-credentials.yaml`.
- **First observed** — 2026-04-23 (Phase 1 post-fix N=10 bench, v1).
- **Status** — `under investigation`.
- **Impact** — Under raw prompts where the user refers to a secret
  with vague "from the platform" phrasing, the skill occasionally
  emits the literal string `PLACEHOLDER` (or `"PLACEHOLDER"`) with
  no descriptive suffix. The harness's `secrets_are_placeholders`
  regex is strict by design — it accepts `PLACEHOLDER_<SUFFIX>`,
  `REPLACE_…`, `CHANGE_ME`, `YOUR_…`, and `${…}` forms, but NOT bare
  `PLACEHOLDER`. Intent is to force placeholders that self-describe
  which field they represent (better UX, no guessing what to fill in).
  Post-coaching the skill emits `REPLACE_WITH_CLIENT_SECRET`,
  `PLACEHOLDER_FILL_FROM_ENV`, `CHANGE_ME`, `${OAUTH_CLIENT_SECRET}`
  — all accepted.
- **Repro rate** — entra: 1/10 at N=10 (v1), 0/10 (v2 post-coaching).
  cognito: 2/10 at N=10 (v1), 0/10 (v2 post-coaching). Post-coaching
  both fixtures hit 10/10, so the mildest prompt coaching closes the
  gap; the residual skill behavior under raw prompts is the defect.
- **Hypothesis** — When the prompt names a secret with vague
  "from the platform" phrasing, the skill reaches for the shortest
  plausible placeholder (`PLACEHOLDER`) rather than the descriptive
  form. An explicit "we'll fill from env later" hint nudges it to
  the `REPLACE_WITH_<FIELD>` / `${ENV_VAR}` shapes. The SKILL.md
  OAuth example uses `your-client-secret` which matches the regex
  but isn't imitated consistently under vague prompts.
- **Caveat** — We didn't isolate whether the behavior is specific to
  `client_secret`, or whether other secret-typed fields (bearer
  `token`, `client_secret` on DCR flows, basic auth `password`) show
  the same tendency. A sweep would require a targeted fixture.
- **Harness action** — entra and cognito fixtures phrase the secret
  as "as a placeholder we'll fill from env later" (the mildest
  coaching consistent with aspirational-fixture raw-prompt policy).
  No tag exclusion. A refresh-interval 1/10 flake post-fix suggests
  the same defect manifests for bearer tokens too; not enough data
  yet to call it out separately.

## 3. URL-hostname-triggered `allow_private_networks: true`

- **ID** — `ssrf-opens-on-internal-hostname`
- **Fixture** — (all fixtures whose upstream URL carries a
  private-network-coded hostname).
- **First observed** — 2026-04-23 (Phase 1 triage, v1 bench).
- **Status** — `won't-fix` — the skill's behavior is semantically
  correct. This is documented as a fixture-authoring constraint,
  not a skill defect.
- **Impact** — When the upstream MCP server URL uses a hostname in
  the `.internal.` / `.corp.` / `.local` family, the skill flips
  `gateway.ssrf.allow_private_networks` to `true` and the fixture
  trips the `safe_defaults_preserved` rubric.
- **Repro rate** — At N=10 on `mcp-server-refresh-interval`
  (pre-hostname-swap): 9/10 failed this check. Post-hostname-swap to
  `mcp.services.acme.com`: 9/10 pass (residual 1/10 is the
  client-secret defect above, not this one). Rate is ~1.0 when the
  hostname pattern matches.
- **Hypothesis** — The skill infers from the hostname that the
  server is on private-network infrastructure that SSRF's default
  deny would block, and pre-emptively opens the allowlist. This is
  the correct inference given `SKILL.md`'s guidance on
  SSRF-weakening; the fixtures were the problem for asking about
  private-looking hosts without declaring the SSRF weakening.
- **Caveat** — The exact hostname patterns the skill keys on are
  not fully enumerated. `.internal.` and `.corp.` are confirmed;
  `.local`, bare-name hosts, and RFC 1918 literal IPs are
  unconfirmed. If a future fixture needs to exercise
  private-network topology on purpose, use an explicit prompt
  (`"allow private networks"` with a `safe_default_opt_out` entry)
  — do not rely on hostname inference.
- **Harness action** — `fixtures/README.md` documents the
  fixture-authoring constraint (use public-shaped hostnames like
  `mcp.services.acme.com` unless SSRF opening is the axis under
  test). `ssrf-allow-private-networks` and `ssrf-allow-localhost`
  are the fixtures that *do* exercise SSRF opening on purpose;
  they declare `safe_default_opt_out` explicitly.

---

## Resolved

### 4. Vendored validator bundle lags the vendored schema artifact

- **ID** — `validator-bundle-drift`
- **Fixture** — none; this was a harness defect, not a skill defect.
- **First observed** — 2026-08-18 (schema-reference re-vendor).
- **Status** — `resolved` (2026-08-20, #29: bundle and artifact re-vendored together from the same product-repo revision; validator bundle 2.0.0, schema artifact generatorVersion 1.1.0).
- **Impact** — `skill-harness/vendor/config-validator.bundle.mjs` and `dtwo/skills/dtwo-gateway-config/schema-reference.json` are generated from the same schema in the product repo but are vendored independently. Only the artifact was refreshed in the 2026-08-18 change, so the two disagreed, and the rubric reads both: `must_validate` / `no_dropped_keys` use the bundle, `no_hallucinated_keys` uses the artifact. Confirmed divergences at the time:
  - `gateway.session_control.*` and `gateway.intent.*` are documented, user-facing fields in the artifact but were strict-rejected by the bundle as unrecognized keys. A config that correctly used them passed the hallucination check and failed validation — the rubric scored a correct answer as a failure.
  - `jwt_issuer_verification: false` and `jwt_audience_verification: false` are rejected by the artifact's cross-field constraint but were accepted by the bundle. The `safe_defaults_preserved` seed was the only check that caught this.
  - `HTTP_SERVER` is no longer a reserved key in the artifact but was still rejected inside `gateway.advanced` by the bundle.
  - `JWT_REQUIRED_ORG_ID`, `SESSION_CONTROL_CLIENT_ID` and `SESSION_CONTROL_ISSUER` are newly reserved in the artifact but were accepted inside `gateway.advanced` by the bundle.
- **Repro rate** — n/a (deterministic; not a sampled bench signal).
- **Hypothesis** — Not a hypothesis but a known cause: the two vendored files have no shared version or provenance record, and `VALIDATOR_BUNDLE_VERSION` is a hand-maintained shape constant that did not move across the bundle's content drift, so it cannot signal staleness. The bundle had not been refreshed since it was first vendored.
- **Caveat** — The divergence list above is what a targeted probe surfaced, not an exhaustive diff. The resolution sidesteps the caveat by re-vendoring both files from the same source revision rather than patching the listed items.
- **Harness action** — Resolved by the #29 refresh: both vendored files now come from the same product-repo revision, `EXPECTED_VALIDATOR_BUNDLE_SHA256` pins the refreshed bundle's bytes, and a targeted re-probe confirmed every divergence listed above is closed (`session_control`/`intent` validate, `*_verification: false` is rejected, `HTTP_SERVER` is accepted in `gateway.advanced`, the three newly reserved keys are rejected there). The interim fixture freeze is lifted: fixtures MAY now exercise `gateway.session_control` and `gateway.intent`, and a `must_validate` pass on the token-validation flags is evidence again. The structural gap — no shared provenance record between the two vendored files — remains; the sha256 pin plus the digest's embedded artifact sha are what stand in for one.
