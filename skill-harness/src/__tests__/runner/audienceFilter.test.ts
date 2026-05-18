import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { filterArtifactForSkill } from '../../runner/audienceFilter.js';
import { loadSchemaArtifact } from '../../schemaArtifact.js';

const artifact = loadSchemaArtifact();
const filtered = filterArtifactForSkill(artifact);

describe('filterArtifactForSkill', () => {
  it('keeps only audience=user fields in each section', () => {
    for (const section of filtered.sections) {
      for (const field of section.fields) {
        assert.equal(field.audience, 'user', `field ${section.path}.${field.name} leaked audience=${field.audience}`);
      }
    }
  });

  it('drops no internal-only fields by accident on the user side', () => {
    // Spot-check: `gateway.advanced` is a known user-audience field and
    // must survive the filter. If this test fails, the filter is too
    // aggressive.
    const gatewaySection = filtered.sections.find(s => s.path === 'gateway');
    assert.ok(gatewaySection, 'expected gateway section to still be present after filter');
    const advanced = gatewaySection.fields.find(f => f.name === 'advanced');
    assert.ok(advanced, 'expected gateway.advanced (audience=user) to survive filter');
  });

  it('preserves reservedKeys, generatorVersion, source, note', () => {
    assert.equal(filtered.generatorVersion, artifact.generatorVersion);
    assert.equal(filtered.source, artifact.source);
    assert.equal(filtered.note, artifact.note);
    assert.deepEqual(filtered.reservedKeys, artifact.reservedKeys);
  });

  it('preserves section-level variants and crossFieldConstraints', () => {
    for (const section of filtered.sections) {
      const original = artifact.sections.find(s => s.path === section.path && s.title === section.title);
      if (!original) continue;
      if (original.variants) {
        assert.deepEqual(section.variants, original.variants, `variants changed on section ${section.path}`);
      }
      if (original.crossFieldConstraints) {
        assert.deepEqual(
          section.crossFieldConstraints,
          original.crossFieldConstraints,
          `crossFieldConstraints changed on section ${section.path}`,
        );
      }
    }
  });

  it('does not mutate the input artifact', () => {
    // Snapshot a couple of internal-only fields before re-filtering and
    // ensure the original's shape is unchanged.
    const beforeLen = JSON.stringify(artifact).length;
    filterArtifactForSkill(artifact);
    const afterLen = JSON.stringify(artifact).length;
    assert.equal(beforeLen, afterLen);
  });

  it('shrinks the JSON string length (directional, not a fixed %)', () => {
    const before = JSON.stringify(artifact).length;
    const after = JSON.stringify(filtered).length;
    assert.ok(after < before, `filter should shrink the artifact (before=${before}, after=${after})`);
    // Sanity floor: the filter should not reduce by MORE than 99% — that
    // would imply everything got filtered and the plan's "~40%" headline
    // is totally off.
    const ratio = after / before;
    assert.ok(ratio > 0.01, `filter should not nuke the artifact (ratio=${ratio})`);
  });
});
