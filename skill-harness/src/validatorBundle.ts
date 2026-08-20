/**
 * Seam for the vendored config validator.
 *
 * `vendor/config-validator.bundle.mjs` is a second vendored artifact,
 * generated separately from `schema-reference.json`. Both rubric checks that
 * consult it (`must_validate` via `parseConfig`, `no_dropped_keys` via
 * `ConfigSchema`) import it through here, so the pin below executes on every
 * validating path.
 *
 * This is a SHAPE pin, not a freshness signal. `VALIDATOR_BUNDLE_VERSION` is
 * a hand-maintained constant in the generated bundle; it would NOT have
 * caught the divergence recorded in known-defects.md entry
 * `validator-bundle-drift` (resolved by re-vendoring both artifacts from the
 * same source revision), exactly as the identically-designed
 * `SCHEMA_ARTIFACT_VERSION` pin stayed at 1.0.0 across real content drift in
 * the schema artifact. Its job is to make a future bundle swap a deliberate,
 * visible act — not to detect that the current bundle is stale.
 *
 * `EXPECTED_VALIDATOR_BUNDLE_SHA256` is the part that detects content
 * movement. It is asserted at test time (see __tests__/schemaDigest.test.ts)
 * rather than at module load, so a bundle refresh fails one clearly-named
 * test instead of every import.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigSchema, parseConfig, VALIDATOR_BUNDLE_VERSION } from '../vendor/config-validator.bundle.mjs';

/** Shape pin. See the module docstring for what this does and does not catch. */
export const EXPECTED_VALIDATOR_BUNDLE_VERSION = '2.0.0';

/**
 * sha256 of the vendored bundle's bytes. Asserted by
 * `__tests__/schemaDigest.test.ts`, not at module load. Bump this together
 * with `EXPECTED_VALIDATOR_BUNDLE_VERSION` when the bundle is re-vendored.
 */
export const EXPECTED_VALIDATOR_BUNDLE_SHA256 = 'd5d07962a80a47e3ccc7a9550e6b56650321bed2d3a541d932c70f167d5c9bda';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Resolved absolute path to the vendored bundle, so callers that need to hash
 * it do not duplicate the path hop. Mirrors the `DEFAULT_SCHEMA_ARTIFACT_PATH`
 * idiom in `schemaArtifact.ts`.
 */
export const VALIDATOR_BUNDLE_PATH = resolve(HERE, '../vendor/config-validator.bundle.mjs');

if (VALIDATOR_BUNDLE_VERSION !== EXPECTED_VALIDATOR_BUNDLE_VERSION) {
  throw new Error(
    `config-validator.bundle.mjs VALIDATOR_BUNDLE_VERSION ${JSON.stringify(VALIDATOR_BUNDLE_VERSION)} ` +
      `!= expected ${JSON.stringify(EXPECTED_VALIDATOR_BUNDLE_VERSION)}. A vendored-bundle swap must be a ` +
      'deliberate act — re-audit the rubric checks that read it, then update ' +
      'EXPECTED_VALIDATOR_BUNDLE_VERSION and EXPECTED_VALIDATOR_BUNDLE_SHA256 together.',
  );
}

export { ConfigSchema, parseConfig, VALIDATOR_BUNDLE_VERSION };
