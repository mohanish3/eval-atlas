// backend/src/evals/scorer.ts
import type { EvalItem } from '../shared/evalTypes.js';

/**
 * Score a model's raw output against the expected answer for an eval item.
 * Returns true if correct, false otherwise.
 *
 * Multiple-choice: extract first A-D letter from output (case-insensitive).
 * If not at the start, search the full response for a standalone letter match.
 *
 * Open-ended: uses match_type field (defaults to 'contains').
 */
export function scoreAnswer(item: EvalItem, rawOutput: string): boolean {
  const trimmed = rawOutput.trim();

  if (item.type === 'multiple_choice') {
    // Try to find answer letter at start of response
    const startMatch = trimmed.match(/^[A-Da-d]/);
    if (startMatch) {
      return startMatch[0].toUpperCase() === item.correct_answer.toUpperCase();
    }
    // Fallback: find standalone letter anywhere in response (e.g. "The answer is B")
    const anyMatch = trimmed.match(/\b([A-Da-d])\b/);
    if (anyMatch) {
      return anyMatch[1].toUpperCase() === item.correct_answer.toUpperCase();
    }
    return false;
  }

  // open_ended
  const matchType = item.match_type ?? 'contains';
  const expected = item.correct_answer;

  switch (matchType) {
    case 'exact':
      return trimmed.toLowerCase() === expected.toLowerCase();
    case 'contains':
      return trimmed.toLowerCase().includes(expected.toLowerCase());
    case 'regex':
      try {
        return new RegExp(expected, 'i').test(trimmed);
      } catch {
        // Invalid regex in eval set — treat as no match
        console.warn(`[scorer] Invalid regex in eval item ${item.id}: ${expected}`);
        return false;
      }
    default:
      return false;
  }
}
