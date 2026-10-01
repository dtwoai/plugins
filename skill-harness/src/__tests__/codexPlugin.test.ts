import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const json = (path: string) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const builder = resolve(root, 'scripts/build-openai-plugin.mjs');
const onPath = (command: string) => spawnSync('which', [command]).status === 0;

const SKILLS = ['dtwo-gateway-config', 'dtwo-gateway-policy', 'dtwo-policy-rego', 'setup'];
const ASSETS = ['assets/icon-dark.svg', 'assets/icon.svg', 'assets/logo-dark.svg', 'assets/logo.svg'];

describe('Codex plugin package', () => {
  it('matches the Claude manifest and reuses the shared skills and MCP configuration', () => {
    const codex = json('dtwo/.codex-plugin/plugin.json');
    const claude = json('dtwo/.claude-plugin/plugin.json');
    for (const key of ['name', 'version', 'description']) assert.equal(codex[key], claude[key], key);

    const skills = resolve(root, 'dtwo', codex.skills);
    assert.equal(skills, resolve(root, 'dtwo/skills'));
    const names = readdirSync(skills).filter(name => statSync(resolve(skills, name)).isDirectory());
    assert.deepEqual(names.sort(), SKILLS);

    assert.equal(resolve(root, 'dtwo', codex.mcpServers), resolve(root, 'dtwo/.mcp.json'));
    const mcp = json(`dtwo/${codex.mcpServers}`).mcpServers.dtwo;
    assert.equal(mcp.url, json('dtwo/.mcp.json').mcpServers.dtwo.url);
  });

  it('passes the build script validation', () => {
    const result = spawnSync(process.execPath, [builder, '--check'], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  });

  it('builds a byte-identical ZIP with only the Codex package files', t => {
    if (!onPath('zip') || !onPath('unzip')) {
      t.skip('zip and unzip must be on PATH to build the Codex package');
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), 'codex-plugin-test-'));
    try {
      const build = (name: string) => {
        const out = join(dir, name);
        const result = spawnSync(process.execPath, [builder, '--out', out], { cwd: root, encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
        return readFileSync(out);
      };
      const first = build('first.zip');
      const second = build('second.zip');
      assert.ok(first.equals(second), 'two builds of the same tree must be byte-identical');

      const listing = spawnSync('unzip', ['-Z1', join(dir, 'first.zip')], { encoding: 'utf8' });
      assert.equal(listing.status, 0, listing.stderr);
      const entries = listing.stdout.split('\n').filter(Boolean);
      const expected = [
        '.codex-plugin/plugin.json',
        '.mcp.json',
        ...SKILLS.map(s => `skills/${s}/SKILL.md`),
        ...ASSETS,
      ];
      for (const entry of expected) assert.ok(entries.includes(entry), `missing ${entry}`);
      const excluded = entries.filter(e =>
        /^\.(claude|cursor)-plugin\/|cursor\.mcp\.json|README\.md|\.DS_Store/.test(e),
      );
      assert.deepEqual(excluded, []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
