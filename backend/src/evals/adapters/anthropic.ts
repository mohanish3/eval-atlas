// backend/src/evals/adapters/anthropic.ts
import Anthropic from '@anthropic-ai/sdk';
import type { ModelAdapter } from './types.js';
import { buildUserMessage } from './types.js';

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required for the anthropic provider');
  return new Anthropic({ apiKey });
}

export const anthropicAdapter: ModelAdapter = async (modelId, req) => {
  const start = Date.now();
  const client = getClient();
  const msg = await client.messages.create({
    model: modelId,
    max_tokens: req.maxTokens,
    system: req.systemPrompt,   // top-level field, NOT in messages array
    messages: [{ role: 'user', content: buildUserMessage(req) }],
  });
  const rawOutput = msg.content[0].type === 'text' ? msg.content[0].text : '';
  const tokensUsed = msg.usage.input_tokens + msg.usage.output_tokens;
  return { rawOutput, tokensUsed, latencyMs: Date.now() - start };
};
