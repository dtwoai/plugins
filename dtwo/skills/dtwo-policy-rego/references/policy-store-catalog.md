<!-- © 2026 Dtwo, Inc. -->

# Policy Store Catalog Contributions (reference)

> Reference file for the `dtwo-policy-rego` skill. Read this only when contributing reusable
> policies to the **`dtwoai/policy-store`** repo. Not needed for authoring tenant-local gateway
> policies. Rego correctness rules still come from the main skill (SKILL.md).

Use this section when the target is the `dtwoai/policy-store` repository rather than a tenant-local gateway policy. The policy-store catalog is a curated source of reusable policies; this skill still owns Rego correctness, while the repository owns file layout, metadata, tests, and manifest generation.

### Repository layout

```text
apps/
  <app>/
    README.md
    <policy-slug>/
      policy.md
      tests.yaml

industries/
  <industry>/
    README.md

bundles/
  <bundle>/
    README.md

manifest.json
schema.json
```

- Put canonical policy bodies only under `apps/<app>/<policy-slug>/`.
- Never duplicate policy bodies under `industries/` or `bundles/`; those directories contain landing pages that link to canonical app policies.
- Use `<app>` as the lowercase, hyphenated MCP server or SaaS app slug commonly configured on a gateway, such as `slack`, `jira`, `github`, or `postgres`.
- Use `<policy-slug>` as the lowercase, hyphenated purpose, such as `block-secrets`, `readonly`, or `pii-redaction`.
- Do not add per-policy `README.md` or `metadata.json` files. Human documentation and all metadata live in `policy.md` frontmatter.
- Treat `manifest.json` as generated from policy frontmatter. Do not hand-edit it except through the manifest generator.

### `policy.md`

Each policy directory requires a `policy.md` file with YAML frontmatter followed by one fenced `rego` block.

Frontmatter must include the required schema fields from `schema.json`:

- `name`
- `tags`
- `publishedAt`
- `description`
- `direction`
- `apps`
- `schemaVersion`

Include `industries`, `bundles`, and `minimumGatewayVersion` when they apply. Put the policy's human-facing documentation in `description`: what it does, when to use it, assumptions, limitations, examples, and relevant composition notes.

Catalog policies are stricter than tenant-local examples:

- Use PARC fields for action, resource, and identity: `input.action`, `input.resource`, `input.subject`, and `input.context`.
- Do not use deprecated legacy aliases in catalog policies: `input.kind`, `input.payload.name`, or `input.user`.
- Use `input.payload.args` and other hook-specific `input.payload` data for the actual request/response payload when needed.
- Compare tool names case-insensitively with `lower(input.resource.name)`.
- Use `object.get(obj, key, default)` for optional fields and missing claims.
- Use only IdP-supplied claims in `input.subject.claims`; do not authorize on stripped ContextForge-internal claims such as `is_admin`, `teams`, or nested `user`.

### `tests.yaml`

Each policy directory requires a `tests.yaml` file containing a top-level YAML array of test cases. Include at least one positive and one negative case. For deny policies, this usually means one allow case and one deny case; for transform-only policies, use a passthrough case and a transform-applied case.

Each test case uses this shape:

```yaml
- description: what this case demonstrates
  input:
    resource: { ... }
    action: tool_pre_invoke
    payload: { ... }
  output:
    expectedResult: deny
    expectedReason: exact reason when relevant
  transformApplied: true
  transform: { replacement: "[REDACTED]" }
  transformedArgsContain: { jql: "project != HR" }
```

- The runner feeds only each case's `input` object to OPA. Do not nest the PARC decision object under another `input` key inside the test case input.
- `output.expectedResult` is required and must be `allow` or `deny`.
- `output.expectedReason`, `transformApplied`, `transform`, and `transformedArgsContain` are optional and should be included only when they assert relevant behavior.
- For identity-aware policies, document required IdP claim names and missing-claim defaults in the `policy.md` description.

### Registering a policy

1. Create `apps/<app>/<policy-slug>/policy.md` and `tests.yaml`.
2. Add a row or link to `apps/<app>/README.md`.
3. If the policy belongs to an industry or bundle, list the slug in `policy.md` frontmatter and add a link from the matching `industries/<industry>/README.md` or `bundles/<bundle>/README.md`.
4. For new apps, industries, or bundles, create the corresponding directory and `README.md`.
5. Run `pnpm manifest`, commit the generated `manifest.json`, then run `pnpm manifest:check`.
6. Run `pnpm test`; it requires the OPA CLI on `PATH` or `OPA_BIN` set.

Do not invent new manifest fields. Match existing policy frontmatter and open an issue first if the schema lacks a needed field.
