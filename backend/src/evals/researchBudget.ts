import type { ModelSpec } from '../shared/evalTypes.js';

export const LOCAL_RESEARCH_PROVIDERS = new Set(['local', 'ollama', 'mock']);

const BUDGET_FLOOR = 100_000;
const BUDGET_CEILING = 2_000_000;
const AVG_INPUT_TOKENS_PER_ITEM = 400;
const RESEARCH_CALL_TOKEN_ESTIMATE = 3_000;

export function isHostedProvider(provider: string): boolean {
  return !LOCAL_RESEARCH_PROVIDERS.has(provider);
}

export function splitSearchHoldoutCount(itemCount: number, holdoutEnabled: boolean): {
  searchCount: number;
  holdoutCount: number;
} {
  if (!holdoutEnabled || itemCount <= 1) {
    return { searchCount: itemCount, holdoutCount: 0 };
  }
  const holdoutCount = Math.max(1, Math.round(itemCount * 0.2));
  return { searchCount: itemCount - holdoutCount, holdoutCount };
}

/**
 * Estimate a run budget from config. Uses generous per-item input + max output,
 * all planned target trials, holdout pass, and research-model calls.
 */
export function estimateDefaultTokenBudget(params: {
  evalItemCount: number;
  maxIterations: number;
  candidateCountPerIteration: number;
  maxTokens: number;
  holdoutEnabled: boolean;
  targetModel: ModelSpec;
  researchModel: ModelSpec;
}): number {
  const { searchCount, holdoutCount } = splitSearchHoldoutCount(
    params.evalItemCount,
    params.holdoutEnabled
  );

  const tokensPerItem = AVG_INPUT_TOKENS_PER_ITEM + params.maxTokens;
  const targetTrials = 1 + params.maxIterations * params.candidateCountPerIteration;

  let estimate = 0;

  if (isHostedProvider(params.targetModel.provider)) {
    estimate += targetTrials * searchCount * tokensPerItem;
    if (holdoutCount > 0) {
      estimate += holdoutCount * tokensPerItem;
    }
  }

  if (isHostedProvider(params.researchModel.provider)) {
    estimate += params.maxIterations * RESEARCH_CALL_TOKEN_ESTIMATE;
  }

  const envDefault = Number(process.env.RESEARCH_MAX_TOKEN_BUDGET_DEFAULT);
  const padded = Math.ceil(estimate * 1.25);
  const withFloor = Math.max(BUDGET_FLOOR, padded);

  if (Number.isFinite(envDefault) && envDefault > 0) {
    return Math.min(BUDGET_CEILING, Math.max(withFloor, envDefault));
  }

  return Math.min(BUDGET_CEILING, withFloor);
}

export function resolveMaxTokenBudget(params: {
  requested: number | null | undefined;
  evalItemCount: number;
  maxIterations: number;
  candidateCountPerIteration: number;
  maxTokens: number;
  holdoutEnabled: boolean;
  targetModel: ModelSpec;
  researchModel: ModelSpec;
}): number | null {
  const hosted =
    isHostedProvider(params.targetModel.provider) ||
    isHostedProvider(params.researchModel.provider);

  if (!hosted) {
    return params.requested ?? null;
  }

  if (params.requested != null) {
    return Math.min(BUDGET_CEILING, Math.max(BUDGET_FLOOR, params.requested));
  }

  return estimateDefaultTokenBudget(params);
}
