// backend/src/evals/evalSchema.ts
// Zod schema for validating uploaded eval set files.
// zod is already in backend/package.json (^3.22.4).

import { z } from 'zod';

const ChoiceKeySchema = z.enum(['A', 'B', 'C', 'D']);
const MatchTypeSchema = z.enum(['exact', 'contains', 'regex']);

const EvalItemBaseSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  type: z.enum(['multiple_choice', 'open_ended']),
  choices: z.record(z.string()).optional(),
  correct_answer: z.string().min(1),
  match_type: MatchTypeSchema.optional(),
  category: z.string().optional(),
});

export const EvalItemSchema = EvalItemBaseSchema.superRefine((item, ctx) => {
  if (item.type === 'multiple_choice') {
    const choices = item.choices ?? {};
    for (const key of ['A', 'B', 'C', 'D']) {
      if (!choices[key]?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `multiple_choice rows must define choice ${key}`,
          path: ['choices', key],
        });
      }
    }

    if (!ChoiceKeySchema.safeParse(item.correct_answer).success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'multiple_choice.correct_answer must be one of A, B, C, or D',
        path: ['correct_answer'],
      });
    }
  }

  if (item.type === 'open_ended' && item.choices && Object.keys(item.choices).length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'open_ended rows must not include choices',
      path: ['choices'],
    });
  }
});

export const EvalItemArraySchema = z.array(EvalItemSchema).min(1, 'Eval set must contain at least one item');

export const AuthoredEvalItemSchema = EvalItemBaseSchema.extend({
  origin: z.enum(['human', 'ai_generated']).optional(),
  generation_context: z.object({
    sourceItemKeys: z.array(z.string().min(1)).optional(),
    promptVersion: z.string().optional(),
    model: z.string().optional(),
    generatedAt: z.string().datetime().optional(),
  }).optional(),
}).superRefine((item, ctx) => {
  EvalItemSchema.safeParse(item).error?.issues.forEach((issue) => ctx.addIssue(issue));
});

export const AuthoredEvalItemArraySchema = z.array(AuthoredEvalItemSchema)
  .min(1, 'Eval set must contain at least one item')
  .superRefine((items, ctx) => {
    const seen = new Set<string>();
    for (const [index, item] of items.entries()) {
      if (seen.has(item.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Eval item ids must be unique within a set',
          path: [index, 'id'],
        });
      }
      seen.add(item.id);
    }
  });

export const EvalSetPayloadSchema = z.object({
  name: z.string().min(1, 'name is required'),
  description: z.string().optional().nullable(),
  default_system_prompt: z.string().optional().nullable(),
  tags: z.array(z.string().min(1)).default([]),
  items: AuthoredEvalItemArraySchema,
});

export const EvalSetGenerationRequestSchema = z.object({
  seedItemKeys: z.array(z.string().min(1)).default([]),
  count: z.number().int().min(1).max(25),
  category: z.string().optional(),
  instructions: z.string().optional(),
});

export type ValidatedEvalItem = z.infer<typeof EvalItemSchema>;
