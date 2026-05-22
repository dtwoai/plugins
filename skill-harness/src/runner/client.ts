/**
 * Minimal Anthropic client shim.
 *
 * The runner code needs a narrow surface: "send a message, get the text
 * back". We define `Client` as the contract and provide
 * `createAnthropicClient` as the real implementation backed by
 * `@anthropic-ai/sdk`. Tests inject a fake `Client` instead — this keeps
 * the runner unit-testable without an API key.
 *
 * Extraction rule: we take the first `text`-typed content block from the
 * SDK response. Tool-use and other block kinds are intentionally ignored
 * — Phase 3 does not use tool use (per the plan's §"Architectural
 * commitments").
 */

import Anthropic from '@anthropic-ai/sdk';

import type { CapturedCall } from './mcpStub.js';
import type { SystemBlock } from './systemPrompt.js';

export type MessageParams = {
  model: string;
  system: SystemBlock[];
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  temperature: number;
  max_tokens: number;
};

/**
 * Result of a single `messages()` call.
 *
 * `captures` is only populated by providers that front an MCP stub
 * (currently `createCliClient`). Other providers MAY include it as an
 * empty array; consumers should treat "absent" and "empty" as the same
 * "no MCP tool calls observed."
 */
export type MessageResult = {
  content: string;
  captures?: CapturedCall[];
};

export type Client = {
  messages(params: MessageParams): Promise<MessageResult>;
};

export function createAnthropicClient(opts?: { apiKey?: string }): Client {
  const apiKey = opts?.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set — pass `apiKey` or set the env var before creating a client.');
  }
  const sdk = new Anthropic({ apiKey });

  return {
    async messages(params) {
      const response = await sdk.messages.create({
        model: params.model,
        system: params.system,
        messages: params.messages,
        temperature: params.temperature,
        max_tokens: params.max_tokens,
      });
      const firstText = response.content.find(block => block.type === 'text');
      const text = firstText && firstText.type === 'text' ? firstText.text : '';
      return { content: text };
    },
  };
}

export { type CliClientOptions, createCliClient } from './cliClient.js';
