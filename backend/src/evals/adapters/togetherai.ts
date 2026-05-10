// backend/src/evals/adapters/togetherai.ts
import Together from 'together-ai';
import type { ModelAdapter } from './types.js';
import { buildUserMessage } from './types.js';

function getClient(): Together {
  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) throw new Error('TOGETHER_API_KEY is required for the togetherai provider');
  return new Together({ apiKey });
}

export const togetherAdapter: ModelAdapter = async (modelId, req) => {
  const start = Date.now();
  const client = getClient();
  const completion = await client.chat.completions.create({
    model: modelId,   // e.g. 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo'
    messages: [
      { role: 'system', content: req.systemPrompt },
      { role: 'user', content: buildUserMessage(req) },
    ],
    max_tokens: req.maxTokens,
  });
  return {
    rawOutput: completion.choices?.[0]?.message?.content ?? '',
    tokensUsed: (completion.usage as any)?.total_tokens ?? 0,
    latencyMs: Date.now() - start,
  };
};
