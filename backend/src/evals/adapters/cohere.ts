// backend/src/evals/adapters/cohere.ts
import { CohereClientV2 } from 'cohere-ai';
import type { ModelAdapter } from './types.js';
import { buildUserMessage } from './types.js';

function getClient(): CohereClientV2 {
  const token = process.env.COHERE_API_KEY;
  if (!token) throw new Error('COHERE_API_KEY is required for the cohere provider');
  return new CohereClientV2({ token });
}

export const cohereAdapter: ModelAdapter = async (modelId, req) => {
  const start = Date.now();
  const client = getClient();
  const result = await client.chat({
    model: modelId,   // e.g. 'command-a-03-2025'
    messages: [
      { role: 'system', content: req.systemPrompt },
      { role: 'user', content: buildUserMessage(req) },
    ],
  });
  const rawOutput = (result.message?.content?.[0] as any)?.text ?? '';
  // TODO: verify exact token field path from CohereClientV2 TypeScript types at runtime.
  // The field may be result.usage?.tokens?.inputTokens + outputTokens or similar.
  const tokensUsed = 0;
  return { rawOutput, tokensUsed, latencyMs: Date.now() - start };
};
