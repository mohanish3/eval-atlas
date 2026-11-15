// frontend/src/lib/modelPricing.ts
//
// Client-side copy of the curated model pricing table.
// Mirrors backend/src/evals/cost.ts for the dashboard UI.
// Prices are estimates (USD per 1M tokens). Edit both files together.

export interface ModelPrice {
  modelId: string;
  inputPer1M: number;
  outputPer1M: number;
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
  // OpenAI
  'gpt-4o': { modelId: 'gpt-4o', inputPer1M: 2.50, outputPer1M: 10.00 },
  'gpt-4o-mini': { modelId: 'gpt-4o-mini', inputPer1M: 0.15, outputPer1M: 0.60 },
  'o1': { modelId: 'o1', inputPer1M: 15.00, outputPer1M: 60.00 },

  // Anthropic
  'claude-sonnet-4-6': { modelId: 'claude-sonnet-4-6', inputPer1M: 3.00, outputPer1M: 15.00 },
  'claude-opus-4-6': { modelId: 'claude-opus-4-6', inputPer1M: 15.00, outputPer1M: 75.00 },
  'claude-haiku-4-5-20251001': { modelId: 'claude-haiku-4-5-20251001', inputPer1M: 1.00, outputPer1M: 5.00 },
  'claude-3-5-sonnet-20241022': { modelId: 'claude-3-5-sonnet-20241022', inputPer1M: 3.00, outputPer1M: 15.00 },
  'claude-3-5-haiku-20241022': { modelId: 'claude-3-5-haiku-20241022', inputPer1M: 0.80, outputPer1M: 4.00 },

  // Google
  'gemini-2.5-flash': { modelId: 'gemini-2.5-flash', inputPer1M: 0.15, outputPer1M: 0.60 },

  // Groq (open-weight)
  'llama-3.3-70b-versatile': { modelId: 'llama-3.3-70b-versatile', inputPer1M: 0.40, outputPer1M: 0.40 },

  // Mistral
  'mistral-large-latest': { modelId: 'mistral-large-latest', inputPer1M: 2.00, outputPer1M: 6.00 },

  // Cohere
  'command-a-03-2025': { modelId: 'command-a-03-2025', inputPer1M: 2.50, outputPer1M: 10.00 },
};

export function getModelPrice(modelId: string): ModelPrice | null {
  if (!modelId) return null;
  return MODEL_PRICES[modelId] ?? null;
}

export function blendedRatePerToken(price: ModelPrice): number {
  return (price.inputPer1M + price.outputPer1M) / 2 / 1_000_000;
}

export function estimateCost(tokens: number | null, modelId: string): number | null {
  const price = getModelPrice(modelId);
  if (!price) return null;
  if (tokens == null) return 0;
  return tokens * blendedRatePerToken(price);
}

/**
 * Format a USD amount for display. Uses compact notation for small values.
 */
export function formatCost(usd: number | null): string {
  if (usd == null) return '\u2014';
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}
