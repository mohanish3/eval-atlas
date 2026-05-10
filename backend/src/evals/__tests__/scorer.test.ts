// backend/src/evals/__tests__/scorer.test.ts
import { scoreAnswer } from '../scorer.js';
import type { EvalItem } from '../../shared/evalTypes.js';

function mc(correct_answer: string): EvalItem {
  return {
    id: 'q1', question: 'Q?', type: 'multiple_choice',
    choices: { A: 'opt1', B: 'opt2', C: 'opt3', D: 'opt4' },
    correct_answer,
  };
}

function oe(correct_answer: string, match_type: EvalItem['match_type'] = 'contains'): EvalItem {
  return { id: 'q2', question: 'Q?', type: 'open_ended', correct_answer, match_type };
}

describe('scoreAnswer — multiple choice', () => {
  test('bare correct letter scores true', () => {
    expect(scoreAnswer(mc('B'), 'B')).toBe(true);
  });
  test('lowercase correct letter scores true', () => {
    expect(scoreAnswer(mc('B'), 'b')).toBe(true);
  });
  test('letter at start with explanation scores true', () => {
    expect(scoreAnswer(mc('B'), 'B. User stories describe the what/why')).toBe(true);
  });
  test('wrong letter scores false', () => {
    expect(scoreAnswer(mc('B'), 'A')).toBe(false);
  });
  test('letter in prose anywhere (fallback) scores true', () => {
    expect(scoreAnswer(mc('C'), 'The answer is C because...')).toBe(true);
  });
  test('no letter at all scores false', () => {
    expect(scoreAnswer(mc('A'), 'I do not know')).toBe(false);
  });
});

describe('scoreAnswer — open ended', () => {
  test('contains match: substring present scores true', () => {
    expect(scoreAnswer(oe('acceptance criteria'), 'User stories define what; acceptance criteria define done.')).toBe(true);
  });
  test('contains match: substring absent scores false', () => {
    expect(scoreAnswer(oe('acceptance criteria'), 'User stories are short descriptions.')).toBe(false);
  });
  test('exact match: identical (case-insensitive) scores true', () => {
    expect(scoreAnswer(oe('velocity', 'exact'), 'velocity')).toBe(true);
  });
  test('exact match: extra words scores false', () => {
    expect(scoreAnswer(oe('velocity', 'exact'), 'velocity is a metric')).toBe(false);
  });
  test('regex match: pattern present scores true', () => {
    expect(scoreAnswer(oe('^agile', 'regex'), 'Agile manifesto values...')).toBe(true);
  });
  test('regex match: invalid regex returns false without throw', () => {
    expect(() => scoreAnswer(oe('[invalid', 'regex'), 'text')).not.toThrow();
    expect(scoreAnswer(oe('[invalid', 'regex'), 'text')).toBe(false);
  });
  test('missing match_type defaults to contains', () => {
    const item: EvalItem = { id: 'q3', question: 'Q?', type: 'open_ended', correct_answer: 'PRD' };
    expect(scoreAnswer(item, 'A PRD is a product requirements document.')).toBe(true);
  });
});
