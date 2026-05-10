// backend/src/evals/adapters/openai.ts
import OpenAI from 'openai';
import type { ModelAdapter } from './types.js';
import { buildUserMessage } from './types.js';

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for the openai provider');
  return new OpenAI({ apiKey });
}

// Models that require max_completion_tokens instead of max_tokens
const USES_COMPLETION_TOKENS = /^(o1|o3|o4|gpt-5)/;

export const openaiAdapter: ModelAdapter = async (modelId, req) => {
  const start = Date.now();
  const client = getClient();
  const tokenParam = USES_COMPLETION_TOKENS.test(modelId)
    ? { max_completion_tokens: req.maxTokens }
    : { max_tokens: req.maxTokens };

  try {
    const completion = await client.chat.completions.create({
      model: modelId,
      messages: [
        { role: 'system', content: req.systemPrompt },
        { role: 'user', content: buildUserMessage(req) },
      ],
      ...tokenParam,
    });
    return {
      rawOutput: completion.choices[0].message.content ?? '',
      tokensUsed: completion.usage?.total_tokens ?? 0,
      latencyMs: Date.now() - start,
    };
  } catch (err: any) {
    // Base/instruct models don't support the chat endpoint — fall back to v1/completions
    if (err?.status === 404 && err?.error?.message?.includes('not a chat model')) {
      const prompt = req.systemPrompt
        ? `${req.systemPrompt}\n\n${buildUserMessage(req)}`
        : buildUserMessage(req);
      const completion = await client.completions.create({
        model: modelId,
        prompt,
        max_tokens: req.maxTokens,
      });
      return {
        rawOutput: completion.choices[0].text ?? '',
        tokensUsed: completion.usage?.total_tokens ?? 0,
        latencyMs: Date.now() - start,
      };
    }
    throw err;
  }
};
