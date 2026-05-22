import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { filterArtifactForSkill } from '../../runner/audienceFilter.js';
import { buildSystemPromptBlocks, loadSkillBundle } from '../../runner/systemPrompt.js';
import { loadSchemaArtifact } from '../../schemaArtifact.js';

const artifact = loadSchemaArtifact();
const filtered = filterArtifactForSkill(artifact);

describe('loadSkillBundle', () => {
  it('reads SKILL.md when references/ and examples/ are absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'skill-bundle-'));
    try {
      writeFileSync(join(dir, 'SKILL.md'), '# Skill\n\nBody.');
      const bundle = loadSkillBundle(dir);
      assert.match(bundle, /# File: SKILL\.md/);
      assert.match(bundle, /# Skill/);
      assert.ok(!bundle.includes('references/'), 'no references/ marker expected');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('concatenates references/ and examples/ md files in sorted order', () => {
    const dir = mkdtempSync(join(tmpdir(), 'skill-bundle-'));
    try {
      writeFileSync(join(dir, 'SKILL.md'), '# Skill root');
      mkdirSync(join(dir, 'references'));
      writeFileSync(join(dir, 'references', 'b.md'), '# b ref');
      writeFileSync(join(dir, 'references', 'a.md'), '# a ref');
      mkdirSync(join(dir, 'examples'));
      writeFileSync(join(dir, 'examples', 'slack.md'), '# slack');
      const bundle = loadSkillBundle(dir);
      const aIdx = bundle.indexOf('# a ref');
      const bIdx = bundle.indexOf('# b ref');
      const slackIdx = bundle.indexOf('# slack');
      assert.ok(aIdx !== -1 && bIdx !== -1 && slackIdx !== -1);
      assert.ok(aIdx < bIdx, 'a should precede b (alpha sort)');
      assert.ok(bIdx < slackIdx, 'references should come before examples');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('buildSystemPromptBlocks', () => {
  it('emits exactly two cached blocks', () => {
    const blocks = buildSystemPromptBlocks({ skillBundle: '# Skill', filteredArtifact: filtered });
    assert.equal(blocks.length, 2);
    for (const block of blocks) {
      assert.equal(block.type, 'text');
      assert.deepEqual(block.cache_control, { type: 'ephemeral' });
    }
  });

  it('includes the skill bundle once', () => {
    const sentinel = 'SKILL-SENTINEL-42';
    const blocks = buildSystemPromptBlocks({ skillBundle: sentinel, filteredArtifact: filtered });
    const text = blocks.map(b => b.text).join('\n');
    const count = text.split(sentinel).length - 1;
    assert.equal(count, 1);
  });

  it('includes the filtered artifact once, as JSON', () => {
    const blocks = buildSystemPromptBlocks({ skillBundle: '# Skill', filteredArtifact: filtered });
    // The JSON block carries `generatorVersion` — check it appears once.
    const all = blocks.map(b => b.text).join('\n');
    const count = all.split('"generatorVersion"').length - 1;
    assert.equal(count, 1);
  });

  it('omits the artifact block when injectArtifact is false', () => {
    const sentinel = 'SKILL-SENTINEL-99';
    const blocks = buildSystemPromptBlocks({
      skillBundle: sentinel,
      filteredArtifact: filtered,
      injectArtifact: false,
    });
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type, 'text');
    assert.equal(blocks[0].text, sentinel);
    assert.deepEqual(blocks[0].cache_control, { type: 'ephemeral' });
    // The artifact's `generatorVersion` marker must not leak into the block.
    assert.ok(!blocks[0].text.includes('"generatorVersion"'));
  });

  it('defaults injectArtifact=true (emits both blocks)', () => {
    const blocks = buildSystemPromptBlocks({ skillBundle: '# Skill', filteredArtifact: filtered });
    assert.equal(blocks.length, 2);
  });
});
