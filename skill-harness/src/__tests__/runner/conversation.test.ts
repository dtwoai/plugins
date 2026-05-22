import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Client, MessageParams } from '../../runner/client.js';
import { runConversation } from '../../runner/conversation.js';
import type { SystemBlock } from '../../runner/systemPrompt.js';

function scriptedClient(replies: string[]): Client {
  let i = 0;
  return {
    async messages(_params: MessageParams) {
      if (i >= replies.length) throw new Error(`ran out of scripted replies (asked for ${i + 1})`);
      const text = replies[i++];
      return { content: text };
    },
  };
}

const SYSTEM_BLOCKS: SystemBlock[] = [{ type: 'text', text: 'system' }];

describe('runConversation', () => {
  it('returns YAML on turn 1 when the first reply contains a fence', async () => {
    const client = scriptedClient(['Sure. ```yaml\nfoo: 1\n```']);
    const res = await runConversation({
      client,
      model: 'test',
      systemBlocks: SYSTEM_BLOCKS,
      userPrompt: 'make it',
    });
    assert.equal(res.yaml, 'foo: 1');
    assert.equal(res.askedClarifying, false);
    assert.equal(res.turns.length, 2); // 1 user + 1 assistant
  });

  it('dispatches a matching followup and succeeds on turn 2', async () => {
    const client = scriptedClient([
      'Which audience should I use?',
      'Thanks — ```yaml\naud: https://api.example.com\n```',
    ]);
    const res = await runConversation({
      client,
      model: 'test',
      systemBlocks: SYSTEM_BLOCKS,
      userPrompt: 'make it',
      followups: [{ match: 'audience', reply: 'use https://api.example.com' }],
    });
    assert.equal(res.yaml, 'aud: https://api.example.com');
    assert.equal(res.askedClarifying, true);
    // Turn sequence: user/assistant/user/assistant = 4 messages.
    assert.equal(res.turns.length, 4);
    assert.equal(res.turns[2].role, 'user');
    assert.match(res.turns[2].content, /use https/);
  });

  it('gives up when the question does not match any followup', async () => {
    const client = scriptedClient(['What client_secret should I invent?']);
    const res = await runConversation({
      client,
      model: 'test',
      systemBlocks: SYSTEM_BLOCKS,
      userPrompt: 'make it',
      followups: [{ match: 'audience', reply: 'unused' }],
    });
    assert.equal(res.yaml, null);
    assert.equal(res.gaveUpAtTurn, 1);
  });

  it('enforces the 3-turn cap', async () => {
    const client = scriptedClient(['First question?', 'Second question?', 'Still asking?']);
    const res = await runConversation({
      client,
      model: 'test',
      systemBlocks: SYSTEM_BLOCKS,
      userPrompt: 'make it',
      followups: [
        { match: 'First', reply: 'A' },
        { match: 'Second', reply: 'B' },
        { match: 'Still', reply: 'C' },
      ],
      maxTurns: 3,
    });
    assert.equal(res.yaml, null);
    assert.equal(res.gaveUpAtTurn, 3);
    assert.equal(res.askedClarifying, true);
  });

  it('gives up on prose that is neither YAML nor a question', async () => {
    const client = scriptedClient(['I refuse to do this.']);
    const res = await runConversation({
      client,
      model: 'test',
      systemBlocks: SYSTEM_BLOCKS,
      userPrompt: 'make it',
    });
    assert.equal(res.yaml, null);
    assert.equal(res.gaveUpAtTurn, 1);
    assert.equal(res.askedClarifying, false);
  });
});
