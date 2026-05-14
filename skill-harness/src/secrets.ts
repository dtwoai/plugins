/**
 * Secret placeholder enforcement.
 *
 * Every field carrying `secret: true` in the artifact must either be
 * absent from the output or hold a placeholder string matching the
 * `SECRET_PLACEHOLDER_REGEX` below. The regex is harness-side; the
 * `secret` flag itself is derived from the artifact.
 *
 * Accepted shapes (case-insensitive, anchored at start of value):
 *   - `REPLACE_…`         — optionally `<REPLACE_…>`
 *   - `PLACEHOLDER_…`     — optionally `<PLACEHOLDER_…>`
 *   - `CHANGE_ME` / `CHANGEME` — optionally `<CHANGE_ME>`
 *   - `YOUR_…` / `YOUR-…` — optionally `<YOUR_…>` / `<your-…>`
 *                           (covers `YOUR_BEARER_TOKEN`, `your-instance`,
 *                           `<your-bearer-token>`, etc.)
 *   - `${…}` shell-style substitution markers
 *
 * The bracket and bare-form tolerance was added after Tier-2 bench runs
 * showed the skill naturally emits all of these shapes interchangeably
 * (`REPLACE_WITH_YOUR_BEARER_TOKEN`, `<YOUR_CLIENT_SECRET>`,
 * `your-bearer-token`). They're all conventional placeholder syntax; the
 * goal is to reject literal-looking credentials, not to enforce a single
 * spelling. The `^` anchor on every alternative means a literal like
 * `Bearer YOUR_TOKEN` still rejects (scheme must not be embedded).
 */

import { PRESERVE_CHILD_KEYS, splitVariantSuffix, stripVariantParentheticals } from './paths.js';
import type { SchemaArtifact } from './schemaArtifact.js';

export const SECRET_PLACEHOLDER_REGEX = /^<?(?:REPLACE_|PLACEHOLDER_|CHANGE_?ME|YOUR[_-])|^\$\{/i;

/**
 * Compose every secret-flagged leaf path under its allowed (variant-
 * unwrapped, `[]`-normalized) form. Mirrors `buildAllowedPathSet`'s
 * composition rules so lookups go through the same namespace.
 */
export function collectSecretPaths(artifact: SchemaArtifact): Set<string> {
  const out = new Set<string>();
  for (const section of artifact.sections) {
    if (section.variants && section.variants.length > 0 && section.fields.length === 0) continue;
    const split = splitVariantSuffix(section.path);
    // Strip any mid-path `(variant)` parenthetical too — mirrors
    // `buildAllowedPathSet`, so a nested variant section like
    // `mcp_servers[].authentication (authheaders).headers[]` composes its
    // `secret: true` leaves at `mcp_servers[].authentication.headers[].value`.
    const basePath = stripVariantParentheticals(split ? split.base : section.path);
    for (const field of section.fields) {
      if (field.secret !== true) continue;
      const composed = basePath === '' ? field.name : `${basePath}.${field.name}`;
      out.add(composed);
    }
  }
  return out;
}

export type SecretViolation = { path: string; value: string };

type Frame = { obj: Record<string, unknown>; path: string; insidePreserve: boolean };

function joinKey(prefix: string, segment: string): string {
  return prefix === '' ? segment : `${prefix}.${segment}`;
}

/**
 * Walk `parsed` and emit (normalized-path, value) pairs for every
 * string-valued leaf whose normalized path is in `secretPaths`. Return
 * any that don't match the placeholder regex. Non-string values (null,
 * missing, objects) are ignored — absent = OK.
 *
 * Record-leaf boundary: keys under `PRESERVE_CHILD_KEYS` (e.g.
 * `extra_authorize_params`) are opaque external identifiers whose values
 * are case-preserved strings. Mirrors the boundary logic in
 * `walkYamlPaths` / `roundTripDiff` so a future `secret: true` leaf
 * can't accidentally match against case-preserved record keys.
 */
export function findSecretViolations(parsed: unknown, secretPaths: Set<string>): SecretViolation[] {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const violations: SecretViolation[] = [];
  const stack: Frame[] = [{ obj: parsed as Record<string, unknown>, path: '', insidePreserve: false }];
  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) break;
    // Inside a PRESERVE_CHILD_KEYS subtree, children are case-preserved
    // external identifiers whose values are record leaves — stop here.
    if (frame.insidePreserve) continue;
    for (const rawKey of Object.keys(frame.obj)) {
      const key = rawKey.toLowerCase();
      const childPath = joinKey(frame.path, key);
      const value = frame.obj[rawKey];
      if (Array.isArray(value)) {
        for (const elem of value) {
          if (elem !== null && typeof elem === 'object' && !Array.isArray(elem)) {
            stack.push({ obj: elem as Record<string, unknown>, path: `${childPath}[]`, insidePreserve: false });
          }
        }
        continue;
      }
      if (value !== null && typeof value === 'object') {
        stack.push({
          obj: value as Record<string, unknown>,
          path: childPath,
          insidePreserve: PRESERVE_CHILD_KEYS.has(key),
        });
        continue;
      }
      if (typeof value !== 'string' || value.length === 0) continue;
      if (!secretPaths.has(childPath)) continue;
      if (!SECRET_PLACEHOLDER_REGEX.test(value)) {
        violations.push({ path: childPath, value });
      }
    }
  }
  return violations;
}
