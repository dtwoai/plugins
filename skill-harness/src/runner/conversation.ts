/**
 * Single-prompt conversation driver.
 *
 * The plan (§"Clarifying-question handling") specifies the contract:
 *
 *   1. Send the user prompt, get an assistant reply.
 *   2. If the reply contains a YAML fence, done.
 *   3. If the reply looks like a clarifying question, find the first
 *      `followups[].match` regex that fires and dispatch its canned reply
 *      as the next user message.
 *   4. If no followup matches, give up — `yaml: null, gaveUpAtTurn`.
 *   5. Cap at `maxTurns = 3`.
 *
 * `askedClarifying` is sticky: once a turn yields a question that gets a
 * followup, the flag stays true for the rest of the conversation so
 * fixture-level "clarifying_question_expected" checks can use it.
 *
 * Temperature default here is 0.2 — the plan's chosen value for N-run
 * aggregation. Callers can override (e.g. the CLI's `--temperature`).
 */

import type { Client } from './client.js';
import { extractYaml, looksLikeQuestion } from './extract.js';
import type { CapturedCall } from './mcpStub.js';
import type { SystemBlock } from './systemPrompt.js';

export type Turn = { role: 'user' | 'assistant'; content: string };

export type Followup = { match: string; reply: string };

export type ConversationResult = {
  yaml: string | null;
  turns: Turn[];
  askedClarifying: boolean;
  gaveUpAtTurn?: number;
  /**
   * All MCP tool calls observed across the whole conversation, in
   * order. Empty when the backing client has no MCP stub (e.g. the
   * Anthropic SDK path or unit-test doubles).
   */
  captures: CapturedCall[];
};

export async function runConversation(params: {
  client: Client;
  model: string;
  systemBlocks: SystemBlock[];
  userPrompt: string;
  followups?: Followup[];
  maxTurns?: number;
  temperature?: number;
  maxTokens?: number;
}): Promise<ConversationResult> {
  const maxTurns = params.maxTurns ?? 3;
  const temperature = params.temperature ?? 0.2;
  const maxTokens = params.maxTokens ?? 4096;
  const followups = params.followups ?? [];

  const turns: Turn[] = [];
  const captures: CapturedCall[] = [];
  let askedClarifying = false;

  // Seed with the user prompt.
  turns.push({ role: 'user', content: params.userPrompt });

  for (let turn = 1; turn <= maxTurns; turn++) {
    const response = await params.client.messages({
      model: params.model,
      system: params.systemBlocks,
      messages: turns.map(t => ({ role: t.role, content: t.content })),
      temperature,
      max_tokens: maxTokens,
    });
    const reply = response.content;
    if (response.captures && response.captures.length > 0) {
      captures.push(...response.captures);
    }
    turns.push({ role: 'assistant', content: reply });

    const yaml = extractYaml(reply);
    if (yaml !== null) {
      return { yaml, turns, askedClarifying, captures };
    }

    if (!looksLikeQuestion(reply)) {
      // Prose without YAML and without a question shape — give up. The
      // skill either refused or rambled; we don't invent a followup.
      return { yaml: null, turns, askedClarifying, gaveUpAtTurn: turn, captures };
    }

    // Find a followup whose `match` regex (used as a pattern, not anchored)
    // fires against the reply. `followups` is iterated in order so fixture
    // authors can encode precedence.
    const followup = followups.find(f => {
      try {
        return new RegExp(f.match, 'i').test(reply);
      } catch {
        return false;
      }
    });
    if (!followup) {
      return { yaml: null, turns, askedClarifying, gaveUpAtTurn: turn, captures };
    }

    askedClarifying = true;
    if (turn === maxTurns) {
      // No room for another assistant reply — cap reached.
      return { yaml: null, turns, askedClarifying, gaveUpAtTurn: turn, captures };
    }
    turns.push({ role: 'user', content: followup.reply });
  }

  // Defensive: loop should always return inside the body.
  return { yaml: null, turns, askedClarifying, gaveUpAtTurn: maxTurns, captures };
}
