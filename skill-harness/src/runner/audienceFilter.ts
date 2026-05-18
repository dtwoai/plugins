/**
 * Audience filter for the schema artifact.
 *
 * The canonical artifact under
 * `dtwo/skills/dtwo-gateway-config/schema-reference.json` carries every
 * leaf regardless of `audience` (internal tuning fields plus user-facing
 * ones) so the harness and the schema-docs drift detector can walk the
 * full graph. When the artifact is inlined into
 * the skill's system prompt, though, we only want the user-facing surface
 * — internal tuning fields just bloat context without guiding authoring.
 *
 * `filterArtifactForSkill` returns a deep copy with only `audience: 'user'`
 * leaves in each section's `fields[]`. Sections that become empty AND have
 * no `variants[]` AND no descendant sections (reachable via the section-
 * path prefix) are dropped. Otherwise we keep the section with a possibly-
 * empty `fields: []` so variant scaffolding still renders in the prompt.
 *
 * Everything else (`reservedKeys`, `generatorVersion`, `source`, `note`,
 * `sections[].variants`, `sections[].crossFieldConstraints`) passes
 * through untouched — the filter is strictly on field-level `audience`,
 * nothing more.
 */

import type { SchemaArtifact, Section } from '../schemaArtifact.js';

function hasDescendantSection(sectionPath: string, allSections: Section[]): boolean {
  if (sectionPath === '') {
    // Root section — everything is a descendant. Treat as false for the
    // drop decision: if the root's fields all drop out, we still want the
    // top-level section stub so the skill sees the schema shape.
    return false;
  }
  const prefix = `${sectionPath}.`;
  for (const s of allSections) {
    if (s.path !== sectionPath && s.path.startsWith(prefix)) return true;
  }
  return false;
}

export function filterArtifactForSkill(artifact: SchemaArtifact): SchemaArtifact {
  // Deep clone to avoid mutating the caller's copy. `structuredClone` is
  // Node 17+; we're on Node 24 per the project's asdf pin.
  const copy = structuredClone(artifact);

  const keptSections: Section[] = [];
  for (const section of copy.sections) {
    const filteredFields = section.fields.filter(f => f.audience === 'user');
    const hasVariants = Array.isArray(section.variants) && section.variants.length > 0;
    const hasDescendants = hasDescendantSection(section.path, copy.sections);
    const keepEmpty = hasVariants || hasDescendants || section.path === '';
    if (filteredFields.length === 0 && !keepEmpty) continue;
    keptSections.push({ ...section, fields: filteredFields });
  }

  return {
    ...copy,
    sections: keptSections,
  };
}
