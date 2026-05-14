# Skill-harness fixtures

Flat layout: one YAML file per fixture (Phase-1 binding decision #1 — no
`v1/` subdirectory yet).

## Fixture format

```yaml
id: atlassian-auth0-oauth
tier: required                       # required | aspirational
tags: [auth0, oauth, atlassian]
user_prompt: |
  <natural-language prompt the skill sees>
followups:                           # optional; canned answers for clarifying questions
  - match: /audience/i
    reply: "https://api.acme.com"
expect:
  must_validate: true                # delegate parseConfig incl. reserved-advanced blocklist
  required_paths:
    - mcp_servers[0].authentication.type
  forbidden_paths:
    - mcp_servers[0].authentication.client_id
  value_constraints:
    - { path: mcp_servers[0].authentication.type, equals: oauth }
    - { path: mcp_servers[0].authentication.scopes, min_length: 1 }
    - { path: mcp_servers[0].name, regex: "(?i)atlassian" }
  semantic_rubric:                   # optional; v1.1 LLM-judge only — not evaluated here
    - "Uses DCR path (issuer set, no client_id/client_secret)"
  safe_default_opt_out:              # optional; explicit bypass of the safe-default check
    - gateway.ssrf.allow_localhost
clarifying_question_expected: false
```

Rubrics encode only prompt-specific expectations. Metadata-driven checks
apply globally and are NOT declared per fixture:

- `no_hallucinated_keys` — every YAML path must resolve to a field in
  `schema-reference.json` (with record-leaf children accepted when they
  match the leaf's declared key pattern).
- `no_dropped_keys` — `paths(input) \ paths(parsed)` must be empty.
- `safe_defaults_preserved` — five-field seed list (see
  `src/safeDefaults.ts`, `SAFE_DEFAULT_SEEDS`). Fixtures that legitimately
  ask for a weakening (e.g. allow localhost for local dev) declare the
  path in `expect.safe_default_opt_out`; the rubric skips that path.
- `secrets_are_placeholders` — every `secret: true` leaf is absent or
  holds a placeholder matching `/^<?(?:REPLACE_|PLACEHOLDER_|CHANGE_?ME|YOUR[_-])|^\$\{/i`
  (brackets optional; `REPLACE_`, `PLACEHOLDER_`, `CHANGE_ME`, `YOUR_…` /
  `your-…`, and `${…}` are all accepted conventional shapes).
- Reserved-advanced enforcement — delegated to `parseConfig` via
  `must_validate: true`; the runtime `.superRefine` in `config.ts`
  rejects reserved keys and newline injection.

## Fixture paths

Use concrete array indices (e.g. `mcp_servers[0].authentication.type`).
The harness normalizes `[0]` → `[]` internally when comparing against
the allowed-path set, and uses the concrete form for value lookup.

## Phase 2 battery (28 fixtures: 12 required + 16 aspirational)

The plan's full 40-prompt target is **intentionally deferred** until
Tier-2 runs reveal where the skill struggles — we steer remaining
fixture authoring toward observed failure modes rather than guessing
up-front. See the plan's Phase 2 implementation decisions note for the
revisit trigger.

### Required (12) — CI-blocking at 100% per-prompt

| Axis          | ID                                      | Exercises                                                                 |
|---------------|-----------------------------------------|---------------------------------------------------------------------------|
| Auth matrix   | `atlassian-auth0-oauth`                 | OAuth DCR + PKCE (Atlassian)                                              |
| Auth matrix   | `slack-auth0-oauth`                     | OAuth + Slack quirks (scope_separator, token_response_path, extra params) |
| Auth matrix   | `github-oauth-client-credentials`       | OAuth client_credentials (M2M, static triple, no PKCE/redirect)           |
| Auth matrix   | `bearer-token-simple`                   | Bearer token with secret placeholder                                      |
| Auth matrix   | `basic-auth-simple`                     | HTTP basic auth (username + password placeholder)                         |
| Auth matrix   | `query-param-auth`                      | `?api_key=` query-parameter auth                                          |
| Auth matrix   | `auth-headers-x-api-key`                | Custom `X-Api-Key` header; exercises issue #754 secret patch              |
| Auth matrix   | `cert-mtls`                             | Client-cert / mTLS with PEM placeholder                                   |
| Compound      | `multi-server-auth0`                    | Three `mcp_servers[]` (Atlassian + Slack + internal bearer)               |
| Compound      | `ssrf-allow-localhost`                  | Explicit SSRF weakening for local dev (exercises `safe_default_opt_out`)  |
| Compound      | `advanced-custom-env-var`               | Custom env var via `gateway.advanced` (not a reserved key)                |
| Compound      | `log-level-debug`                       | Typed `gateway.log_level: TRACE` (no `advanced` fallback)                 |

### Aspirational (16) — tracked, non-blocking

| Axis           | ID                                      | Exercises                                                                 |
|----------------|-----------------------------------------|---------------------------------------------------------------------------|
| Ambiguous      | `ambiguous-missing-audience`            | Prompt lacks `audience`; skill must ask                                   |
| Ambiguous      | `ambiguous-missing-issuer`              | Prompt names Atlassian but no IdP details; skill must ask                 |
| Contradictory  | `contradictory-dcr-with-secret`         | User supplies both `issuer` (DCR) and `client_secret`                     |
| Contradictory  | `contradictory-grant-with-redirect`     | User asks `client_credentials` AND supplies a `redirect_uri`              |
| Adversarial    | `adversarial-reserved-in-advanced`      | User asks to put reserved `JWT_ISSUER` into `gateway.advanced`            |
| Adversarial    | `adversarial-disable-auth`              | User asks to turn off authentication entirely                             |
| IdP variety    | `okta-oauth-dcr`                        | Okta custom AS issuer `/oauth2/{asId}`, JWKS on `/v1/keys`, DCR + PKCE    |
| IdP variety    | `entra-oauth-client-credentials`        | Entra v2.0 `/v2.0` issuer suffix, `api://{guid}` audience, **no-DCR** path |
| IdP variety    | `keycloak-oauth-dcr`                    | Realm-based `/realms/{r}` issuer (no `/auth/` prefix on KC 17+), DCR + PKCE |
| IdP variety    | `cognito-oauth-client-credentials`      | **Access token has no `aud` — validate `client_id`**; distinct issuer vs hosted-UI hosts |
| MCP registry   | `linear-remote-dcr-streamable-http`     | Linear MCP `url` + `transport_type` pinning; DCR against Linear's own IdP |
| MCP registry   | `notion-remote-oauth-dcr`               | Notion MCP OAuth-only + DCR via workers-oauth-provider; bearer explicitly rejected |
| MCP registry   | `github-copilot-mcp-authheaders`        | `authheaders` variant on `api.githubcopilot.com/mcp/`; flags schema gap for non-secret headers |
| SSRF           | `ssrf-allow-private-networks`           | `allow_private_networks: true` (co-located EC2); exercises `safe_default_opt_out` on this seed path |
| SSRF           | `ssrf-allowed-networks-cidrs`           | Surgical CIDR allowlist (`array<string>`); forbids the blanket-private flip |
| Typed scalar   | `mcp-server-refresh-interval`           | `mcp_servers[].refresh_interval_seconds` typed integer (ms-vs-s gotcha)   |

Required is CI-blocking at 100% per-prompt (not average). Aspirational is
tracked and reports into the Tier-2 summary but does not gate merges;
graduates to required after 3 consecutive green runs on two model versions.

### Coached vs raw prompts — policy

**Required fixtures are heavily coached**: explicit MCP server name and
URL, `<REPLACE_WITH_…>` placeholder spellings, "emit YAML inline / don't
call tools" instructions, and broad `followups` regex safety nets. This
style was adopted after a live Tier-2 run showed underspecified prompts
took the skill down clarifying-question rabbit holes; coaching raised
required-tier green rate from 2/12 to 12/12.

**Aspirational fixtures stay deliberately raw** — single-paragraph user
asks, one `/audience/i` followup. Raw aspirational prompts are how the
harness *surfaces* where the skill disambiguates poorly; coaching them
defeats their purpose. Do **not** copy required-tier phrasing into a new
aspirational fixture. A raw aspirational with a stable green streak is a
promotion candidate; a raw aspirational that reliably fails is either a
skill defect to fix or a scenario that genuinely needs coaching to
graduate — the distinction is what we want to learn.

## Seed fixtures (Phase 1 origin)

| File | Tier | Exercises |
|---|---|---|
| `atlassian-auth0-oauth.yaml` | required | OAuth variant + DCR (`issuer` set, no `client_id` / `client_secret`) + PKCE |
| `bearer-token-simple.yaml`   | required | Bearer variant, secret placeholder on `token` |

## Source provenance (optional)

Fixtures that ground non-obvious regex or value constraints in external docs
may include a `# Sources (verified YYYY-MM-DD):` comment block at the top of
the YAML file. Convention:

- **IdP-shape fixtures** (Okta, Entra, Keycloak, Cognito, …) should include
  sources — the URL shapes they assert are load-bearing claims about the
  vendor's OIDC behaviour.
- **MCP-registry fixtures** (Linear, Notion, …) should include sources —
  vendor endpoints and auth stories change frequently; the
  `verified YYYY-MM-DD` line is how a future author decides whether to
  re-check.

The sources block is YAML-comment-only; the Zod schema strips it at parse
time. No tooling enforces it yet; treat it as a best-effort annotation.

## Schema-gap fixtures

Fixtures that exist primarily to flag a limitation in the config schema —
not to test a happy path — carry the tag `schema_gap_flagged`. They
deliberately carry workarounds in their `semantic_rubric` and serve as
forcing functions for the schema change that removes the workaround.

Schema-gap fixtures are **reported but not gating**: their pass-rate is
surfaced in the bench summary, but they are excluded from the aggregate
pass-rate headline and from baseline regression checks. The fixture
only graduates to a gating signal once the underlying schema gap is
closed and the `schema_gap_flagged` tag is removed.

- `github-copilot-mcp-authheaders` — non-secret behavioural headers
  (`X-MCP-Readonly`, `X-MCP-Toolsets`) have to masquerade as `${ENV_VAR}`
  placeholders because the `authheaders` variant marks every
  `headers[].value` as `secret: true`. Unblocking this requires a
  non-secret `extra_headers[]` field on `mcp_servers[]`.

## SSRF tier rationale

`ssrf-allow-localhost` is `required` because it is the canonical
safe-default-opt-out exemplar — the mechanism must work end-to-end.
The sibling fixtures `ssrf-allow-private-networks` and
`ssrf-allowed-networks-cidrs` exercise the same mechanism on different
seed paths and are `aspirational`; they promote to `required` only after
the mechanism has proven stable at CI scale across model versions.
