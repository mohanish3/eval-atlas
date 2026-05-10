// backend/src/evals/adapters/local.ts
import type { ModelAdapter } from './types.js';
import { buildUserMessage } from './types.js';

const AGENT_URL = process.env.AGENT_URL ?? 'http://localhost:3001';

export const localAdapter: ModelAdapter = async (modelId, req) => {
  const start = Date.now();
  console.log(`[local adapter] Sending question to agent_server.py (model: ${modelId})`);

  const controller = new AbortController();
  // 120s timeout: first request per model triggers GGUF load (can take up to 60s)
  const timeoutId = setTimeout(() => controller.abort(), 120_000);

  let body: any;
  try {
    const response = await fetch(`${AGENT_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: 'system', content: req.systemPrompt },
          { role: 'user', content: buildUserMessage(req) },
        ],
        max_tokens: req.maxTokens,
      }),
      signal: controller.signal,
    });
    body = await response.json();
  } finally {
    clearTimeout(timeoutId);
  }

  const rawOutput = body.choices?.[0]?.message?.content ?? '';
  const tokensUsed = body.usage?.total_tokens ?? 0;
  return { rawOutput, tokensUsed, latencyMs: Date.now() - start };
};
