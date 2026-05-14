/**
 * Path utilities for comparing fixture / YAML paths against the schema
 * artifact's section+field graph.
 *
 * The schema artifact uses `[]` for arrays in section paths (e.g.
 * `mcp_servers[].authentication`). Fixture and runtime YAML paths contain
 * concrete indices (e.g. `mcp_servers[0].authentication.type`). The allowed
 * set is built with `[]`; both sides are normalized before set ops.
 *
 * Discriminator resolution: sections titled `<path> (<variant>)` (e.g.
 * `mcp_servers[].authentication (oauth)`) contribute their fields under the
 * bare `<path>`. We compose using the *parent* section's `variants[].name`
 * list — never by string-matching the parenthetical in a title.
 *
 * Record leaves: fields whose `type` starts with `record<` are terminal
 * path markers. The leaf itself is allowed (e.g.
 * `mcp_servers[].authentication.extra_authorize_params`), but nothing
 * inside it is walked by `buildAllowedPathSet`. The YAML walker and the
 * rubric delegate per-child validation to `parseConfig` (for record key
 * pattern checks) or treat children as record-leaf-scoped.
 */

import type { SchemaArtifact, Section } from './schemaArtifact.js';

/**
 * The one record-leaf whose child keys are intentionally case-preserved
 * (schema-level `PRESERVE_CHILD_KEYS = new Set(['extra_authorize_params'])`).
 * Mirrored here so the YAML walker treats children as case-sensitive and
 * skips recursion. Keep in lockstep with `config.ts`.
 */
export const PRESERVE_CHILD_KEYS: ReadonlySet<string> = new Set(['extra_authorize_params']);

/**
 * Variant-section titles from the generator look like
 * `mcp_servers[].authentication (oauth)`. Split the parenthetical off to get
 * the bare path. Returns `null` if the path has no parenthetical suffix.
 */
export function splitVariantSuffix(path: string): { base: string; variant: string } | null {
  const match = /^(.*) \(([^)]+)\)$/.exec(path);
  if (!match) return null;
  return { base: match[1], variant: match[2] };
}

/**
 * Strip every ` (<variant>)` parenthetical from a section path, not just the
 * trailing one. A variant section nested under another variant section —
 * e.g. `mcp_servers[].authentication (authheaders).headers[]` — carries the
 * parenthetical in the middle. Both the allowed-path walker and the secret-
 * path walker need the bare base form so that a concrete YAML path like
 * `mcp_servers[0].authentication.headers[0].value` matches after index
 * normalization.
 */
export function stripVariantParentheticals(path: string): string {
  return path.replace(/ \([^)]+\)/g, '');
}

/** Set of section paths (without variant parentheticals) that carry variants. */
function collectVariantBases(sections: Section[]): Set<string> {
  const bases = new Set<string>();
  for (const s of sections) {
    if (s.variants && s.variants.length > 0) bases.add(s.path);
  }
  return bases;
}

/**
 * Walk the artifact's sections and return every allowed YAML path, composed
 * with `[]` for arrays. Record leaves are included (their children are
 * intentionally not walked here).
 *
 * For a plain section at `<path>` each field contributes `<path>.<field.name>`
 * (or just `<field.name>` when `<path>` is empty).
 *
 * For a variant section titled `<base> (<variant>)`, fields contribute under
 * the bare `<base>` — every variant resolves its `type` literal to the same
 * allowed `<base>.type` path.
 *
 * The parent section of a discriminated union (the one carrying `variants[]`
 * with an empty `fields: []`) itself contributes no field-level paths. Its
 * own path is already present because some other section adds it as a field.
 */
export function buildAllowedPathSet(artifact: SchemaArtifact): Set<string> {
  const allowed = new Set<string>();
  const variantBases = collectVariantBases(artifact.sections);

  for (const section of artifact.sections) {
    // Skip the parent "union" section — it owns `variants[]` but no fields of
    // its own. Its path shows up naturally as a field on its parent.
    if (section.variants && section.variants.length > 0 && section.fields.length === 0) {
      continue;
    }

    const variantSplit = splitVariantSuffix(section.path);
    // For a variant section, compose under the bare base path. For plain
    // sections, compose under the section path as-is. Additionally strip any
    // mid-path `(variant)` parenthetical — sections like
    // `mcp_servers[].authentication (authheaders).headers[]` nest a variant
    // inside another section's path, and the bare YAML form has no
    // parenthetical anywhere.
    const basePath = stripVariantParentheticals(variantSplit ? variantSplit.base : section.path);

    for (const field of section.fields) {
      const composed = basePath === '' ? field.name : `${basePath}.${field.name}`;
      allowed.add(composed);
      // For scalar-element arrays (e.g. `array<string>`), also emit the
      // element-position path `<composed>[]`. Fixtures occasionally pin an
      // individual element via indexed access (e.g. `gateway.advanced[0]`
      // regex), and `getAtPath` resolves that form already — the allowed
      // set must not reject it after normalization. `array<object>` fields
      // are excluded: their elements compose their own sections and are
      // walked separately.
      if (field.type.startsWith('array<') && field.type !== 'array<object>') {
        allowed.add(`${composed}[]`);
      }
    }

    // Sanity: make sure a variant's base path lines up with a declared
    // `variants[].path`. Silent if it does not — the walker's correctness
    // doesn't depend on the check, but tests in `paths.test.ts` will assert
    // that discriminator fields resolve.
    if (variantSplit && !variantBases.has(variantSplit.base)) {
      // No-op on purpose: the artifact shouldn't be able to produce this
      // shape, but if it ever does we don't want to crash in production
      // code — tests are the guardrail here.
    }
  }

  return allowed;
}

/** Replace every `[<digits>]` segment with `[]` for path-set comparisons. */
export function normalizeYamlPath(path: string): string {
  return path.replace(/\[\d+\]/g, '[]');
}
