import { Router, type Response } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { checkDatabaseConnection, getPool } from '../db/connection.js';
import { runEval, retryEvalErrors } from '../evals/runner.js';
import {
  addClient,
  removeClient,
} from '../evals/sseManager.js';
import {
  createMemoryRun,
  deleteMemoryRuntimeErrors,
  getMemoryRun,
  getMemoryRunDetail,
  listMemoryRuntimeErrors,
  listMemoryRuns,
} from '../evals/fallbackStore.js';
import { EvalItemArraySchema } from '../evals/evalSchema.js';
import type { EvalItem, ModelSpec, RunConfig, EvalRun, EvalRunSummary, StorageMode } from '../shared/evalTypes.js';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Number(process.env.MAX_EVAL_FILE_BYTES || 5 * 1024 * 1024),
    files: 1,
  },
});

const AGENT_URL = process.env.AGENT_URL ?? 'http://localhost:3001';

async function getStorageMode(): Promise<{ storageMode: StorageMode; databaseError?: string }> {
  const dbState = await checkDatabaseConnection();
  return {
    storageMode: dbState.connected ? 'database' : 'memory',
    databaseError: dbState.error,
  };
}

function parseEvalItems(fileBuffer: Buffer, body: Record<string, string>): EvalItem[] {
  const raw = fileBuffer.toString('utf-8').trim();
  const rawItems = raw.startsWith('[')
    ? JSON.parse(raw)
    : raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));

  let inputKeys: string[] | undefined;
  if (body.inputKeys) {
    try {
      inputKeys = JSON.parse(body.inputKeys);
    } catch {
      inputKeys = undefined;
    }
  }

  const outputKey = body.outputKey?.trim() || undefined;
  let items: unknown[];

  if (inputKeys && inputKeys.length > 0 && outputKey) {
    items = rawItems.map((item: unknown, index: number) => {
      const obj = item as Record<string, unknown>;
      const serialize = (value: unknown) =>
        typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '');
      const question = inputKeys!.length === 1
        ? serialize(obj[inputKeys![0]])
        : inputKeys!.map((key) => `${key}: ${serialize(obj[key])}`).join('\n\n');

      return {
        id: String(obj.id ?? index + 1),
        question,
        type: 'open_ended',
        correct_answer: String(obj[outputKey] ?? ''),
        match_type: (obj.match_type as string | undefined) ?? 'contains',
        category: (obj.category as string | undefined) ?? undefined,
      };
    });
  } else {
    items = rawItems;
  }

  const parsed = EvalItemArraySchema.safeParse(items);
  if (!parsed.success) {
    const error = new Error('Invalid eval set format');
    (error as Error & { details?: unknown }).details = parsed.error.flatten();
    throw error;
  }

  return parsed.data;
}

function buildRunConfig(
  runId: string,
  systemPrompt: string,
  evalSet: EvalItem[],
  modelsConfig: ModelSpec[],
  maxTokens: number,
  storageMode: StorageMode
): RunConfig {
  return {
    runId,
    systemPrompt,
    evalSet,
    apiModels: modelsConfig.filter((model) => model.provider !== 'local' && model.provider !== 'ollama'),
    localModels: modelsConfig.filter((model) => model.provider === 'local' || model.provider === 'ollama'),
    maxTokens,
    storageMode,
  };
}

router.post('/runs', upload.single('evalFile'), async (req, res) => {
  try {
    const fileBuffer = req.file?.buffer;
    if (!fileBuffer) {
      return res.status(400).json({ error: 'evalFile is required (multipart/form-data field name: evalFile)' });
    }

    const name = req.body.name?.trim();
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    const systemPrompt = req.body.systemPrompt?.trim() ?? '';
    const modelsConfigRaw = req.body.modelsConfig;
    if (!modelsConfigRaw) {
      return res.status(400).json({ error: 'modelsConfig is required' });
    }

    let modelsConfig: ModelSpec[];
    try {
      modelsConfig = JSON.parse(modelsConfigRaw);
    } catch {
      return res.status(400).json({ error: 'modelsConfig must be valid JSON (ModelSpec[] array)' });
    }

    const maxTokens = parseInt(req.body.maxTokens ?? '256', 10) || 256;
    let evalSet: EvalItem[];

    try {
      evalSet = parseEvalItems(fileBuffer, req.body as Record<string, string>);
    } catch (error) {
      const details = (error as Error & { details?: unknown }).details;
      return res.status(400).json({
        error: error instanceof Error ? error.message : 'Invalid eval set format',
        ...(details ? { details } : {}),
      });
    }

    const { storageMode, databaseError } = await getStorageMode();
    const runId = uuidv4();
    const createdAt = new Date().toISOString();
    const run: EvalRun = {
      id: runId,
      name,
      system_prompt: systemPrompt || null,
      eval_set_filename: req.file?.originalname ?? null,
      eval_set_data: evalSet,
      models_config: modelsConfig,
      status: 'pending',
      created_at: createdAt,
      completed_at: null,
      storage_mode: storageMode,
    };

    if (storageMode === 'database') {
      const pool = getPool();
      await pool.query(
        `INSERT INTO eval_runs (id, name, system_prompt, eval_set_filename, eval_set_data, models_config, status)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, 'pending')`,
        [
          run.id,
          run.name,
          run.system_prompt,
          run.eval_set_filename,
          JSON.stringify(run.eval_set_data),
          JSON.stringify(run.models_config),
        ]
      );
    } else {
      createMemoryRun(run);
    }

    const config = buildRunConfig(runId, systemPrompt, evalSet, modelsConfig, maxTokens, storageMode);
    runEval(config).catch((error) => {
      console.error(`[routes/evals] Unhandled runner error for run ${runId}:`, error);
    });

    return res.status(201).json({
      runId,
      status: 'pending',
      storageMode,
      run,
      databaseError: storageMode === 'memory' ? databaseError : undefined,
    });
  } catch (error) {
    console.error('[routes/evals] POST /runs error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/runs/:id/retry-errors', async (req, res) => {
  try {
    const runId = req.params.id;
    const memoryRun = getMemoryRun(runId);

    if (memoryRun) {
      if (memoryRun.status === 'running' || memoryRun.status === 'pending') {
        return res.status(409).json({ error: 'Run is already in progress' });
      }

      const runtimeErrors = listMemoryRuntimeErrors(runId);
      if (runtimeErrors.length === 0) {
        return res.status(400).json({ error: 'No runtime errors to retry' });
      }

      deleteMemoryRuntimeErrors(runId);
      const modelErrors = new Map<string, Set<string>>();
      for (const { modelId, questionId } of runtimeErrors) {
        if (!modelErrors.has(modelId)) {
          modelErrors.set(modelId, new Set());
        }
        modelErrors.get(modelId)!.add(questionId);
      }

      const retryModels: Array<{ model: ModelSpec; items: EvalItem[] }> = [];
      for (const [modelId, questionIds] of modelErrors.entries()) {
        const model = memoryRun.models_config.find((entry) => entry.modelId === modelId);
        if (!model) {
          continue;
        }
        const items = memoryRun.eval_set_data.filter((item) => questionIds.has(item.id));
        if (items.length > 0) {
          retryModels.push({ model, items });
        }
      }

      retryEvalErrors(runId, retryModels, memoryRun.system_prompt ?? '', 256, 'memory').catch((error) => {
        console.error(`[routes/evals] Unhandled memory retry error for run ${runId}:`, error);
      });

      return res.status(200).json({ runId, retriedCount: runtimeErrors.length, storageMode: 'memory' });
    }

    const dbState = await checkDatabaseConnection();
    if (!dbState.connected) {
      return res.status(503).json({ error: 'Database unavailable. Retry is only supported for in-memory runs in fallback mode.' });
    }

    const pool = getPool();
    const runResult = await pool.query<EvalRun>('SELECT * FROM eval_runs WHERE id = $1', [runId]);
    if (runResult.rows.length === 0) {
      return res.status(404).json({ error: 'Run not found' });
    }

    const run = runResult.rows[0];
    if (run.status === 'running' || run.status === 'pending') {
      return res.status(409).json({ error: 'Run is already in progress' });
    }

    const errorsResult = await pool.query<{ model_id: string; question_id: string }>(
      `SELECT model_id, question_id FROM eval_results WHERE run_id = $1 AND error_type = 'runtime_error'`,
      [runId]
    );
    if (errorsResult.rows.length === 0) {
      return res.status(400).json({ error: 'No runtime errors to retry' });
    }

    const modelQuestions = new Map<string, Set<string>>();
    for (const { model_id, question_id } of errorsResult.rows) {
      if (!modelQuestions.has(model_id)) {
        modelQuestions.set(model_id, new Set());
      }
      modelQuestions.get(model_id)!.add(question_id);
    }

    await pool.query(`DELETE FROM eval_results WHERE run_id = $1 AND error_type = 'runtime_error'`, [runId]);

    const evalSet = run.eval_set_data as EvalItem[];
    const modelsConfig = run.models_config as ModelSpec[];
    const retryModels: Array<{ model: ModelSpec; items: EvalItem[] }> = [];

    for (const [modelId, questionIds] of modelQuestions.entries()) {
      const model = modelsConfig.find((entry) => entry.modelId === modelId);
      if (!model) {
        continue;
      }
      const items = evalSet.filter((item) => questionIds.has(item.id));
      if (items.length > 0) {
        retryModels.push({ model, items });
      }
    }

    retryEvalErrors(runId, retryModels, run.system_prompt ?? '', 256, 'database').catch((error) => {
      console.error(`[routes/evals] Unhandled retry error for run ${runId}:`, error);
    });

    return res.status(200).json({ runId, retriedCount: errorsResult.rows.length, storageMode: 'database' });
  } catch (error) {
    console.error('[routes/evals] POST /runs/:id/retry-errors error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/runs', async (_req, res) => {
  try {
    const dbState = await checkDatabaseConnection();
    const memoryRuns = listMemoryRuns();

    if (!dbState.connected) {
      return res.json(memoryRuns);
    }

    const pool = getPool();
    const result = await pool.query<EvalRunSummary>(`
      SELECT
        r.id,
        r.name,
        r.status,
        r.created_at,
        r.completed_at,
        COUNT(DISTINCT res.model_id) AS model_count
      FROM eval_runs r
      LEFT JOIN eval_results res ON res.run_id = r.id
      GROUP BY r.id
      ORDER BY r.created_at DESC
    `);

    const databaseRuns = result.rows.map((run) => ({
      ...run,
      model_count: Number(run.model_count),
      storage_mode: 'database' as StorageMode,
    }));

    const merged = [...databaseRuns, ...memoryRuns].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    return res.json(merged);
  } catch (error) {
    console.error('[routes/evals] GET /runs error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/runs/:id', async (req, res) => {
  try {
    const memoryRun = getMemoryRunDetail(req.params.id);
    if (memoryRun) {
      return res.json(memoryRun);
    }

    const dbState = await checkDatabaseConnection();
    if (!dbState.connected) {
      return res.status(503).json({ error: 'Database unavailable and run is not cached in fallback memory.' });
    }

    const pool = getPool();
    const runResult = await pool.query<EvalRun>('SELECT * FROM eval_runs WHERE id = $1', [req.params.id]);
    if (runResult.rows.length === 0) {
      return res.status(404).json({ error: 'Run not found' });
    }

    const resultsResult = await pool.query(
      'SELECT * FROM eval_results WHERE run_id = $1 ORDER BY created_at',
      [req.params.id]
    );

    return res.json({
      run: {
        ...runResult.rows[0],
        storage_mode: 'database' as StorageMode,
      },
      results: resultsResult.rows,
    });
  } catch (error) {
    console.error('[routes/evals] GET /runs/:id error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/runs/:id/stream', (req, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(': connected\n\n');

  const runId = req.params.id;
  addClient(runId, res);

  req.on('close', () => {
    removeClient(runId, res);
  });
});

async function fetchModelsWithTimeout(
  url: string,
  headers: Record<string, string>,
  timeoutMs = 5_000
): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchProviderModels(provider: string, apiKey: string, defaultModel: string): Promise<string[]> {
  try {
    switch (provider) {
      case 'openai': {
        const body = await fetchModelsWithTimeout(
          'https://api.openai.com/v1/models',
          { Authorization: `Bearer ${apiKey}` }
        ) as { data?: Array<{ id: string }> };
        return (body.data ?? []).map((model) => model.id).filter((id) => /^(gpt-|o1|o3|o4)/.test(id)).sort();
      }
      case 'anthropic':
        return [
          'claude-opus-4-6',
          'claude-sonnet-4-6',
          'claude-haiku-4-5-20251001',
          'claude-3-5-sonnet-20241022',
          'claude-3-5-haiku-20241022',
        ];
      case 'gemini': {
        const body = await fetchModelsWithTimeout(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
          {}
        ) as { models?: Array<{ name: string; supportedGenerationMethods?: string[] }> };
        return (body.models ?? [])
          .filter((model) => model.supportedGenerationMethods?.includes('generateContent'))
          .map((model) => model.name.replace('models/', ''))
          .sort();
      }
      case 'groq': {
        const body = await fetchModelsWithTimeout(
          'https://api.groq.com/openai/v1/models',
          { Authorization: `Bearer ${apiKey}` }
        ) as { data?: Array<{ id: string }> };
        return (body.data ?? []).map((model) => model.id).sort();
      }
      case 'mistral': {
        const body = await fetchModelsWithTimeout(
          'https://api.mistral.ai/v1/models',
          { Authorization: `Bearer ${apiKey}` }
        ) as { data?: Array<{ id: string }> };
        return (body.data ?? []).map((model) => model.id).sort();
      }
      case 'cohere': {
        const body = await fetchModelsWithTimeout(
          'https://api.cohere.ai/v2/models',
          { Authorization: `Bearer ${apiKey}` }
        ) as { models?: Array<{ name: string }> };
        return (body.models ?? []).map((model) => model.name).sort();
      }
      case 'togetherai': {
        const body = await fetchModelsWithTimeout(
          'https://api.together.xyz/v1/models',
          { Authorization: `Bearer ${apiKey}` }
        ) as Array<{ id: string; type?: string }>;
        return (Array.isArray(body) ? body : [])
          .filter((model) => !model.type || model.type === 'chat' || model.type === 'language')
          .map((model) => model.id)
          .sort();
      }
      case 'mock':
        return ['mock-model'];
      default:
        return [defaultModel];
    }
  } catch (error) {
    console.warn(`[routes/evals] Could not fetch models for ${provider}:`, (error as Error).message);
    return [defaultModel];
  }
}

router.get('/models', async (_req, res) => {
  const providerConfig = [
    { provider: 'openai', envKey: 'OPENAI_API_KEY', defaultModel: 'gpt-4o' },
    { provider: 'anthropic', envKey: 'ANTHROPIC_API_KEY', defaultModel: 'claude-sonnet-4-6' },
    { provider: 'gemini', envKey: 'GEMINI_API_KEY', defaultModel: 'gemini-2.5-flash' },
    { provider: 'groq', envKey: 'GROQ_API_KEY', defaultModel: 'llama-3.3-70b-versatile' },
    { provider: 'mistral', envKey: 'MISTRAL_API_KEY', defaultModel: 'mistral-large-latest' },
    { provider: 'cohere', envKey: 'COHERE_API_KEY', defaultModel: 'command-a-03-2025' },
    { provider: 'togetherai', envKey: 'TOGETHER_API_KEY', defaultModel: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo' },
    { provider: 'mock', envKey: 'MOCK_ENABLED', defaultModel: 'mock-model' },
  ] as const;

  const apiProviders = await Promise.all(
    providerConfig.map(async ({ provider, envKey, defaultModel }) => {
      const configured = provider === 'mock' 
        ? process.env.MOCK_ENABLED === 'true'
        : Boolean(process.env[envKey]);
      const apiKey = process.env[envKey] ?? '';
      const models = configured ? await fetchProviderModels(provider, apiKey, defaultModel) : [defaultModel];
      return { provider, configured, defaultModel, models };
    })
  );

  let localModels: Array<{ id: string; name: string; source: 'llama' | 'ollama' }> = [];
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3_000);
    const response = await fetch(`${AGENT_URL}/v1/models`, { signal: controller.signal });
    clearTimeout(timeoutId);
    const body = await response.json() as { data?: Array<{ id: string }> };
    localModels = (body.data ?? []).map((model) => ({ id: model.id, name: model.id, source: 'llama' as const }));
  } catch {
    console.warn('[routes/evals] agent_server.py unreachable - localModels (llama): []');
  }

  const ollamaUrl = process.env.OLLAMA_URL ?? 'http://localhost:11434';
  let ollamaModels: Array<{ id: string; name: string; source: 'ollama' }> = [];
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3_000);
    const response = await fetch(`${ollamaUrl}/api/tags`, { signal: controller.signal });
    clearTimeout(timeoutId);
    const body = await response.json() as { models?: Array<{ name: string }> };
    ollamaModels = (body.models ?? []).map((model) => ({ id: model.name, name: model.name, source: 'ollama' as const }));
  } catch {
    console.warn('[routes/evals] Ollama unreachable - ollamaModels: []');
  }

  const dbState = await checkDatabaseConnection();
  const isProd = process.env.NODE_ENV === 'production';

  return res.json({
    localModels,
    ollamaModels,
    apiProviders,
    runtime: {
      databaseConnected: dbState.connected,
      storageMode: dbState.connected ? 'database' : 'memory',
      databaseError: dbState.error && !isProd ? dbState.error : null,
    },
  });
});

export default router;
