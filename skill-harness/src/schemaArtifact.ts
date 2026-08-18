/**
 * Loader + TypeScript shape for the gateway-config schema artifact.
 *
 * The artifact lives at `dtwo/skills/dtwo-gateway-config/schema-reference.json`
 * inside this plugin repo and is a verbatim copy of what the product repo's
 * schema-artifact generator emits. The types below mirror that generator's
 * output shape (`JsonFieldOutput`, `Section`, `reservedKeys`) so harness code
 * can walk it without a Zod runtime schema — drift is caught at the seam by
 * the exact `generatorVersion` equality pin below, not by structural
 * validation.
 *
 * That pin is weaker than it looks: `generatorVersion` is hand-maintained
 * upstream and has stayed at 1.0.0 across real content change. The digest's
 * embedded artifact sha256 (see `scripts/generate-schema-digest.mjs`) is what
 * makes a content refresh visible.
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

/**
 * `platform` is emitted by the currently vendored artifact (every
 * `gateway.intent.*` field carries it) and was missing from this union — a
 * type-level lie, not new drift. The artifact is loaded via an unchecked
 * `JSON.parse(raw) as SchemaArtifact` below, so this union is a claim about
 * the data, never an enforcement of it.
 */
export type TargetKind = 'envVar' | 'sotwPath' | 'advanced' | 'platform';

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
