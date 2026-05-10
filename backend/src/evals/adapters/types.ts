// backend/src/evals/adapters/types.ts

export interface EvalRequest {
  systemPrompt: string;
  question: string;
  choices?: Record<string, string>;  // only present for multiple_choice items
  maxTokens: number;                 // passed from RunConfig; controls cost/output length
}

export interface EvalResponse {
  rawOutput: string;
  tokensUsed: number;
  latencyMs: number;
}

/**
 * All adapters implement this signature.
 * modelId: the model string to pass to the provider (e.g. 'gpt-4o', 'claude-sonnet-4-6').
 */
export type ModelAdapter = (modelId: string, req: EvalRequest) => Promise<EvalResponse>;

/**
 * Build the user message content from question + choices (if multiple choice).
 */
export function buildUserMessage(req: EvalRequest): string {
  if (!req.choices) return req.question;

  const choiceLines = Object.entries(req.choices)
    .map(([key, val]) => `${key}: ${val}`)
    .join('\n');
  return `${req.question}\n\n${choiceLines}\n\nRespond with the letter of the correct answer only (A, B, C, or D).`;
}
