/**
 * Utilities for pulling YAML out of an assistant response and deciding
 * whether a response is a clarifying question.
 *
 * The skill's SKILL.md prescribes fenced YAML as the final answer shape.
 * We tolerate that a response may include earlier fenced examples (e.g.
 * when Claude walks through reasoning) — `extractYaml` takes the LAST
 * matching fence because the final answer is at the tail.
 *
 * When the runner is backed by the MCP stub, captured tool-call payloads
 * are the canonical output path. `extractYamlFromCaptures` mirrors the
 * "last save beats last validate" rule that `mcpStubLauncher` owns.
 */

import type { CapturedCall } from './mcpStub.js';
import { extractCapturedYaml } from './mcpStubLauncher.js';

const FENCE_RE = /```(yaml|yml)\s*\n([\s\S]*?)```/gi;

/**
 * Return the unfenced body of the LAST ```yaml``` / ```yml``` fence in
 * `assistantText`. Case-insensitive on the language tag. `null` if no
 * fence matches.
 */
export function extractYaml(assistantText: string): string | null {
  FENCE_RE.lastIndex = 0;
  let lastBody: string | null = null;
  // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic exec loop
  for (let m: RegExpExecArray | null; (m = FENCE_RE.exec(assistantText)) !== null; ) {
    lastBody = m[2];
  }
  if (lastBody === null) return null;
  // Strip the trailing newline inside the fence but keep internal whitespace.
  return lastBody.replace(/\n$/, '');
}

/**
 * Return the YAML payload of the last `dtwo-save-gateway-draft-config`
 * (preferred) or `dtwo-validate-gateway-config` tool call in the
 * capture stream. `null` when neither fired.
 *
 * Thin wrapper around `mcpStubLauncher.extractCapturedYaml` — kept here
 * because `extract.ts` is the canonical "where does the runner get its
 * YAML from" module, and callers shouldn't need to know which MCP
 * plumbing file owns the primitive.
 */
export function extractYamlFromCaptures(captures: CapturedCall[]): string | null {
  return extractCapturedYaml(captures);
}

const QUESTION_PATTERNS: RegExp[] = [/\bI need\b/i, /\bcould you (specify|clarify|provide)\b/i];

/**
 * Heuristic: is this text a clarifying question rather than a config?
 *
 * Conservative — we'd rather miss a question and let the runner fall
 * through to "no YAML, give up" than invent a false-positive clarification
 * loop.
 *
 * Rule set:
 *   - Strip any YAML fences first (so "Here's my answer: … ```yaml …```"
 *     doesn't count as a question because of the `?` in prose).
 *   - True if the cleaned text (trimmed) ends with `?`.
 *   - True if the cleaned text matches one of the phrase patterns.
 */
export function looksLikeQuestion(text: string): boolean {
  const cleaned = text.replace(FENCE_RE, '').trim();
  if (cleaned.length === 0) return false;
  if (cleaned.endsWith('?')) return true;
  for (const re of QUESTION_PATTERNS) {
    if (re.test(cleaned)) return true;
  }
  return false;
}
