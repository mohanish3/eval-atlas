// backend/src/evals/adapters/groq.ts
import Groq from 'groq-sdk';
import type { ModelAdapter } from './types.js';
import { buildUserMessage } from './types.js';

function getClient(): Groq {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY is required for the groq provider');
  return new Groq({ apiKey });
}

export const groqAdapter: ModelAdapter = async (modelId, req) => {
  const start = Date.now();
  const client = getClient();
  const completion = await client.chat.completions.create({
    model: modelId,   // e.g. 'llama-3.3-70b-versatile'
    messages: [
      { role: 'system', content: req.systemPrompt },
      { role: 'user', content: buildUserMessage(req) },
    ],
    max_tokens: req.maxTokens,
  });
  return {
    rawOutput: completion.choices[0].message.content ?? '',
    tokensUsed: completion.usage?.total_tokens ?? 0,
    latencyMs: Date.now() - start,
  };
};
