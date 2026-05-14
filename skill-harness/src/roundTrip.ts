/**
 * Path-set round-trip diff for YAML → ConfigSchema → parsed.
 *
 * The motivating failure mode is a silent *drop*: a typo sibling key that
 * Zod's `object` schema silently strips (default strip behavior), leaving
 * the user with no feedback that their value was ignored. This check
 * catches that by comparing the set of paths in the raw YAML against the
 * set of paths in the parsed output.
 *
 * Value-equality is intentionally NOT compared — the plan defers that
 * until we observe LLM outputs where Zod coerces a value into something
 * unintended (Phase 1 binding decision #4).
 *
 * `extra_authorize_params` subtree handling: `walkYamlPaths` stops
 * recursion at the preserve-child leaf on both the input and parsed
 * sides, so casing differences inside that subtree cannot leak into the
 * diff.
 */

import yaml from 'js-yaml';
import { ConfigSchema } from '../vendor/config-validator.bundle.mjs';
import { walkYamlPaths } from './hallucination.js';

export type RoundTripResult = {
  parsed: unknown;
  missingPaths: string[];
  parseError?: string;
};

export function roundTripDiff(rawYaml: string): RoundTripResult {
  let inputObj: unknown;
  try {
    inputObj = yaml.load(rawYaml);
  } catch (e) {
    return {
      parsed: undefined,
      missingPaths: [],
      parseError: `Invalid YAML: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const result = ConfigSchema.safeParse(inputObj);
  if (!result.success) {
    return {
      parsed: undefined,
      missingPaths: [],
      parseError: result.error.toString(),
    };
  }

  const inputPaths = walkYamlPaths(inputObj);
  const parsedPaths = walkYamlPaths(result.data);
  const missing: string[] = [];
  for (const p of inputPaths) {
    if (!parsedPaths.has(p)) missing.push(p);
  }
  return {
    parsed: result.data,
    missingPaths: missing.sort(),
  };
}
