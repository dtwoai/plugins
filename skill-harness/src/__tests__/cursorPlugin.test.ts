import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const json = (path: string) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));

describe('Cursor plugin adapter', () => {
  it('resolves the marketplace to the shared skills and a separate MCP configuration', () => {
    const marketplace = json('.cursor-plugin/marketplace.json');
    const entry = marketplace.plugins.find((plugin: { name: string }) => plugin.name === 'dtwo');
    assert.equal(entry.source, 'dtwo');
    const manifest = json(`${entry.source}/.cursor-plugin/plugin.json`);
    assert.equal(manifest.name, 'dtwo');
    assert.equal(manifest.version, json('dtwo/.claude-plugin/plugin.json').version);
    assert.equal(manifest.skills, './skills/');
    const skills = resolve(root, entry.source, manifest.skills);
    const names = readdirSync(skills).filter(name => statSync(resolve(skills, name)).isDirectory());
    assert.deepEqual(names.sort(), ['dtwo-gateway-config', 'dtwo-gateway-policy', 'dtwo-policy-rego', 'setup']);
    for (const name of names) assert.ok(readFileSync(resolve(skills, name, 'SKILL.md'), 'utf8').startsWith('---'));
    const cursor = json(`${entry.source}/${manifest.mcpServers}`).mcpServers.dtwo;
    const claude = json('dtwo/.mcp.json').mcpServers.dtwo;
    assert.equal(cursor.url, claude.url);
    assert.equal(typeof cursor.auth.CLIENT_ID, 'string');
    assert.ok(cursor.auth.CLIENT_ID.length > 0);
    assert.deepEqual(Object.keys(cursor.auth), ['CLIENT_ID']);
    assert.equal(cursor.oauth, undefined);
    assert.deepEqual(claude, { url: cursor.url, type: 'http' });
  });
});
