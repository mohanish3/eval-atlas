// frontend/src/services/api.ts
import axios, { AxiosInstance, AxiosError } from 'axios';
import type { EvalRunSummary, EvalRun, EvalResult, RuntimeStatus, StorageMode } from '../store/useEvalStore';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

class ApiClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_URL,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
    });

    this.client.interceptors.request.use(
      (config) => {
        const token = localStorage.getItem('auth_token');
        if (token) config.headers.Authorization = `Bearer ${token}`;
        return config;
      },
      (error) => Promise.reject(error)
    );

    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        if (error.response?.status === 401) {
          localStorage.removeItem('auth_token');
        }
        const message =
          (error.response?.data as { error?: string })?.error ||
          error.message ||
          'Request failed';
        return Promise.reject(new Error(message));
      }
    );
  }

  get instance(): AxiosInstance {
    return this.client;
  }
}

export const apiClient = new ApiClient();
export default apiClient.instance;

// ─── Eval Service ─────────────────────────────────────────────────────────────

export interface ModelSpec {
  provider: string;
  modelId: string;
}

export type EvalItemType = 'multiple_choice' | 'open_ended';
export type MatchType = 'exact' | 'contains' | 'regex';
export type EvalItemOrigin = 'human' | 'ai_generated';

export interface AuthoredEvalItem {
  id: string;
  question: string;
  type: EvalItemType;
  choices?: Record<string, string>;
  correct_answer: string;
  match_type?: MatchType;
  category?: string;
  origin?: EvalItemOrigin;
  generation_context?: {
    sourceItemKeys?: string[];
    promptVersion?: string;
    model?: string;
    generatedAt?: string;
  };
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

export interface EvalSetCsvExport {
  filename: string;
  csv: string;
}

export interface AvailableModels {
  localModels: Array<{ id: string; name: string; source?: string }>;
  ollamaModels: Array<{ id: string; name: string; source?: string }>;
  apiProviders: Array<{
    provider: string;
    configured: boolean;
    defaultModel: string;
    models: string[];   // fetched from provider API, falls back to [defaultModel]
  }>;
  runtime: RuntimeStatus;
}

export interface RunDetailResponse {
  run: EvalRun;
  results: EvalResult[];
}

export const evalService = {
  /** List all runs (summary only) */
  listRuns: async (): Promise<EvalRunSummary[]> => {
    const res = await apiClient.instance.get('/api/evals/runs');
    return res.data;
  },

  /** Get a single run with all results */
  getRun: async (runId: string): Promise<RunDetailResponse> => {
    const res = await apiClient.instance.get(`/api/evals/runs/${runId}`);
    return res.data;
  },

  /** Create a new eval run. Returns { runId, status } */
  createRun: async (params: {
    name: string;
    systemPrompt: string;
    modelsConfig: ModelSpec[];
    evalFile?: File;
    evalSetId?: string;
    evalItems?: AuthoredEvalItem[];
    inputKeys?: string[];
    outputKey?: string;
    maxTokens?: number;
  }): Promise<{ runId: string; status: string; storageMode: StorageMode; run: EvalRun; databaseError?: string }> => {
    let res;
    if (params.evalFile) {
      const form = new FormData();
      form.append('name', params.name);
      form.append('systemPrompt', params.systemPrompt);
      form.append('modelsConfig', JSON.stringify(params.modelsConfig));
      form.append('evalFile', params.evalFile);
      if (params.inputKeys && params.inputKeys.length > 0) {
        form.append('inputKeys', JSON.stringify(params.inputKeys));
      }
      if (params.outputKey) form.append('outputKey', params.outputKey);
      if (params.maxTokens !== undefined) form.append('maxTokens', String(params.maxTokens));
      res = await apiClient.instance.post('/api/evals/runs', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    } else {
      res = await apiClient.instance.post('/api/evals/runs', {
        name: params.name,
        systemPrompt: params.systemPrompt,
        modelsConfig: params.modelsConfig,
        evalSetId: params.evalSetId,
        evalItems: params.evalItems,
        maxTokens: params.maxTokens,
      });
    }
    return res.data;
  },

  listEvalSets: async (): Promise<EvalSetSummary[]> => {
    const res = await apiClient.instance.get('/api/evals/sets');
    return res.data;
  },

  getEvalSet: async (evalSetId: string): Promise<EvalSet> => {
    const res = await apiClient.instance.get(`/api/evals/sets/${evalSetId}`);
    return res.data;
  },

  exportEvalSetCsv: async (evalSetId: string): Promise<EvalSetCsvExport> => {
    const evalSet = await evalService.getEvalSet(evalSetId);
    const sanitize = (value: string) =>
      value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'eval-set';
    const escapeCell = (value: unknown) => {
      const text = typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
      return `"${text.replace(/"/g, '""')}"`;
    };

    const headers = [
      'id',
      'question',
      'type',
      'choice_a',
      'choice_b',
      'choice_c',
      'choice_d',
      'correct_answer',
      'match_type',
      'category',
      'origin',
      'generation_context',
    ];

    const rows = evalSet.items.map((item) => [
      item.id,
      item.question,
      item.type,
      item.choices?.A ?? '',
      item.choices?.B ?? '',
      item.choices?.C ?? '',
      item.choices?.D ?? '',
      item.correct_answer,
      item.match_type ?? '',
      item.category ?? '',
      item.origin ?? 'human',
      item.generation_context ?? null,
    ]);

    return {
      filename: `${sanitize(evalSet.name)}.csv`,
      csv: [headers, ...rows].map((row) => row.map(escapeCell).join(',')).join('\n'),
    };
  },

  createEvalSet: async (payload: {
    name: string;
    description?: string | null;
    default_system_prompt?: string | null;
    tags?: string[];
    items: AuthoredEvalItem[];
  }): Promise<EvalSet> => {
    const res = await apiClient.instance.post('/api/evals/sets', payload);
    return res.data;
  },

  updateEvalSet: async (evalSetId: string, payload: {
    name: string;
    description?: string | null;
    default_system_prompt?: string | null;
    tags?: string[];
    items: AuthoredEvalItem[];
  }): Promise<EvalSet> => {
    const res = await apiClient.instance.put(`/api/evals/sets/${evalSetId}`, payload);
    return res.data;
  },

  deleteEvalSet: async (evalSetId: string): Promise<void> => {
    await apiClient.instance.delete(`/api/evals/sets/${evalSetId}`);
  },

  generateEvalSetItems: async (evalSetId: string, payload: {
    seedItemKeys: string[];
    count: number;
    category?: string;
    instructions?: string;
  }): Promise<{ items: AuthoredEvalItem[]; provider: string }> => {
    const res = await apiClient.instance.post(`/api/evals/sets/${evalSetId}/generate`, payload);
    return res.data;
  },

  /** Get available local models and configured API providers */
  getModels: async (): Promise<AvailableModels> => {
    const res = await apiClient.instance.get('/api/evals/models');
    return res.data;
  },

  /** Retry runtime_error results for an existing run */
  retryErrors: async (runId: string): Promise<{ runId: string; retriedCount: number }> => {
    const res = await apiClient.instance.post(`/api/evals/runs/${runId}/retry-errors`);
    return res.data;
  },
};

// ─── Research Service ─────────────────────────────────────────────────────────

export type ResearchRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'stopped';
export type TrialStatus = 'keep' | 'discard' | 'crash';

export interface PromptResearchRun {
  id: string;
  name: string;
  eval_run_id: string | null;
  source_eval_set_id: string | null;
  base_prompt: string;
  best_prompt: string | null;
  research_spec: string;
  research_model_provider: string;
  research_model_id: string;
  target_models_config: ModelSpec[];
  optimization_metric: string;
  status: ResearchRunStatus;
  storage_mode: string;
  max_iterations: number;
  candidate_count_per_iteration: number;
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

export const researchService = {
  create: async (params: {
    name: string;
    evalSetId?: string;
    evalItems?: AuthoredEvalItem[];
    basePrompt: string;
    targetModel: ModelSpec;
    researchModel: ModelSpec;
    maxIterations: number;
    candidateCountPerIteration: number;
    holdoutEnabled: boolean;
    earlyStopK: number;
    maxTokens: number;
    maxTokenBudget?: number;
    researchSpec?: string;
    consentAcknowledged: boolean;
  }): Promise<{ researchRunId: string; status: string; storageMode: string; maxTokenBudget: number | null }> => {
    const res = await apiClient.instance.post('/api/evals/prompt-research', params);
    return res.data;
  },

  list: async (): Promise<PromptResearchRun[]> => {
    const res = await apiClient.instance.get('/api/evals/prompt-research');
    return res.data;
  },

  get: async (id: string): Promise<PromptResearchRunDetail> => {
    const res = await apiClient.instance.get(`/api/evals/prompt-research/${id}`);
    return res.data;
  },

  promote: async (id: string): Promise<{ promoted: boolean; bestPrompt: string | null }> => {
    const res = await apiClient.instance.post(`/api/evals/prompt-research/${id}/promote`);
    return res.data;
  },
};
