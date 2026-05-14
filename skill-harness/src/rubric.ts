/**
 * Rubric interpreter.
 *
 * Evaluates a fixture's expectations against a raw YAML config string
 * (the simulated skill output). Runs six deterministic checks; all
 * failures are collected (no short-circuit) so a single rubric run
 * surfaces every violation.
 *
 * Check order and `check` names (used by tests + future Tier-2 summary):
 *   1. `must_validate`          — `parseConfig` must succeed (picks up
 *                                 the reserved-`advanced` blocklist via
 *                                 PR #733's runtime `.superRefine`).
 *   2. `no_hallucinated_keys`   — `findHallucinations` against the
 *                                 allowed-path set.
 *   3. `no_dropped_keys`        — round-trip `paths(input) \ paths(parsed)`
 *                                 must be empty.
 *   4. `safe_defaults_preserved` — no weakening of the seed list.
 *   5. `secrets_are_placeholders` — secret leaves either absent or a
 *                                 placeholder matching the regex.
 *   6. `required_paths` / `forbidden_paths` / `value_constraints` —
 *                                 per-fixture assertions.
 *
 * `semantic_rubric` bullets are accepted in the fixture shape but NOT
 * evaluated here. They're earmarked for v1.1 LLM-judge.
 */

import yaml from 'js-yaml';
import { parseConfig } from '../vendor/config-validator.bundle.mjs';

import type { Fixture } from './fixtureSchema.js';
import { constraintKind } from './fixtureSchema.js';
import { findHallucinations } from './hallucination.js';
import { getAtPath } from './internal/pathAccess.js';
import { buildAllowedPathSet } from './paths.js';
import { roundTripDiff } from './roundTrip.js';
import { buildSafeDefaults, findWeakenedDefaults } from './safeDefaults.js';
import type { SchemaArtifact } from './schemaArtifact.js';
import { collectSecretPaths, findSecretViolations } from './secrets.js';

export type RubricFailure = { check: string; message: string; path?: string };

export type RubricResult = {
  passed: boolean;
  failures: RubricFailure[];
};

export function evaluateRubric(fixture: Fixture, rawYaml: string, artifact: SchemaArtifact): RubricResult {
  const failures: RubricFailure[] = [];

  // ---- 0. Validate fixture's `safe_default_opt_out` entries up front.
  //
  // Every entry must name a path known to `buildSafeDefaults(artifact)`;
  // otherwise a fixture author who typos a seed path would silently
  // suppress a check that wasn't firing in the first place. Fail loud via
  // a rubric failure rather than a throw — the test run will show the
  // author exactly which entry is unknown.
  const optOutList = fixture.expect.safe_default_opt_out ?? [];
  if (optOutList.length > 0) {
    let knownDefaults: Map<string, unknown> | null = null;
    try {
      knownDefaults = buildSafeDefaults(artifact);
    } catch {
      // If the seed list itself can't be resolved, defer to the check in
      // §4 which surfaces the drift error; skip the guard here.
    }
    if (knownDefaults) {
      for (const entry of optOutList) {
        if (!knownDefaults.has(entry)) {
          failures.push({
            check: 'safe_default_opt_out_unknown',
            message: `safe_default_opt_out entry is not a known safe-default seed: ${entry}`,
            path: entry,
          });
        }
      }
    }
  }

  // ---- 1. Schema validity (also enforces reserved-advanced blocklist via parseConfig's refine).
  let parsedForChecks: unknown;
  if (fixture.expect.must_validate) {
    const pc = parseConfig(rawYaml);
    if (!pc.success) {
      failures.push({ check: 'must_validate', message: pc.error });
    } else {
      parsedForChecks = pc.data;
    }
  }

  // For downstream checks that need the raw/parsed object, fall back to a
  // best-effort `yaml.load` if `parseConfig` wasn't run or failed.
  let loadedRaw: unknown;
  try {
    loadedRaw = yaml.load(rawYaml);
  } catch (e) {
    failures.push({
      check: 'yaml_load',
      message: `Unable to parse YAML: ${e instanceof Error ? e.message : String(e)}`,
    });
    return { passed: false, failures };
  }
  if (parsedForChecks === undefined) {
    parsedForChecks = loadedRaw;
  }

  // ---- 2. Hallucination walk.
  const allowedPaths = buildAllowedPathSet(artifact);
  const hallucinations = findHallucinations(loadedRaw, allowedPaths);
  for (const p of hallucinations) {
    failures.push({ check: 'no_hallucinated_keys', message: `path not in schema: ${p}`, path: p });
  }

  // ---- 3. Round-trip diff (path-set subtraction only; values not compared).
  const rt = roundTripDiff(rawYaml);
  if (rt.parseError) {
    // Only add a standalone entry if we did NOT already fail on must_validate
    // for the same reason — avoids double-reporting the same error.
    if (!fixture.expect.must_validate) {
      failures.push({ check: 'no_dropped_keys', message: `round-trip parse failed: ${rt.parseError}` });
    }
  } else {
    for (const missing of rt.missingPaths) {
      failures.push({ check: 'no_dropped_keys', message: `key dropped by schema: ${missing}`, path: missing });
    }
  }

  // ---- 4. Safe-default preservation.
  try {
    const defaults = buildSafeDefaults(artifact);
    const optOut = fixture.expect.safe_default_opt_out ? new Set(fixture.expect.safe_default_opt_out) : undefined;
    const weakened = findWeakenedDefaults(parsedForChecks, defaults, optOut);
    for (const w of weakened) {
      failures.push({
        check: 'safe_defaults_preserved',
        message: `safe default weakened at ${w.path}: expected ${JSON.stringify(w.expected)}, got ${JSON.stringify(w.actual)}`,
        path: w.path,
      });
    }
  } catch (e) {
    // Seed list can't be resolved — this is a loud-fail signal for schema
    // drift, surface it inside the rubric rather than crashing the caller.
    failures.push({
      check: 'safe_defaults_preserved',
      message: `safe-default seed list drift: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  // ---- 5. Secret placeholders.
  const secretPaths = collectSecretPaths(artifact);
  const secretViolations = findSecretViolations(parsedForChecks, secretPaths);
  for (const v of secretViolations) {
    failures.push({
      check: 'secrets_are_placeholders',
      message: `secret-typed field holds a non-placeholder value at ${v.path}`,
      path: v.path,
    });
  }

  // ---- 6a. required_paths.
  for (const rp of fixture.expect.required_paths ?? []) {
    const val = getAtPath(parsedForChecks, rp);
    if (val === undefined) {
      failures.push({ check: 'required_paths', message: `required path missing: ${rp}`, path: rp });
    }
  }

  // ---- 6b. forbidden_paths.
  for (const fp of fixture.expect.forbidden_paths ?? []) {
    const val = getAtPath(parsedForChecks, fp);
    if (val !== undefined) {
      failures.push({ check: 'forbidden_paths', message: `forbidden path present: ${fp}`, path: fp });
    }
  }

  // ---- 6c. value_constraints.
  for (const c of fixture.expect.value_constraints ?? []) {
    const actual = getAtPath(parsedForChecks, c.path);
    const kind = constraintKind(c);
    if (actual === undefined) {
      failures.push({
        check: 'value_constraints',
        message: `value_constraint target missing: ${c.path}`,
        path: c.path,
      });
      continue;
    }
    if (kind === 'equals') {
      const expected = (c as { equals: unknown }).equals;
      if (!deepEqual(actual, expected)) {
        failures.push({
          check: 'value_constraints',
          message: `value_constraint equals failed at ${c.path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
          path: c.path,
        });
      }
    } else if (kind === 'regex') {
      const pattern = (c as { regex: string }).regex;
      if (typeof actual !== 'string') {
        failures.push({
          check: 'value_constraints',
          message: `value_constraint regex target is not a string at ${c.path}`,
          path: c.path,
        });
      } else {
        // Unanchored by default — use the pattern as authored. Fixtures
        // that want anchoring embed `^`/`$` explicitly.
        const re = new RegExp(pattern);
        if (!re.test(actual)) {
          failures.push({
            check: 'value_constraints',
            message: `value_constraint regex failed at ${c.path}: value ${JSON.stringify(actual)} does not match /${pattern}/`,
            path: c.path,
          });
        }
      }
    } else {
      // min_length
      const min = (c as { min_length: number }).min_length;
      const len = typeof actual === 'string' || Array.isArray(actual) ? actual.length : null;
      if (len === null) {
        failures.push({
          check: 'value_constraints',
          message: `value_constraint min_length target is not a string/array at ${c.path}`,
          path: c.path,
        });
      } else if (len < min) {
        failures.push({
          check: 'value_constraints',
          message: `value_constraint min_length failed at ${c.path}: expected ≥ ${min}, got ${len}`,
          path: c.path,
        });
      }
    }
  }

  return { passed: failures.length === 0, failures };
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao);
    const bk = Object.keys(bo);
    if (ak.length !== bk.length) return false;
    for (const k of ak) {
      if (!(k in bo)) return false;
      if (!deepEqual(ao[k], bo[k])) return false;
    }
    return true;
  }
  return false;
}
