// backend/src/shared/evalTypes.ts
// Canonical TypeScript types for the eval domain.
// All other backend files import from here.

// ─── Eval Set Item (from uploaded file) ────────────────────────────────────

export type EvalItemType = 'multiple_choice' | 'open_ended';
export type MatchType = 'exact' | 'contains' | 'regex';

export interface EvalItem {
  id: string;                              // unique within an eval set
  question: string;
  type: EvalItemType;
  choices?: Record<string, string>;        // e.g. { A: '...', B: '...', C: '...', D: '...' } — MC only
  correct_answer: string;                  // letter key for MC; expected string for open-ended
  match_type?: MatchType;                  // open-ended only; defaults to 'contains'
  category?: string;                       // optional; enables per-category breakdown
}

// ─── Model Configuration ────────────────────────────────────────────────────

export type ModelProvider =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'groq'
  | 'mistral'
  | 'cohere'
  | 'togetherai'
  | 'local'
  | 'ollama'
  | 'mock';

export interface ModelSpec {
  provider: ModelProvider;
  modelId: string;  // e.g. 'gpt-4o', 'claude-sonnet-4-6', 'llama-3.3-70b-versatile'
}

// ─── Database Row Types ─────────────────────────────────────────────────────

export type RunStatus = 'pending' | 'running' | 'completed' | 'failed';
export type ErrorType = 'wrong_answer' | 'runtime_error';
export type StorageMode = 'database' | 'memory';

export interface EvalRun {
  id: string;
  name: string;
  system_prompt: string | null;
  eval_set_filename: string | null;
  eval_set_data: EvalItem[];               // stored as JSONB, parsed on read
  models_config: ModelSpec[];              // stored as JSONB, parsed on read
  status: RunStatus;
  created_at: string;                      // ISO 8601
  completed_at: string | null;
  storage_mode?: StorageMode;
}

export interface EvalResult {
  id: string;
  run_id: string;
  model_id: string;
  question_id: string;
  category: string | null;
  model_output: string | null;
  correct_answer: string | null;
  is_correct: boolean | null;
  error_type: ErrorType | null;
  latency_ms: number | null;
  tokens_used: number | null;
  created_at: string;
}

// ─── Runner Configuration ───────────────────────────────────────────────────

export interface RunConfig {
  runId: string;
  systemPrompt: string;
  evalSet: EvalItem[];
  apiModels: ModelSpec[];   // run in parallel via Promise.allSettled
  localModels: ModelSpec[]; // run sequentially via for...of
  maxTokens: number;        // max tokens for model responses (default: 256)
  storageMode: StorageMode;
}

// ─── API Response Shapes (used by routes and frontend) ─────────────────────

export interface EvalRunSummary {
  id: string;
  name: string;
  status: RunStatus;
  model_count: number;
  created_at: string;
  completed_at: string | null;
  storage_mode?: StorageMode;
}

export interface AvailableModels {
  localModels: Array<{ id: string; name: string; source: 'llama' | 'ollama' }>;
  ollamaModels: Array<{ id: string; name: string; source: 'ollama' }>;
  apiProviders: Array<{ provider: ModelProvider; configured: boolean; defaultModel: string }>;
}
