// backend/src/evals/__tests__/promptResearchRunner.test.ts
//
// Regression test for splitEvalSet() in promptResearchRunner.ts.
//
// BUG (reproduced here): splitEvalSet(items) computes
//   holdoutCount = Math.max(1, Math.round(items.length * 0.2))
// with no guard for tiny sets. For a 1-item eval set with holdout enabled
// (the UI default), this yields holdoutCount = 1, so
//   search = items.slice(0, 0) = []
// i.e. an empty search pool. The baseline trial and every optimization trial
// then run against 0 items, accuracy is always 0, and the run produces a
// meaningless "best" prompt.
//
// This diverges from the canonical budget helper
// researchBudget.splitSearchHoldoutCount, which already guards
//   `if (!holdoutEnabled || itemCount <= 1) return { searchCount: itemCount, holdoutCount: 0 }`
// so the token-budget estimate and the actual trial execution disagreed.
//
// FIX (applied in the implementation phase): add a guard at the top of
// splitEvalSet mirroring the canonical helper,
//   `if (items.length <= 1) return { search: items, holdout: [] };`
// and add the `export` keyword so the helper can be imported by tests.
//
// The runner module imports `uuid` (ESM-only) and a set of provider adapters.
// We stub `uuid` so the module loads under ts-jest's CommonJS transform; the
// rest of the module graph (openai = CommonJS, adapters, store) loads normally.
// splitEvalSet itself is pure and has no dependencies, so it is fully testable
// once the module is importable.

jest.mock('uuid', () => ({
  v4: jest.fn(() => '00000000-0000-0000-0000-000000000000'),
}));

import * as runnerModule from '../promptResearchRunner.js';
import type { EvalItem } from '../../shared/evalTypes.js';

// splitEvalSet is exported as part of the fix; on the current (unfixed) code
// it is module-local, so this is `undefined` and the first test fails.
const splitEvalSet = (runnerModule as Record<string, unknown>).splitEvalSet as
  | ((items: EvalItem[]) => { search: EvalItem[]; holdout: EvalItem[] })
  | undefined;

function makeItem(id: string): EvalItem {
  return {
    id,
    question: `Question ${id}?`,
    type: 'multiple_choice',
    choices: { A: 'opt1', B: 'opt2', C: 'opt3', D: 'opt4' },
    correct_answer: 'A',
  };
}

describe('splitEvalSet — guard against tiny eval sets', () => {
  test('module exports splitEvalSet as a function', () => {
    expect(typeof splitEvalSet).toBe('function');
  });

  test('1-item set keeps its item in search with empty holdout', () => {
    const items = [makeItem('only')];
    const { search, holdout } = splitEvalSet!(items);
    expect(search).toHaveLength(1);
    expect(holdout).toHaveLength(0);
    expect(search[0].id).toBe('only');
  });

  test('0-item set returns empty search and empty holdout', () => {
    const { search, holdout } = splitEvalSet!([]);
    expect(search).toHaveLength(0);
    expect(holdout).toHaveLength(0);
  });

  test('5-item set splits 4 search / 1 holdout', () => {
    const items = [makeItem('a'), makeItem('b'), makeItem('c'), makeItem('d'), makeItem('e')];
    const { search, holdout } = splitEvalSet!(items);
    expect(search).toHaveLength(4);
    expect(holdout).toHaveLength(1);
    // The last item becomes the single holdout item.
    expect(holdout[0].id).toBe('e');
  });

  test('10-item set splits 8 search / 2 holdout', () => {
    const items = Array.from({ length: 10 }, (_, i) => makeItem(`q${i}`));
    const { search, holdout } = splitEvalSet!(items);
    expect(search).toHaveLength(8);
    expect(holdout).toHaveLength(2);
  });

  test('search + holdout cover every item exactly once (no dup, no loss)', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    const items = ids.map(makeItem);
    const { search, holdout } = splitEvalSet!(items);
    const covered = [...search, ...holdout].map((i) => i.id).sort();
    expect(covered).toEqual([...ids].sort());
    // No item appears in both partitions.
    const searchIds = new Set(search.map((i) => i.id));
    for (const h of holdout) {
      expect(searchIds.has(h.id)).toBe(false);
    }
  });
});
