// backend/src/evals/adapters/mistral.ts
import { Mistral } from '@mistralai/mistralai';
import type { ModelAdapter } from './types.js';
import { buildUserMessage } from './types.js';

function getClient(): Mistral {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) throw new Error('MISTRAL_API_KEY is required for the mistral provider');
  return new Mistral({ apiKey });
}

export const mistralAdapter: ModelAdapter = async (modelId, req) => {
  const start = Date.now();
  const client = getClient();
  const result = await client.chat.complete({
    model: modelId,   // e.g. 'mistral-large-latest'
    messages: [
      { role: 'system', content: req.systemPrompt },
      { role: 'user', content: buildUserMessage(req) },
    ],
    maxTokens: req.maxTokens,
  });
  const rawOutput = result.choices?.[0]?.message?.content ?? '';
  // result.usage?.totalTokens is the field; fall back to 0 if missing
  const tokensUsed = (result.usage as any)?.totalTokens ?? 0;
  return { rawOutput: typeof rawOutput === 'string' ? rawOutput : '', tokensUsed, latencyMs: Date.now() - start };
};
