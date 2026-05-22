/**
 * Loader + TypeScript shape for the gateway-config schema artifact.
 *
 * The artifact lives at `dtwo/skills/dtwo-gateway-config/schema-reference.json`
 * inside this plugin repo and is byte-identical to the one in d2's
 * `@workspace/utils` package (generated there by `scripts/gen-schema-docs.ts`,
 * mirrored here by the skill-publishing workflow). Its shape is described in
 * d2's `packages/libs/utils/src/internal/genSchemaDocs.ts` (`JsonFieldOutput`,
 * `Section`, `reservedKeys`). We mirror that shape here so harness code can
 * walk it without a Zod runtime schema — drift is caught at the seam by the
 * exact `generatorVersion` equality pin below, not by structural validation.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The harness pins to an exact version string, not a range. A
 * `generatorVersion` bump in the artifact must surface as a loud Tier-1
 * failure so we re-audit the harness's shape assumptions.
 */
export const SCHEMA_ARTIFACT_VERSION = '1.0.0';

export type TargetKind = 'envVar' | 'sotwPath' | 'advanced';

export type FieldRecord = {
  name: string;
  required: boolean;
  type: string;
  constraints: string[];
  enumValues: string[] | null;
  audience: 'user' | 'internal';
  rationale?: string;
  schemaDefault: unknown;
  deployDefault: unknown;
  target: string | null;
  targetKind?: TargetKind;
  description: string;
  literalValue?: unknown;
  secret?: boolean;
};

export type VariantSummary = {
  name: string;
  path: string;
  requiredFields: string[];
};

export type CrossFieldConstraint = {
  message: string;
};

export type Section = {
  path: string;
  title: string;
  description: string | null;
  fields: FieldRecord[];
  variants?: VariantSummary[];
  crossFieldConstraints?: CrossFieldConstraint[];
};

export type ReservedKey = {
  key: string;
  schemaPath?: string;
};

export type SchemaArtifact = {
  generatorVersion: string;
  source: string;
  note: string;
  sections: Section[];
  reservedKeys: ReservedKey[];
};

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Default on-disk location: the committed artifact alongside the skill in
 * this plugin repo. Resolved relative to this source file so it works when
 * run via tsx from any cwd.
 *
 *   skill-harness/src/schemaArtifact.ts
 *   dtwo/skills/dtwo-gateway-config/schema-reference.json
 *
 * The `../../dtwo/skills/...` hop matches the layout: from `src/` up through
 * `skill-harness/` to the plugin repo root, then down into `dtwo/skills/`.
 */
export const DEFAULT_SCHEMA_ARTIFACT_PATH = resolve(
  HERE,
  '../../dtwo/skills/dtwo-gateway-config/schema-reference.json',
);

/**
 * Read and return the schema artifact.
 *
 * Throws if `generatorVersion` does not equal `SCHEMA_ARTIFACT_VERSION` exactly
 * — see the comment on the constant for why this is an equality check.
 */
export function loadSchemaArtifact(path: string = DEFAULT_SCHEMA_ARTIFACT_PATH): SchemaArtifact {
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw) as SchemaArtifact;
  if (parsed.generatorVersion !== SCHEMA_ARTIFACT_VERSION) {
    throw new Error(
      `schema-reference.json generatorVersion ${JSON.stringify(parsed.generatorVersion)} ` +
        `!= expected ${JSON.stringify(SCHEMA_ARTIFACT_VERSION)}. A version bump must trigger a harness audit ` +
        '— update SCHEMA_ARTIFACT_VERSION after reviewing shape changes.',
    );
  }
  return parsed;
}
