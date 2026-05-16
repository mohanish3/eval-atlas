// backend/src/shared/evalTypes.ts
// Canonical TypeScript types for the eval domain.
// All other backend files import from here.

// ─── Eval Set Item (from uploaded file) ────────────────────────────────────

export type EvalItemType = 'multiple_choice' | 'open_ended';
export type MatchType = 'exact' | 'contains' | 'regex';
export type EvalItemOrigin = 'human' | 'ai_generated';

export interface EvalItem {
  id: string;                              // unique within an eval set
  question: string;
  type: EvalItemType;
  choices?: Record<string, string>;        // e.g. { A: '...', B: '...', C: '...', D: '...' } — MC only
  correct_answer: string;                  // letter key for MC; expected string for open-ended
  match_type?: MatchType;                  // open-ended only; defaults to 'contains'
  category?: string;                       // optional; enables per-category breakdown
}

export interface GenerationContext {
  sourceItemKeys?: string[];
  promptVersion?: string;
  model?: string;
  generatedAt?: string;
}

export interface AuthoredEvalItem extends EvalItem {
  origin?: EvalItemOrigin;
  generation_context?: GenerationContext;
}

export interface EvalSet {
  id: string;
  name: string;
  description: string | null;
  default_system_prompt: string | null;
  tags: string[];
  items: AuthoredEvalItem[];
  created_at: string;
  updated_at: string;
}

export interface EvalSetSummary {
  id: string;
  name: string;
  description: string | null;
  tags: string[];
  item_count: number;
  created_at: string;
  updated_at: string;
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
  eval_set_id?: string | null;
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

// ─── Prompt Research Types ──────────────────────────────────────────────────

export type ResearchRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'stopped';
export type TrialStatus = 'keep' | 'discard' | 'crash';

export interface PromptResearchRun {
  id: string;
  name: string;
  eval_run_id: string | null;
  source_eval_set_id: string | null;
  eval_set_data: EvalItem[];
  base_prompt: string;
  best_prompt: string | null;
  research_spec: string;
  research_model_provider: string;
  research_model_id: string;
  target_models_config: ModelSpec[];
  optimization_metric: string;
  status: ResearchRunStatus;
  storage_mode: StorageMode;
  max_iterations: number;
  candidate_count_per_iteration: number;
  sample_size: number | null;
  holdout_enabled: boolean;
  early_stop_k: number;
  max_token_budget: number | null;
  baseline_accuracy: number | null;
  best_accuracy: number | null;
  promoted_at: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface PromptResearchTrial {
  id: string;
  research_run_id: string;
  iteration: number;
  candidate_prompt: string;
  mutation_summary: string | null;
  status: TrialStatus;
  overall_accuracy: number | null;
  latency_ms_avg: number | null;
  tokens_used_total: number | null;
  runtime_error_count: number | null;
  target_run_snapshot: Record<string, unknown>;
  created_at: string;
}

export interface PromptResearchRunDetail extends PromptResearchRun {
  trials: PromptResearchTrial[];
}
