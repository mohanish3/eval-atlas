// backend/src/evals/__tests__/cost.test.ts
//
// Write-first tests for the new "Estimated API cost per model" feature.
//
// The module under test (backend/src/evals/cost.ts) does NOT exist yet.
// We load it LAZILY via a non-literal dynamic import() so this file still
// compiles and the suite runs (a static `import ... from '../cost.js'`
// would make the whole suite fail to load, registering 0 tests). While the
// module is missing, the import rejects, `loadError` is set, and every test
// fails on the `expect(loadError).toBeNull()` guard — a real, assertive red.
// Once cost.ts is implemented, the guard passes and the behavioral
// assertions below run for real.
//
// The backend tracks a single `tokens_used` per result (no input/output
// split), so the estimate applies a BLENDED rate: the average of the
// input and output per-1M rates, expressed per single token.

import type { EvalResult } from '../../shared/evalTypes.js';

// The loaded module (or a shape-compatible stand-in once implemented).
interface CostModule {
  getModelPrice: (modelId: string) => ModelPrice | null;
  blendedRatePerToken: (price: ModelPrice) => number;
  estimateModelCost: (results: EvalResult[], modelId: string) => number | null;
  MODEL_PRICES: Record<string, ModelPrice>;
}

interface ModelPrice {
  modelId: string;
  inputPer1M: number;
  outputPer1M: number;
}

let cost: CostModule | undefined;
let loadError: Error | null = null;

beforeAll(async () => {
  // Non-literal specifier so TypeScript does not try to resolve it at
  // compile time; jest resolves it at runtime (or throws if it is missing).
  const specifier = '../cost.js';
  try {
    cost = (await import(specifier)) as CostModule;
  } catch (err) {
    loadError = err as Error;
  }
});

// ─── helpers ────────────────────────────────────────────────────────────────

function result(overrides: Partial<EvalResult> & Pick<EvalResult, 'model_id'>): EvalResult {
  return {
    id: 'r1',
    run_id: 'run1',
    question_id: 'q1',
    category: null,
    model_output: null,
    correct_answer: null,
    is_correct: null,
    error_type: null,
    latency_ms: null,
    tokens_used: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ─── price-table lookup ─────────────────────────────────────────────────────

describe('getModelPrice — table lookup', () => {
  test('returns the known price for a model present in the table', () => {
    expect(loadError).toBeNull();
    const price = cost!.getModelPrice('gpt-4o');
    expect(price).not.toBeNull();
    expect(price!.inputPer1M).toBeGreaterThan(0);
    expect(price!.outputPer1M).toBeGreaterThan(0);
  });

  test('prices are consistent with the MODEL_PRICES table export', () => {
    expect(loadError).toBeNull();
    for (const [modelId, price] of Object.entries(cost!.MODEL_PRICES)) {
      expect(cost!.getModelPrice(modelId)).toEqual(price);
    }
    expect(Object.keys(cost!.MODEL_PRICES).length).toBeGreaterThan(0);
  });

  test('a known Claude model is in the table with sane rates', () => {
    expect(loadError).toBeNull();
    const price = cost!.getModelPrice('claude-sonnet-4-6');
    expect(price).not.toBeNull();
    expect(price!.inputPer1M).toBeGreaterThan(0);
    expect(price!.outputPer1M).toBeGreaterThan(0);
  });
});

describe('getModelPrice — unknown model', () => {
  test('returns null for a model not in the table', () => {
    expect(loadError).toBeNull();
    expect(cost!.getModelPrice('totally-unknown-model-xyz')).toBeNull();
  });

  test('returns null for an empty string', () => {
    expect(loadError).toBeNull();
    expect(cost!.getModelPrice('')).toBeNull();
  });
});

// ─── blended rate ───────────────────────────────────────────────────────────

describe('blendedRatePerToken', () => {
  test('averages the input and output per-1M rates, per single token', () => {
    expect(loadError).toBeNull();
    const price: ModelPrice = { modelId: 'm', inputPer1M: 10, outputPer1M: 30 };
    // (10 + 30) / 2 / 1_000_000
    expect(cost!.blendedRatePerToken(price)).toBeCloseTo(40 / 2 / 1_000_000, 12);
  });

  test('equal input/output rates equal that rate per 1M tokens', () => {
    expect(loadError).toBeNull();
    const price: ModelPrice = { modelId: 'm', inputPer1M: 5, outputPer1M: 5 };
    expect(cost!.blendedRatePerToken(price)).toBeCloseTo(5 / 1_000_000, 12);
  });
});

// ─── total cost aggregation ─────────────────────────────────────────────────

describe('estimateModelCost — aggregation', () => {
  test('sums tokens_used across the model results and applies the blended rate', () => {
    expect(loadError).toBeNull();
    const results: EvalResult[] = [
      result({ model_id: 'gpt-4o', tokens_used: 1000 }),
      result({ model_id: 'gpt-4o', tokens_used: 2000 }),
      result({ model_id: 'gpt-4o', tokens_used: 3000 }),
    ];
    const price = cost!.getModelPrice('gpt-4o')!;
    const expected = 6000 * cost!.blendedRatePerToken(price);
    expect(cost!.estimateModelCost(results, 'gpt-4o')).toBeCloseTo(expected, 8);
  });

  test('only aggregates results belonging to the requested model', () => {
    expect(loadError).toBeNull();
    const results: EvalResult[] = [
      result({ model_id: 'gpt-4o', tokens_used: 1000 }),
      result({ model_id: 'claude-sonnet-4-6', tokens_used: 9999 }),
      result({ model_id: 'gpt-4o', tokens_used: 1000 }),
    ];
    const price = cost!.getModelPrice('gpt-4o')!;
    const expected = 2000 * cost!.blendedRatePerToken(price);
    expect(cost!.estimateModelCost(results, 'gpt-4o')).toBeCloseTo(expected, 8);
  });

  test('ignores null tokens_used values (skips them, no NaN)', () => {
    expect(loadError).toBeNull();
    const results: EvalResult[] = [
      result({ model_id: 'gpt-4o', tokens_used: 1000 }),
      result({ model_id: 'gpt-4o', tokens_used: null }),
      result({ model_id: 'gpt-4o' }), // default null
    ];
    const price = cost!.getModelPrice('gpt-4o')!;
    const expected = 1000 * cost!.blendedRatePerToken(price);
    const total = cost!.estimateModelCost(results, 'gpt-4o');
    expect(total).not.toBeNull();
    expect(total).toBeCloseTo(expected, 8);
    expect(Number.isNaN(total!)).toBe(false);
  });

  test('returns 0 for a known model with no results', () => {
    expect(loadError).toBeNull();
    expect(cost!.estimateModelCost([], 'gpt-4o')).toBe(0);
  });

  test('returns 0 for a known model whose results all have null tokens', () => {
    expect(loadError).toBeNull();
    const results: EvalResult[] = [result({ model_id: 'gpt-4o', tokens_used: null })];
    expect(cost!.estimateModelCost(results, 'gpt-4o')).toBe(0);
  });
});

describe('estimateModelCost — unknown model', () => {
  test('returns null when the model is not in the price table', () => {
    expect(loadError).toBeNull();
    const results: EvalResult[] = [
      result({ model_id: 'totally-unknown-model-xyz', tokens_used: 1000 }),
    ];
    expect(cost!.estimateModelCost(results, 'totally-unknown-model-xyz')).toBeNull();
  });

  test('returns null for an unknown model even with results present', () => {
    expect(loadError).toBeNull();
    const results: EvalResult[] = [
      result({ model_id: 'nope', tokens_used: 500 }),
      result({ model_id: 'nope', tokens_used: 500 }),
    ];
    expect(cost!.estimateModelCost(results, 'nope')).toBeNull();
  });
});
