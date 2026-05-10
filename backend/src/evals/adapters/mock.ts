// backend/src/evals/adapters/mock.ts
import type { ModelAdapter } from './types.js';

export const mockAdapter: ModelAdapter = async (_modelId, req) => {
  const start = Date.now();
  // Simulate network latency
  await new Promise((resolve) => setTimeout(resolve, 500));

  let rawOutput = '';
  if (req.choices) {
    // Return a random choice key (A, B, C, or D) for multiple choice
    const keys = Object.keys(req.choices);
    rawOutput = keys[Math.floor(Math.random() * keys.length)];
  } else {
    rawOutput = `Mock response for: ${req.question.substring(0, 20)}...`;
  }

  return {
    rawOutput,
    tokensUsed: 10,
    latencyMs: Date.now() - start,
  };
};
