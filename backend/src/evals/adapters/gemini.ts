// backend/src/evals/adapters/gemini.ts
import { GoogleGenAI } from '@google/genai';
import type { ModelAdapter } from './types.js';
import { buildUserMessage } from './types.js';

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is required for the gemini provider');
  return new GoogleGenAI({ apiKey });
}

// Gemini 3+ are thinking models — disable thinking for evals (we want direct answers)
const IS_THINKING_MODEL = /^gemini-[3-9]|^gemini-2\.5-pro/;

export const geminiAdapter: ModelAdapter = async (modelId, req) => {
  const start = Date.now();
  const client = getClient();
  const result = await client.models.generateContent({
    model: modelId,
    contents: buildUserMessage(req),
    config: {
      systemInstruction: req.systemPrompt,
      maxOutputTokens: req.maxTokens,
      ...(IS_THINKING_MODEL.test(modelId) && { thinkingConfig: { thinkingBudget: 0 } }),
    },
  });
  // Extract text robustly: filter out thought parts for thinking models
  const rawOutput =
    result.candidates?.[0]?.content?.parts
      ?.filter((p: any) => !p.thought)
      ?.map((p: any) => p.text ?? '')
      ?.join('') ||
    result.text ||
    '';
  const tokensUsed = result.usageMetadata?.totalTokenCount ?? 0;
  return { rawOutput, tokensUsed, latencyMs: Date.now() - start };
};
