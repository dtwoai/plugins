/**
 * Walk a parsed YAML object and yield the set of normalized paths it
 * touches. Mirrors the ConfigSchema's `normalizeKeysDeep` preprocessing:
 * keys are lowercased *except* inside `extra_authorize_params`
 * (`PRESERVE_CHILD_KEYS` in `config.ts`).
 *
 * Record-leaf handling: for any ancestor that is a `PRESERVE_CHILD_KEYS`
 * map, we emit the child's path (the record leaf's key) and stop — we do
 * NOT recurse into the value. The key itself is part of the allowed path
 * set as the record leaf; validation of the child *key syntax* (e.g.
 * `/^[A-Za-z0-9_.-]+$/` for `extra_authorize_params`) is delegated to
 * `parseConfig` via a `must_validate: true` fixture.
 */

import { normalizeYamlPath, PRESERVE_CHILD_KEYS } from './paths.js';

type WalkNode = { obj: Record<string, unknown>; path: string; insidePreserve: boolean };

function joinKey(prefix: string, segment: string): string {
  return prefix === '' ? segment : `${prefix}.${segment}`;
}

/**
 * Emit normalized paths for every object/array leaf the walker touches.
 * Array values widen to `[]` in the path. Primitive leaves (strings,
 * numbers, booleans, null) terminate the walk at their containing key —
 * their *value* is not a path segment.
 */
export function walkYamlPaths(root: unknown): Set<string> {
  const paths = new Set<string>();
  if (root === null || typeof root !== 'object' || Array.isArray(root)) return paths;

  const stack: WalkNode[] = [{ obj: root as Record<string, unknown>, path: '', insidePreserve: false }];

  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) break;

    // Inside a PRESERVE_CHILD_KEYS subtree we've already emitted the
    // record leaf (the parent's key, e.g. `extra_authorize_params`).
    // Child keys of the leaf are case-sensitive external identifiers —
    // emit nothing more and stop the walk here. Validation of the child
    // *key syntax* is delegated to parseConfig via `must_validate: true`.
    if (frame.insidePreserve) continue;

    for (const rawKey of Object.keys(frame.obj)) {
      const normalizedKey = rawKey.toLowerCase();
      const childPath = joinKey(frame.path, normalizedKey);
      paths.add(normalizeYamlPath(childPath));

      const value = frame.obj[rawKey];

      if (Array.isArray(value)) {
        // Array elements widen to `[]` in the path; if an element is an
        // object, recurse under the widened path.
        for (const elem of value) {
          if (elem !== null && typeof elem === 'object' && !Array.isArray(elem)) {
            stack.push({
              obj: elem as Record<string, unknown>,
              path: `${childPath}[]`,
              insidePreserve: false,
            });
          }
        }
        continue;
      }

      if (value !== null && typeof value === 'object') {
        // Record-leaf boundary: recurse one level deeper into the value
        // object with `insidePreserve: true`, which terminates the walk
        // there. The leaf itself is already in `paths`.
        stack.push({
          obj: value as Record<string, unknown>,
          path: childPath,
          insidePreserve: PRESERVE_CHILD_KEYS.has(normalizedKey),
        });
      }
    }
  }

  return paths;
}

/**
 * Compare a walked YAML path set against the allowed set from the schema
 * artifact. Any path in the YAML not present in `allowed` is reported.
 *
 * Record-leaf child paths (entries *inside* an `extra_authorize_params`
 * map) are never emitted by `walkYamlPaths` (the walker stops at the
 * leaf), so they cannot show up here. The leaf itself — the path ending
 * in `.extra_authorize_params` — *is* emitted and must appear in `allowed`.
 */
export function findHallucinations(root: unknown, allowed: Set<string>): string[] {
  const walked = walkYamlPaths(root);
  const out: string[] = [];
  for (const p of walked) {
    if (!allowed.has(p)) out.push(p);
  }
  return out.sort();
}
