#!/usr/bin/env node
/**
 * Validates the Codex plugin manifest and builds the ZIP that OpenAI's plugin
 * directory accepts.
 *
 * The ZIP root is the plugin root. It holds exactly:
 *   .codex-plugin/plugin.json
 *   .mcp.json
 *   skills/**
 *   assets/**
 * The Claude and Cursor manifests, cursor.mcp.json, and README.md stay out.
 *
 * Usage:
 *   node scripts/build-openai-plugin.mjs              # validate, then build dist/dtwo-openai-<version>.zip
 *   node scripts/build-openai-plugin.mjs --check      # validate only, no ZIP
 *   node scripts/build-openai-plugin.mjs --out PATH   # build to PATH instead of dist/
 *
 * Determinism: every staged file and directory gets the same mtime and mode,
 * the file list is sorted, and `zip -X -D` drops extra attributes and
 * directory entries, so two builds of the same tree are byte-identical. `zip`
 * runs with TZ=UTC because ZIP timestamps are stored in local time.
 *
 * Paths are resolved from the repo root (this script's parent directory), so
 * the script can run from any working directory. `--out` is resolved from the
 * working directory.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN_ROOT = join(REPO_ROOT, 'dtwo');
const CODEX_MANIFEST = '.codex-plugin/plugin.json';
const CLAUDE_MANIFEST = '.claude-plugin/plugin.json';
const MCP_CONFIG = '.mcp.json';
const PACKAGED_DIRS = ['skills', 'assets'];

const FIXED_TIME = new Date('2000-01-01T00:00:00Z');
const FILE_MODE = 0o644;
const DIR_MODE = 0o755;
const MAX_ASSET_BYTES = 5 * 1024 * 1024;
const MIN_ASSET_PX = 48;

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
const ASSET_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.svg'];
const ASSET_KEYS = ['composerIcon', 'composerIconDark', 'logo', 'logoDark'];
const URL_KEYS = ['websiteURL', 'supportURL', 'privacyPolicyURL', 'termsOfServiceURL'];

// Text limits from OpenAI's submission guide, as [path, max length, required].
const ROOT_TEXT_LIMITS = [
  ['name', 64, true],
  ['description', 4000, true],
];
const INTERFACE_TEXT_LIMITS = [
  ['displayName', 30, true],
  ['shortDescription', 30, true],
  ['longDescription', 4000, true],
  ['developerName', 80, true],
];
const INTERFACE_LIST_LIMITS = [
  // [key, max items, max length per item]
  ['capabilities', 20, 120],
  ['defaultPrompt', 3, 128],
];

// Leak scan. `EVERYWHERE` runs over the manifest and every packaged file.
// `LISTING_ONLY` runs over the listing surfaces only (the manifest,
// `.mcp.json`, and assets): the skills document product behaviour that
// legitimately mentions localhost (SSRF settings, OAuth callbacks) and the
// open-source ContextForge runtime the gateway ships, and the vendored schema
// artifact cannot be edited by hand.
const LEAK_PATTERNS_EVERYWHERE = [/\.dev\.dtwo\.ai/i, /hub\.dev/i, /sandbox/i, /contextforge-poc/i];
const LEAK_PATTERNS_LISTING_ONLY = [/localhost/i, /127\.0\.0\.1/, /contextforge/i];

function parseArgs(argv) {
  const out = { check: false, out: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') out.check = true;
    else if (a === '--out') {
      const value = argv[++i];
      if (!value) usageError('--out needs a path');
      out.out = value;
    } else if (a.startsWith('--out=')) out.out = a.slice('--out='.length);
    else if (a === '--help' || a === '-h') {
      console.log(
        [
          'Usage: node scripts/build-openai-plugin.mjs [--check] [--out PATH]',
          '',
          '  --check       Validate dtwo/.codex-plugin/plugin.json and the packaged files; do not build.',
          '  --out PATH    Write the ZIP to PATH (default: dist/dtwo-openai-<version>.zip).',
        ].join('\n'),
      );
      process.exit(0);
    } else usageError(`Unknown argument: ${a}`);
  }
  return out;
}

function usageError(message) {
  console.error(message);
  process.exit(2);
}

function readJson(path, problems) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    problems.push(`Cannot read ${relative(REPO_ROOT, path)}: ${e.message}`);
    return undefined;
  }
}

// --- file collection ---------------------------------------------------------

/**
 * Returns the packaged files as sorted plugin-relative POSIX paths. Skips
 * `.DS_Store` and every dotfile or dot-directory under the packaged dirs.
 */
function collectFiles(problems) {
  const files = [CODEX_MANIFEST, MCP_CONFIG];
  const walk = rel => {
    for (const entry of readdirSync(join(PLUGIN_ROOT, rel)).sort()) {
      if (entry.startsWith('.')) continue;
      const childRel = `${rel}/${entry}`;
      const stat = lstatSync(join(PLUGIN_ROOT, childRel));
      if (stat.isSymbolicLink()) problems.push(`Symbolic links are not packaged: dtwo/${childRel}`);
      else if (stat.isDirectory()) walk(childRel);
      else if (stat.isFile()) files.push(childRel);
    }
  };
  for (const dir of PACKAGED_DIRS) {
    if (existsSync(join(PLUGIN_ROOT, dir))) walk(dir);
    else problems.push(`Missing directory: dtwo/${dir}/`);
  }
  return files.sort();
}

// --- validation --------------------------------------------------------------

function checkText(problems, obj, key, max, required, label) {
  const value = obj?.[key];
  if (value === undefined) {
    if (required) problems.push(`${label} is required.`);
    return;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    problems.push(`${label} must be a non-empty string.`);
    return;
  }
  if (value.length > max) problems.push(`${label} is ${value.length} characters; the limit is ${max}.`);
}

function checkList(problems, obj, key, maxItems, maxLength, label) {
  const value = obj?.[key];
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    problems.push(`${label} must be an array.`);
    return;
  }
  if (value.length > maxItems) problems.push(`${label} has ${value.length} items; the limit is ${maxItems}.`);
  value.forEach((item, i) => {
    if (typeof item !== 'string' || item.trim() === '') problems.push(`${label}[${i}] must be a non-empty string.`);
    else if (item.length > maxLength)
      problems.push(`${label}[${i}] is ${item.length} characters; the limit is ${maxLength}.`);
  });
}

/** Resolves a manifest-relative path and checks it stays inside the plugin root. */
function resolveInPlugin(problems, value, label) {
  if (typeof value !== 'string' || !value.startsWith('./')) {
    problems.push(`${label} must be a relative path starting with "./".`);
    return undefined;
  }
  const abs = resolve(PLUGIN_ROOT, value);
  if (abs !== PLUGIN_ROOT && !abs.startsWith(PLUGIN_ROOT + sep)) {
    problems.push(`${label} points outside dtwo/: ${value}`);
    return undefined;
  }
  return abs;
}

function svgSize(text) {
  const tag = text.match(/<svg\b[^>]*>/i)?.[0];
  if (!tag) return undefined;
  const attr = name => tag.match(new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1];
  const viewBox = attr('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (viewBox?.length === 4 && viewBox.every(Number.isFinite)) return { width: viewBox[2], height: viewBox[3] };
  const width = Number.parseFloat(attr('width') ?? '');
  const height = Number.parseFloat(attr('height') ?? '');
  if (Number.isFinite(width) && Number.isFinite(height)) return { width, height };
  return undefined;
}

function pngSize(bytes) {
  const signature = '89504e470d0a1a0a';
  if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== signature) return undefined;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function checkAsset(problems, manifestInterface, key) {
  const label = `interface.${key}`;
  const value = manifestInterface?.[key];
  if (value === undefined) {
    problems.push(`${label} is required.`);
    return;
  }
  const abs = resolveInPlugin(problems, value, label);
  if (!abs) return;
  if (!abs.startsWith(join(PLUGIN_ROOT, 'assets') + sep)) {
    problems.push(`${label} must live under ./assets/ (only assets/ is packaged): ${value}`);
    return;
  }
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    problems.push(`${label} does not exist: dtwo/${relative(PLUGIN_ROOT, abs)}`);
    return;
  }
  const extension = abs.slice(abs.lastIndexOf('.')).toLowerCase();
  if (!ASSET_EXTENSIONS.includes(extension)) {
    problems.push(`${label} must be PNG, JPEG, WebP, or SVG: ${value}`);
    return;
  }
  const bytes = readFileSync(abs);
  if (bytes.length > MAX_ASSET_BYTES) problems.push(`${label} is ${bytes.length} bytes; the limit is 5 MiB.`);
  // JPEG and WebP dimensions are not parsed here; check those by hand.
  let size;
  if (extension === '.svg') size = svgSize(bytes.toString('utf8'));
  else if (extension === '.png') size = pngSize(bytes);
  else return;
  if (!size) {
    problems.push(`${label}: cannot read its dimensions (SVG needs a viewBox or width/height).`);
    return;
  }
  if (size.width !== size.height) problems.push(`${label} must be square; it is ${size.width}x${size.height}.`);
  if (Math.min(size.width, size.height) < MIN_ASSET_PX)
    problems.push(`${label} must be at least ${MIN_ASSET_PX}x${MIN_ASSET_PX}; it is ${size.width}x${size.height}.`);
}

function checkManifest(problems, manifest, claude) {
  for (const [key, max, required] of ROOT_TEXT_LIMITS) checkText(problems, manifest, key, max, required, key);
  if (typeof manifest.name === 'string' && !NAME_RE.test(manifest.name))
    problems.push('name must be lowercase letters, digits, and single hyphens.');
  if (typeof manifest.version !== 'string' || !SEMVER_RE.test(manifest.version))
    problems.push(`version must be semver (got ${JSON.stringify(manifest.version)}).`);
  checkText(problems, manifest.author, 'name', 200, true, 'author.name');

  const ui = manifest.interface;
  if (typeof ui !== 'object' || ui === null) {
    problems.push('interface is required.');
  } else {
    for (const [key, max, required] of INTERFACE_TEXT_LIMITS)
      checkText(problems, ui, key, max, required, `interface.${key}`);
    for (const [key, maxItems, maxLength] of INTERFACE_LIST_LIMITS)
      checkList(problems, ui, key, maxItems, maxLength, `interface.${key}`);
    for (const key of URL_KEYS) {
      const value = ui[key];
      if (value === undefined) problems.push(`interface.${key} is required.`);
      else if (typeof value !== 'string' || !/^https:\/\/[^\s/]+/.test(value))
        problems.push(`interface.${key} must be an https:// URL (got ${JSON.stringify(value)}).`);
    }
    if (!COLOR_RE.test(ui.brandColor ?? '')) problems.push('interface.brandColor must be #RRGGBB.');
    if (ui.brandColorDark !== undefined && !COLOR_RE.test(ui.brandColorDark))
      problems.push('interface.brandColorDark must be #RRGGBB.');
    for (const key of ASSET_KEYS) checkAsset(problems, ui, key);
  }

  const skills = resolveInPlugin(problems, manifest.skills, 'skills');
  if (skills && skills !== join(PLUGIN_ROOT, 'skills'))
    problems.push('skills must point at ./skills/ (the only skills directory packaged).');
  else if (skills && !existsSync(skills)) problems.push('skills directory does not exist.');

  const mcp = resolveInPlugin(problems, manifest.mcpServers, 'mcpServers');
  if (mcp && mcp !== join(PLUGIN_ROOT, MCP_CONFIG))
    problems.push(`mcpServers must point at ./${MCP_CONFIG} (the only MCP config packaged).`);
  else if (mcp && existsSync(mcp)) {
    const servers = readJson(mcp, problems)?.mcpServers;
    const entries = Object.entries(servers ?? {});
    if (entries.length !== 1) problems.push(`${MCP_CONFIG} must define exactly one server (found ${entries.length}).`);
    for (const [name, server] of entries) {
      if (typeof server?.url !== 'string' || !server.url.startsWith('https://'))
        problems.push(`${MCP_CONFIG} server "${name}" must have an https:// url.`);
    }
  } else if (mcp) problems.push(`${MCP_CONFIG} does not exist.`);

  if (claude) {
    for (const key of ['name', 'version', 'description']) {
      if (manifest[key] !== claude[key])
        problems.push(
          `${key} (${JSON.stringify(manifest[key])}) must equal dtwo/${CLAUDE_MANIFEST} (${JSON.stringify(claude[key])}).`,
        );
    }
  }
}

function scanForLeaks(problems, files) {
  const listing = new Set([CODEX_MANIFEST, MCP_CONFIG]);
  for (const rel of files) {
    const abs = join(PLUGIN_ROOT, rel);
    if (!existsSync(abs)) continue;
    const text = readFileSync(abs, 'latin1');
    const patterns = [...LEAK_PATTERNS_EVERYWHERE];
    if (listing.has(rel) || rel.startsWith('assets/')) patterns.push(...LEAK_PATTERNS_LISTING_ONLY);
    const lines = text.split('\n');
    for (const pattern of patterns) {
      lines.forEach((line, i) => {
        if (pattern.test(line)) problems.push(`Leak scan: ${pattern} matches dtwo/${rel}:${i + 1}`);
      });
    }
  }
}

// --- build -------------------------------------------------------------------

function stage(files, stageDir) {
  const dirs = new Set();
  for (const rel of files) {
    const dest = join(stageDir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(PLUGIN_ROOT, rel), dest);
    chmodSync(dest, FILE_MODE);
    utimesSync(dest, FIXED_TIME, FIXED_TIME);
    for (let d = dirname(rel); d !== '.'; d = dirname(d)) dirs.add(d);
  }
  // Deepest first, so setting a child's mtime does not disturb its parent's.
  for (const d of [...dirs].sort((a, b) => b.split('/').length - a.split('/').length)) {
    chmodSync(join(stageDir, d), DIR_MODE);
    utimesSync(join(stageDir, d), FIXED_TIME, FIXED_TIME);
  }
}

function build(files, outPath) {
  const work = mkdtempSync(join(tmpdir(), 'dtwo-openai-'));
  try {
    const stageDir = join(work, 'plugin');
    stage(files, stageDir);
    const tmpZip = join(work, 'plugin.zip');
    const result = spawnSync('zip', ['-q', '-X', '-D', '-nw', tmpZip, '-@'], {
      cwd: stageDir,
      input: `${files.join('\n')}\n`,
      env: { ...process.env, TZ: 'UTC' },
      encoding: 'utf8',
    });
    if (result.error) throw new Error(`Cannot run zip: ${result.error.message}`);
    if (result.status !== 0) throw new Error(`zip exited ${result.status}: ${result.stderr}`);
    mkdirSync(dirname(outPath), { recursive: true });
    rmSync(outPath, { force: true });
    try {
      renameSync(tmpZip, outPath);
    } catch {
      // Cross-device rename (temp dir on another volume).
      copyFileSync(tmpZip, outPath);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const problems = [];

  const manifest = readJson(join(PLUGIN_ROOT, CODEX_MANIFEST), problems);
  const claude = readJson(join(PLUGIN_ROOT, CLAUDE_MANIFEST), problems);
  if (manifest) checkManifest(problems, manifest, claude);
  const files = collectFiles(problems);
  scanForLeaks(problems, files);

  if (problems.length > 0) {
    console.error(`dtwo/${CODEX_MANIFEST} failed validation:`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  if (args.check) {
    console.log(`dtwo/${CODEX_MANIFEST} is valid (${files.length} files would be packaged).`);
    return;
  }

  const outPath = args.out ? resolve(args.out) : join(REPO_ROOT, 'dist', `dtwo-openai-${manifest.version}.zip`);
  try {
    build(files, outPath);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  const sha256 = createHash('sha256').update(readFileSync(outPath)).digest('hex');
  const shown = relative(process.cwd(), outPath);
  console.log(`Wrote ${shown.startsWith('..') ? outPath : shown} (${files.length} files)`);
  console.log(`SHA-256 ${sha256}`);
}

main();
