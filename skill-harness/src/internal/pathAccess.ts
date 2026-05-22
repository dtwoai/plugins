/**
 * Look up a dotted path with concrete array indices against a parsed YAML
 * object. Supports the `mcp_servers[0].authentication.type` form used by
 * fixture `required_paths` / `forbidden_paths` / `value_constraints[].path`.
 *
 * Case: lowercase segment match first, then case-insensitive fallback.
 * This mirrors `ConfigSchema`'s `normalizeKeysDeep` preprocessing so a
 * fixture path like `mcp_servers[0].authentication.type` resolves whether
 * the parsed root came from `yaml.load` directly (case-preserving) or
 * from `ConfigSchema.safeParse` (case-normalized).
 *
 * Array indices: bracketed integers advance into the array by index.
 * `[]` (empty brackets) is intentionally rejected — this helper is for
 * concrete-index lookups; normalize to `[]` separately if you want set
 * ops.
 */

// Segments look like:
//   `foo`          -> object key lookup
//   `mcp_servers`  -> object key lookup
//   `mcp_servers[0]` -> object key `mcp_servers`, then array index 0
//   `tags[0][1]`     -> object key `tags`, then array indices 0 then 1
const SEGMENT_RE = /^([^[]+)((?:\[\d+\])*)$/;

function parseSegment(raw: string): { key: string; indices: number[] } | null {
  const m = SEGMENT_RE.exec(raw);
  if (!m) return null;
  const key = m[1];
  const bracket = m[2];
  const indices: number[] = [];
  if (bracket.length > 0) {
    const re = /\[(\d+)\]/g;
    let im: RegExpExecArray | null;
    // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex exec loop
    while ((im = re.exec(bracket)) !== null) {
      indices.push(Number(im[1]));
    }
  }
  return { key, indices };
}

function lookupObjectKey(obj: Record<string, unknown>, key: string): unknown {
  if (key in obj) return obj[key];
  const lc = key.toLowerCase();
  if (lc in obj) return obj[lc];
  for (const k of Object.keys(obj)) {
    if (k.toLowerCase() === lc) return obj[k];
  }
  return undefined;
}

export function getAtPath(obj: unknown, path: string): unknown {
  if (obj === null || typeof obj !== 'object') return undefined;
  const segments = path.split('.');
  let cursor: unknown = obj;
  for (const seg of segments) {
    if (cursor === null || typeof cursor === 'undefined') return undefined;
    const parsed = parseSegment(seg);
    if (!parsed) return undefined;
    if (typeof cursor !== 'object' || Array.isArray(cursor)) return undefined;
    cursor = lookupObjectKey(cursor as Record<string, unknown>, parsed.key);
    for (const idx of parsed.indices) {
      if (!Array.isArray(cursor)) return undefined;
      cursor = cursor[idx];
    }
  }
  return cursor;
}
