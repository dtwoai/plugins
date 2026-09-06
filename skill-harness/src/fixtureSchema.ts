/**
 * Zod schema for fixture files under `fixtures/*.yaml`. One fixture per
 * YAML file; format per the plan (§Fixture format).
 *
 * Rubrics encode only prompt-specific expectations:
 *   - `must_validate` (boolean)
 *   - `required_paths` / `forbidden_paths` (string arrays)
 *   - `value_constraints` (one strict shape per kind: equals / regex /
 *      min_length / max_length)
 *   - `semantic_rubric` (string bullets, accepted but not evaluated in
 *      Phase 1 — deferred to LLM-judge v1.1).
 *
 * Global metadata-driven checks (hallucination walk, round-trip diff,
 * safe-default preservation, secret placeholders) apply automatically and
 * are NOT declared per fixture.
 */

import { z } from 'zod';

export const FollowupSchema = z.object({
  match: z.string().min(1),
  reply: z.string().min(1),
});

/**
 * Every member is a strict object and `EqualsConstraint` comes LAST in the
 * union. Both are load-bearing. `equals: z.unknown()` accepts an absent key,
 * so with a plain object first in the union `{ path, regex }` and
 * `{ path, min_length }` both parsed as an equals-constraint and lost their
 * discriminating key (a plain object strips unknown keys) — every `regex` and
 * `min_length` in the battery was silently vacuous (see known-defects.md,
 * `value-constraints-stripped-at-parse`). The specific kinds now match first,
 * strict objects turn a misspelt key into a fixture-load error instead of a
 * constraint that never fires, and the refine on `EqualsConstraint` rejects a
 * bare `{ path }` that would otherwise slip through as an equals with no value.
 */
const RegexConstraint = z.strictObject({
  path: z.string().min(1),
  regex: z.string().min(1),
});

const MinLengthConstraint = z.strictObject({
  path: z.string().min(1),
  min_length: z.number().int().nonnegative(),
});

/**
 * Upper bound on a string/array length. Unlike the other kinds an ABSENT path
 * is not a failure: it counts as length 0. `max_length: 0` therefore reads
 * "absent or empty", which is the assertion a fixture needs for a provider
 * that rejects any `scope` parameter — `forbidden_paths` cannot express it,
 * because `parseConfig` fills the defaulted `scopes: []` in and the key is
 * then present whether or not the YAML carried it.
 */
const MaxLengthConstraint = z.strictObject({
  path: z.string().min(1),
  max_length: z.number().int().nonnegative(),
});

const EqualsConstraint = z
  .strictObject({
    path: z.string().min(1),
    equals: z.unknown(),
  })
  .refine(c => 'equals' in c, { message: 'value_constraint has none of equals / regex / min_length / max_length' });

export const ValueConstraintSchema = z.union([
  RegexConstraint,
  MinLengthConstraint,
  MaxLengthConstraint,
  EqualsConstraint,
]);
export type ValueConstraint = z.infer<typeof ValueConstraintSchema>;

export const ExpectSchema = z.object({
  must_validate: z.boolean(),
  required_paths: z.array(z.string().min(1)).optional(),
  forbidden_paths: z.array(z.string().min(1)).optional(),
  value_constraints: z.array(ValueConstraintSchema).optional(),
  semantic_rubric: z.array(z.string().min(1)).optional(),
  /**
   * Opt-out list for the `safe_defaults_preserved` check. Each entry is a
   * dotted path the fixture has a legitimate reason to weaken (e.g. a
   * "allow localhost for local development" prompt). The rubric passes
   * this set to `findWeakenedDefaults(..., optOut)`, which skips those
   * paths when comparing to the seed list. Keep the list narrow — every
   * entry explicitly acknowledges a safe-default bypass and should be
   * motivated by the fixture's `user_prompt`.
   */
  safe_default_opt_out: z.array(z.string().min(1)).optional(),
});

export const FixtureSchema = z.object({
  id: z.string().min(1),
  tier: z.enum(['required', 'aspirational']),
  tags: z.array(z.string().min(1)).optional(),
  user_prompt: z.string().min(1),
  followups: z.array(FollowupSchema).optional(),
  expect: ExpectSchema,
  clarifying_question_expected: z.boolean().optional().default(false),
});

export type Fixture = z.infer<typeof FixtureSchema>;

/**
 * Stable discriminator tag for a `value_constraints[]` entry.
 * Useful for rubric evaluation and test assertions.
 */
export function constraintKind(c: ValueConstraint): 'equals' | 'regex' | 'min_length' | 'max_length' {
  if ('equals' in c) return 'equals';
  if ('regex' in c) return 'regex';
  if ('max_length' in c) return 'max_length';
  return 'min_length';
}
