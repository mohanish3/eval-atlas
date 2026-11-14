// backend/src/evals/cost.ts
//
// Curated per-model API pricing table and cost-estimation helpers.
//
// The backend persists a single `tokens_used` number per result (no
// input/output split), so the estimate applies a BLENDED rate: the
// average of the input and output per-1M rates, expressed per single token.
//
// Prices are estimates from public list prices as of the table's last
// update. Edit this file to keep rates current; every consumer labels
// its output "estimated".

import type { EvalResult } from '../shared/evalTypes.js';

// ─── Price types ─────────────────────────────────────────────────────────────

export interface ModelPrice {
  modelId: string;
  /** USD per 1M input tokens */
  inputPer1M: number;
  /** USD per 1M output tokens */
  outputPer1M: number;
}

// ─── Curated price table ─────────────────────────────────────────────────────
// Add or update entries here as provider pricing changes.
// Rates are in USD per 1M tokens.

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Look up the price for a model. Returns null if the model is not in the
 * table (including empty strings).
 */
export function getModelPrice(modelId: string): ModelPrice | null {
  if (!modelId) return null;
  return MODEL_PRICES[modelId] ?? null;
}

/**
 * Compute the blended per-token rate from a ModelPrice.
 * The backend tracks a single tokens_used figure (no input/output split),
 * so we average the two per-1M rates and divide by 1M to get a per-token rate.
 */
export function blendedRatePerToken(price: ModelPrice): number {
  return (price.inputPer1M + price.outputPer1M) / 2 / 1_000_000;
}

/**
 * Estimate the total API cost (USD) for a given model across a set of results.
 *
 * - Sums `tokens_used` for results belonging to `modelId`.
 * - Skips results where `tokens_used` is null.
 * - Returns 0 for a known model with no (or all-null) results.
 * - Returns null if the model is not in the price table.
 */
export function estimateModelCost(results: EvalResult[], modelId: string): number | null {
  const price = getModelPrice(modelId);
  if (!price) return null;

  const totalTokens = results
    .filter((r) => r.model_id === modelId)
    .reduce((sum, r) => sum + (r.tokens_used ?? 0), 0);

  return totalTokens * blendedRatePerToken(price);
}
