/**
 * Safe-default seed list + helpers.
 *
 * The seed list has two halves. `SAFE_DEFAULT_SEEDS` names fields whose
 * `schemaDefault` or `deployDefault` encodes a safe posture, and
 * `buildSafeDefaults` pulls the native safe value straight out of the
 * artifact. `GATEWAY_OWNED_SAFE_DEFAULTS` names fields where the gateway
 * applies the safe value at boot and the artifact therefore declares none —
 * those carry an explicit `expected`, guarded so an entry cannot shadow a
 * default the artifact later starts declaring. `findWeakenedDefaults` flags
 * any YAML that emits a different value without explicit opt-out.
 *
 * `schemaDefault` in the artifact is already native (e.g. `true`); the
 * generator emits it unquoted. `deployDefault` is often stringified
 * (e.g. `"true"`, `"[]"`) because the state-machine env-file renderer
 * wants strings — so the coercion helper below tries `JSON.parse` and
 * falls back to the raw string.
 */

import { getAtPath } from './internal/pathAccess.js';
import type { FieldRecord, SchemaArtifact } from './schemaArtifact.js';

/**
 * Seed list of safe-default paths the rubric guards. Each must resolve
 * cleanly against the artifact; a `buildSafeDefaults` failure is a loud
 * signal that the upstream schema moved.
 *
 * OAuth `pkce_enabled` is deliberately NOT in this list — it has no
 * schema default and stays a fixture-level assertion.
 */
export const SAFE_DEFAULT_SEEDS: readonly string[] = [
  'gateway.authentication.enabled',
  'gateway.ssrf.dns_fail_closed',
  'gateway.ssrf.allow_localhost',
  'gateway.ssrf.allow_private_networks',
  'gateway.ssrf.allowed_networks',
];

export type GatewayOwnedSafeDefault = { path: string; expected: unknown };

/**
 * Seeds whose safe value is owned by the gateway runtime, not the schema
 * artifact: both `schemaDefault` and `deployDefault` are null because the
 * gateway applies the default at boot, so `buildSafeDefaults` cannot derive
 * them.
 *
 * All three `expected: true` values are corroborated by the artifact's own
 * `rationale` strings on the corresponding fields. Re-verify them against
 * the rationale text on every re-vendor — see the schema-digest section of
 * README.md.
 *
 * `require_jti` is deliberately absent: the artifact's rationale instructs
 * setting it `false` for IdPs that do not mint a `jti` on access tokens, so
 * guarding it would penalise correct configs.
 *
 * `mcp_oauth_resource_metadata_enabled` is deliberately absent: the artifact
 * contradicts itself about its default — the `description` says the deploy
 * defaults it to `true` when `sso_issuer` is set, the `rationale` says the
 * gateway defaults it to `false`. It is not gradeable until upstream
 * reconciles the two.
 */
export const GATEWAY_OWNED_SAFE_DEFAULTS: readonly GatewayOwnedSafeDefault[] = [
  { path: 'gateway.authentication.jwt_issuer_verification', expected: true },
  { path: 'gateway.authentication.jwt_audience_verification', expected: true },
  { path: 'gateway.authentication.require_token_expiration', expected: true },
];

/**
 * Coerce a `deployDefault` to its native form. The generator already
 * emits `schemaDefault` native, so this only needs to handle the string
 * case. We try JSON first so `"true"` → `true`, `"[]"` → `[]`; if that
 * fails we return the original string so free-form values like
 * `/opt/dtwo/...` survive intact.
 */
function coerceDeployDefault(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  if (raw === '') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

type ResolvedField = { section: string; field: FieldRecord };

function resolveFieldAtPath(artifact: SchemaArtifact, path: string): ResolvedField | null {
  // Walk by matching the longest section prefix — sections are keyed by
  // their dotted path (possibly empty for the root section).
  let best: ResolvedField | null = null;
  let bestLen = -1;
  for (const section of artifact.sections) {
    // Skip variant sections; safe-default seeds are all on plain sections.
    if (section.path.includes(' (')) continue;
    const prefix = section.path === '' ? '' : `${section.path}.`;
    if (section.path !== '' && !path.startsWith(prefix)) continue;
    const remainder = path.slice(prefix.length);
    // Only accept a single-segment remainder (leaf field) — nested
    // resolution is handled by matching a longer section prefix.
    if (remainder === '' || remainder.includes('.')) continue;
    const f = section.fields.find(ff => ff.name === remainder);
    if (!f) continue;
    if (section.path.length > bestLen) {
      best = { section: section.path, field: f };
      bestLen = section.path.length;
    }
  }
  return best;
}

/**
 * Resolve every seed against the artifact, returning a map from seed path
 * to its safe value. Throws if any seed cannot be resolved — the runtime
 * drift-check that keeps this list honest.
 *
 * Three failure buckets, all loud:
 *
 *  - **unresolved** — the seed path names no field. The upstream schema moved.
 *  - **unvalued** — a `SAFE_DEFAULT_SEEDS` entry resolves but declares neither
 *    a `schemaDefault` nor a `deployDefault`. Before this threw, the map got
 *    `expected: null`, which then flagged *both* `true` and `false` as a
 *    weakening — a silently useless check.
 *  - **shadowed** — a `GATEWAY_OWNED_SAFE_DEFAULTS` entry resolves to a field
 *    that has since started declaring a default. The entry's whole premise is
 *    that the artifact declares none, so a hand-written value must not quietly
 *    take precedence over one the artifact now ships.
 */
export function buildSafeDefaults(artifact: SchemaArtifact): Map<string, unknown> {
  const out = new Map<string, unknown>();
  const unresolved: string[] = [];
  const unvalued: string[] = [];
  const shadowed: string[] = [];

  for (const seed of SAFE_DEFAULT_SEEDS) {
    const resolved = resolveFieldAtPath(artifact, seed);
    if (!resolved) {
      unresolved.push(seed);
      continue;
    }
    const { field } = resolved;
    // `schemaDefault` wins when present — it's already native. Otherwise
    // coerce the (possibly stringified) `deployDefault`.
    const value = field.schemaDefault !== null ? field.schemaDefault : coerceDeployDefault(field.deployDefault);
    if (value === null || value === undefined) {
      unvalued.push(seed);
      continue;
    }
    out.set(seed, value);
  }

  for (const { path, expected } of GATEWAY_OWNED_SAFE_DEFAULTS) {
    const resolved = resolveFieldAtPath(artifact, path);
    if (!resolved) {
      unresolved.push(path);
      continue;
    }
    const { field } = resolved;
    if (
      (field.schemaDefault !== null && field.schemaDefault !== undefined) ||
      (field.deployDefault !== null && field.deployDefault !== undefined)
    ) {
      shadowed.push(
        `${path} (artifact now declares schemaDefault=${JSON.stringify(field.schemaDefault)}, ` +
          `deployDefault=${JSON.stringify(field.deployDefault)})`,
      );
      continue;
    }
    out.set(path, expected);
  }

  if (unresolved.length > 0) {
    throw new Error(
      `Safe-default seed paths cannot be resolved against the schema artifact: ${unresolved.join(', ')}. ` +
        'The upstream schema likely moved — re-audit the seed lists against schema-reference.json.',
    );
  }
  if (unvalued.length > 0) {
    throw new Error(
      `SAFE_DEFAULT_SEEDS resolve to a field with no schemaDefault and no deployDefault: ${unvalued.join(', ')}. ` +
        'A null safe value grades every explicit value as weakened — move the seed to ' +
        'GATEWAY_OWNED_SAFE_DEFAULTS with an explicit expected value, or drop it.',
    );
  }
  if (shadowed.length > 0) {
    throw new Error(
      `GATEWAY_OWNED_SAFE_DEFAULTS entries would shadow a default the artifact now declares: ${shadowed.join('; ')}. ` +
        'Drop the entry and let buildSafeDefaults derive the value from the artifact.',
    );
  }
  return out;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!valuesEqual(a[i], b[i])) return false;
    return true;
  }
  return false;
}

export type WeakenedDefault = { path: string; expected: unknown; actual: unknown };

/**
 * For each (seed, safeValue), if `parsed` has the path set and the value
 * differs from the safe value and the path is not in `optOut`, flag it.
 * Absent values are acceptable (the platform applies its safe default).
 */
export function findWeakenedDefaults(
  parsed: unknown,
  defaults: Map<string, unknown>,
  optOut?: Set<string>,
): WeakenedDefault[] {
  const out: WeakenedDefault[] = [];
  for (const [path, expected] of defaults) {
    if (optOut?.has(path)) continue;
    const actual = getAtPath(parsed, path);
    if (actual === undefined) continue;
    if (!valuesEqual(actual, expected)) out.push({ path, expected, actual });
  }
  return out;
}
