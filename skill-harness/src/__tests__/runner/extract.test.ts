import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { extractYaml, looksLikeQuestion } from '../../runner/extract.js';

describe('extractYaml', () => {
  it('returns the body of a ```yaml fence', () => {
    const out = extractYaml('Here you go:\n```yaml\nfoo: bar\n```');
    assert.equal(out, 'foo: bar');
  });

  it('is case-insensitive on the language tag (YAML)', () => {
    const out = extractYaml('```YAML\nfoo: 1\n```');
    assert.equal(out, 'foo: 1');
  });

  it('accepts `yml` as an alias', () => {
    const out = extractYaml('```yml\nfoo: 1\n```');
    assert.equal(out, 'foo: 1');
  });

  it('picks the LAST fence when multiple are present', () => {
    const text = [
      'Intro example:',
      '```yaml',
      'example: one',
      '```',
      'Real answer:',
      '```yaml',
      'final: answer',
      '```',
    ].join('\n');
    assert.equal(extractYaml(text), 'final: answer');
  });

  it('returns null for prose without fences', () => {
    assert.equal(extractYaml('I think you want... something?'), null);
  });

  it('returns null for a fenced block with no language tag', () => {
    assert.equal(extractYaml('```\nfoo: 1\n```'), null);
  });
});

describe('looksLikeQuestion', () => {
  it('true when text ends with ?', () => {
    assert.equal(looksLikeQuestion('What audience should I use?'), true);
  });

  it('true on "I need ..." phrases', () => {
    assert.equal(looksLikeQuestion('I need the audience to proceed.'), true);
  });

  it('true on "could you specify ..." phrases', () => {
    assert.equal(looksLikeQuestion('Could you specify the issuer URL.'), true);
  });

  it('false on pure config output', () => {
    assert.equal(looksLikeQuestion('Here is your config. Done.'), false);
  });

  it('false when the ? is inside a YAML fence', () => {
    // The question-mark is just a literal in prose inside fences —
    // `looksLikeQuestion` should strip fences before checking.
    const text = '```yaml\nfoo: "what?"\n```';
    assert.equal(looksLikeQuestion(text), false);
  });
});
