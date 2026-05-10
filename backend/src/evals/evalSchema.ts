// backend/src/evals/evalSchema.ts
// Zod schema for validating uploaded eval set files.
// zod is already in backend/package.json (^3.22.4).

import { z } from 'zod';

export const EvalItemSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  type: z.enum(['multiple_choice', 'open_ended']),
  choices: z.record(z.string()).optional(),
  correct_answer: z.string().min(1),
  match_type: z.enum(['exact', 'contains', 'regex']).optional(),
  category: z.string().optional(),
});

export const EvalItemArraySchema = z.array(EvalItemSchema).min(1, 'Eval set must contain at least one item');

export type ValidatedEvalItem = z.infer<typeof EvalItemSchema>;
