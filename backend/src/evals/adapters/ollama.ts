// backend/src/evals/adapters/ollama.ts
// Adapter for a locally-running Ollama instance.
// Ollama exposes an OpenAI-compatible /v1/chat/completions endpoint when run with
//   OLLAMA_ORIGINS='*' ollama serve
// Configure the URL via OLLAMA_URL env var (defaults to http://localhost:11434).

import type { ModelAdapter } from './types.js';
import { buildUserMessage } from './types.js';

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434';

export const ollamaAdapter: ModelAdapter = async (modelId, req) => {
  const start = Date.now();
  console.log(`[ollama adapter] Sending request to ${OLLAMA_URL} (model: ${modelId})`);

  const controller = new AbortController();
  // 120s timeout: first request may trigger model load from disk
  const timeoutId = setTimeout(() => controller.abort(), 120_000);

  let body: any;
  try {
    const response = await fetch(`${OLLAMA_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: 'system', content: req.systemPrompt },
          { role: 'user', content: buildUserMessage(req) },
        ],
        max_tokens: req.maxTokens,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Ollama HTTP ${response.status}: ${text}`);
    }

    body = await response.json();
  } finally {
    clearTimeout(timeoutId);
  }

  const rawOutput = body.choices?.[0]?.message?.content ?? '';
  const tokensUsed = body.usage?.total_tokens ?? 0;
  return { rawOutput, tokensUsed, latencyMs: Date.now() - start };
};
