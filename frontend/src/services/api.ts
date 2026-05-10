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
    evalFile: File;
    inputKeys?: string[];
    outputKey?: string;
    maxTokens?: number;
  }): Promise<{ runId: string; status: string; storageMode: StorageMode; run: EvalRun; databaseError?: string }> => {
    const form = new FormData();
    form.append('name', params.name);
    form.append('systemPrompt', params.systemPrompt);
    form.append('modelsConfig', JSON.stringify(params.modelsConfig));
    form.append('evalFile', params.evalFile);
    if (params.inputKeys && params.inputKeys.length > 0)
      form.append('inputKeys', JSON.stringify(params.inputKeys));
    if (params.outputKey) form.append('outputKey', params.outputKey);
    if (params.maxTokens !== undefined) form.append('maxTokens', String(params.maxTokens));
    // Use axios with multipart; override Content-Type to let browser set boundary
    const res = await apiClient.instance.post('/api/evals/runs', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
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
