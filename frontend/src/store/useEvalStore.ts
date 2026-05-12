// frontend/src/store/useEvalStore.ts
import { create } from 'zustand';

// ─── Types (mirror backend evalTypes) ────────────────────────────────────────

export type RunStatus = 'pending' | 'running' | 'completed' | 'failed';
export type ErrorType = 'wrong_answer' | 'runtime_error';
export type ModelProvider = 'openai' | 'anthropic' | 'gemini' | 'groq' | 'mistral' | 'cohere' | 'togetherai' | 'local' | 'ollama' | 'mock';
export type StorageMode = 'database' | 'memory';

export interface EvalRunSummary {
  id: string;
  name: string;
  status: RunStatus;
  model_count: number;
  created_at: string;
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

export interface EvalRun {
  id: string;
  name: string;
  system_prompt: string | null;
  eval_set_filename: string | null;
  eval_set_id?: string | null;
  eval_set_data: unknown[];
  models_config: Array<{ provider: ModelProvider; modelId: string }>;
  status: RunStatus;
  created_at: string;
  completed_at: string | null;
  storage_mode?: StorageMode;
}

export interface RuntimeStatus {
  databaseConnected: boolean;
  storageMode: StorageMode;
  databaseError: string | null;
  databaseConfig?: {
    configured: boolean;
    source: string;
    label: string;
    envKeys: string[];
    connectionString: string | null;
    sslEnabled: boolean;
    readReplicaConfigured: boolean;
  };
}

// ─── Store Interface ──────────────────────────────────────────────────────────

interface EvalStore {
  // Run list (sidebar)
  runs: EvalRunSummary[];
  setRuns: (runs: EvalRunSummary[]) => void;
  addRunSummary: (run: EvalRunSummary) => void;

  // Active run detail
  activeRun: EvalRun | null;
  setActiveRun: (run: EvalRun | null) => void;
  updateActiveRunStatus: (status: RunStatus) => void;

  // Results keyed by "${runId}:${modelId}:${questionId}" for O(1) lookup
  results: Record<string, EvalResult>;
  setResults: (results: EvalResult[]) => void;
  addResult: (result: EvalResult) => void;
  clearResults: () => void;

  // UI state
  loading: boolean;
  setLoading: (loading: boolean) => void;
  error: string | null;
  setError: (error: string | null) => void;
  runtimeStatus: RuntimeStatus;
  setRuntimeStatus: (status: RuntimeStatus) => void;
}

// ─── Store Implementation ─────────────────────────────────────────────────────

export const useEvalStore = create<EvalStore>((set) => ({
  runs: [],
  setRuns: (runs) => set({ runs }),
  addRunSummary: (run) => set((s) => ({ runs: [run, ...s.runs.filter((r) => r.id !== run.id)] })),

  activeRun: null,
  setActiveRun: (run) => set({ activeRun: run }),
  updateActiveRunStatus: (status) =>
    set((s) => ({
      activeRun: s.activeRun ? { ...s.activeRun, status } : null,
      runs: s.runs.map((r) => (r.id === s.activeRun?.id ? { ...r, status } : r)),
    })),

  results: {},
  setResults: (results) => {
    const map: Record<string, EvalResult> = {};
    for (const r of results) {
      map[`${r.run_id}:${r.model_id}:${r.question_id}`] = r;
    }
    set({ results: map });
  },
  addResult: (result) =>
    set((s) => ({
      results: {
        ...s.results,
        [`${result.run_id}:${result.model_id}:${result.question_id}`]: result,
      },
    })),
  clearResults: () => set({ results: {} }),

  loading: false,
  setLoading: (loading) => set({ loading }),
  error: null,
  setError: (error) => set({ error }),
  runtimeStatus: {
    databaseConnected: true,
    storageMode: 'database',
    databaseError: null,
    databaseConfig: {
      configured: false,
      source: 'unconfigured',
      label: 'Unconfigured',
      envKeys: [],
      connectionString: null,
      sslEnabled: false,
      readReplicaConfigured: false,
    },
  },
  setRuntimeStatus: (runtimeStatus) => set({ runtimeStatus }),
}));
