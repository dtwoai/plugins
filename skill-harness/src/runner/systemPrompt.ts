/**
 * System-prompt assembly for Tier-2 bench runs.
 *
 * Emits exactly two cached text blocks:
 *   1. The skill bundle (SKILL.md + any `references/` / `examples/` docs).
 *   2. The filtered schema artifact, pretty-printed as JSON.
 *
 * Prompt caching is the entire reason this module exists — both blocks
 * carry `cache_control: { type: 'ephemeral' }` per the Anthropic Messages
 * API. Cache-hits on these blocks keep per-run cost flat across the 40+
 * prompt battery. Messages (user prompts + assistant replies) are
 * intentionally uncached because followup dispatches change the message
 * list per fixture — see Phase 3 decision #4 on the plan.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { SchemaArtifact } from '../schemaArtifact.js';

export type SystemBlock = {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
};

/**
 * Read a skill bundle directory. Always reads `SKILL.md`. If `references/`
 * or `examples/` exist, concatenates every `.md` under them (sorted
 * alphabetically for determinism) after the skill body. Missing
 * subdirectories are tolerated — Phase 3 ships with SKILL.md only.
 *
 * File-boundary markers make the blob self-describing when it shows up in
 * a cached prompt dump:
 *
 *     ---
 *     # File: references/foo.md
 *     ---
 */
export function loadSkillBundle(skillDir: string): string {
  const parts: string[] = [];
  const skillPath = join(skillDir, 'SKILL.md');
  parts.push(`---\n# File: SKILL.md\n---\n${readFileSync(skillPath, 'utf8').trimEnd()}`);

  for (const sub of ['references', 'examples']) {
    const subDir = join(skillDir, sub);
    let stat: ReturnType<typeof statSync> | null = null;
    try {
      stat = statSync(subDir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    const entries = readdirSync(subDir, { withFileTypes: true })
      .filter(e => e.isFile() && e.name.endsWith('.md'))
      .map(e => e.name)
      .sort((a, b) => a.localeCompare(b));
    for (const name of entries) {
      const body = readFileSync(join(subDir, name), 'utf8').trimEnd();
      parts.push(`---\n# File: ${sub}/${name}\n---\n${body}`);
    }
  }

  return parts.join('\n\n');
}

/**
 * Build the system-prompt blocks. The skill block is first so a cache
 * miss on the artifact (which updates when `config.ts` changes) still
 * preserves the skill-bundle cache hit.
 *
 * When `injectArtifact` is false, only the skill-bundle block is
 * returned — production Claude Code does not auto-load `references/`
 * files or auto-inject the schema artifact, so this mode lets us bench
 * the skill under production-equivalent context conditions. Default is
 * `true` for back-compat with the harness's existing bench baseline.
 */
export function buildSystemPromptBlocks(opts: {
  skillBundle: string;
  filteredArtifact: SchemaArtifact;
  injectArtifact?: boolean;
}): SystemBlock[] {
  const skillBlock: SystemBlock = {
    type: 'text',
    text: opts.skillBundle,
    cache_control: { type: 'ephemeral' },
  };
  if (opts.injectArtifact === false) return [skillBlock];

  const artifactJson = JSON.stringify(opts.filteredArtifact, null, 2);
  return [
    skillBlock,
    {
      type: 'text',
      text: `# schema-reference.json (user-audience filter)\n\n\`\`\`json\n${artifactJson}\n\`\`\``,
      cache_control: { type: 'ephemeral' },
    },
  ];
}
