import { Router, type Response } from 'express';
import multer from 'multer';
import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';
import { checkDatabaseConnection, getPool, getReadPool, resolveDatabaseConfig } from '../db/connection.js';
import { runEval, retryEvalErrors } from '../evals/runner.js';
import { addClient, removeClient } from '../evals/sseManager.js';
import {
  createMemoryRun,
  deleteMemoryEvalSet,
  getMemoryEvalSet,
  deleteMemoryRuntimeErrors,
  getMemoryRun,
  getMemoryRunDetail,
  listMemoryEvalSets,
  listMemoryRuntimeErrors,
  listMemoryRuns,
  saveMemoryEvalSet,
} from '../evals/fallbackStore.js';
import {
  AuthoredEvalItemArraySchema,
  EvalItemArraySchema,
  EvalSetGenerationRequestSchema,
  EvalSetPayloadSchema,
} from '../evals/evalSchema.js';
import type {
  AuthoredEvalItem,
  EvalItem,
  EvalRun,
  EvalRunSummary,
  EvalSet,
  EvalSetSummary,
  ModelSpec,
  RunConfig,
  StorageMode,
} from '../shared/evalTypes.js';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Number(process.env.MAX_EVAL_FILE_BYTES || 5 * 1024 * 1024),
    files: 1,
  },
});

const AGENT_URL = process.env.AGENT_URL ?? 'http://localhost:3001';
const AI_GENERATION_MODEL = process.env.EVAL_SET_GENERATION_MODEL ?? 'gpt-4o-mini';

type EvalSetRow = {
  id: string;
  name: string;
  description: string | null;
  default_system_prompt: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
};

type EvalSetItemRow = {
  item_key: string;
  question: string;
  type: EvalItem['type'];
  choices: Record<string, string> | null;
  correct_answer: string;
  match_type: EvalItem['match_type'] | null;
  category: string | null;
  origin: 'human' | 'ai_generated';
  generation_context: AuthoredEvalItem['generation_context'] | null;
};

async function getStorageMode(): Promise<{ storageMode: StorageMode; databaseError?: string }> {
  const dbState = await checkDatabaseConnection();
  return {
    storageMode: dbState.connected ? 'database' : 'memory',
    databaseError: dbState.error,
  };
}

function normalizeAuthoredItem(item: AuthoredEvalItem): AuthoredEvalItem {
  return {
    ...item,
    origin: item.origin ?? 'human',
    choices: item.type === 'multiple_choice' ? item.choices : undefined,
    match_type: item.type === 'open_ended' ? (item.match_type ?? 'contains') : undefined,
  };
}

function stripAuthoredMetadata(items: AuthoredEvalItem[]): EvalItem[] {
  return items.map(({ origin: _origin, generation_context: _generationContext, ...item }) => item);
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

function parseModelsConfig(raw: unknown): ModelSpec[] {
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('modelsConfig must be a non-empty ModelSpec[] array');
  }

  return parsed.map((entry) => ({
    provider: String((entry as Record<string, unknown>).provider),
    modelId: String((entry as Record<string, unknown>).modelId),
  })) as ModelSpec[];
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

function mapEvalSetItem(row: EvalSetItemRow): AuthoredEvalItem {
  return normalizeAuthoredItem({
    id: row.item_key,
    question: row.question,
    type: row.type,
    choices: row.choices ?? undefined,
    correct_answer: row.correct_answer,
    match_type: row.match_type ?? undefined,
    category: row.category ?? undefined,
    origin: row.origin,
    generation_context: row.generation_context ?? undefined,
  });
}

async function getEvalSetById(evalSetId: string): Promise<EvalSet | null> {
  const readPool = getReadPool();
  const setResult = await readPool.query<EvalSetRow>(
    `SELECT id, name, description, default_system_prompt, tags, created_at, updated_at
     FROM eval_sets
     WHERE id = $1`,
    [evalSetId]
  );

  if (setResult.rows.length === 0) {
    return null;
  }

  const itemsResult = await readPool.query<EvalSetItemRow>(
    `SELECT item_key, question, type, choices, correct_answer, match_type, category, origin, generation_context
     FROM eval_set_items
     WHERE eval_set_id = $1
     ORDER BY sort_order ASC, created_at ASC`,
    [evalSetId]
  );

  const row = setResult.rows[0];
  return {
    ...row,
    tags: Array.isArray(row.tags) ? row.tags : [],
    items: itemsResult.rows.map(mapEvalSetItem),
  };
}

async function saveEvalSet(evalSetId: string | null, payload: {
  name: string;
  description: string | null;
  default_system_prompt: string | null;
  tags: string[];
  items: AuthoredEvalItem[];
}): Promise<EvalSet> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const resolvedId = evalSetId ?? uuidv4();
    if (evalSetId) {
      await client.query(
        `UPDATE eval_sets
         SET name = $2, description = $3, default_system_prompt = $4, tags = $5::jsonb, updated_at = NOW()
         WHERE id = $1`,
        [
          resolvedId,
          payload.name,
          payload.description,
          payload.default_system_prompt,
          JSON.stringify(payload.tags),
        ]
      );
      await client.query('DELETE FROM eval_set_items WHERE eval_set_id = $1', [resolvedId]);
    } else {
      await client.query(
        `INSERT INTO eval_sets (id, name, description, default_system_prompt, tags)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [
          resolvedId,
          payload.name,
          payload.description,
          payload.default_system_prompt,
          JSON.stringify(payload.tags),
        ]
      );
    }

    for (const [index, item] of payload.items.entries()) {
      await client.query(
        `INSERT INTO eval_set_items
          (eval_set_id, item_key, question, type, choices, correct_answer, match_type, category, origin, generation_context, sort_order)
         VALUES
          ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10::jsonb, $11)`,
        [
          resolvedId,
          item.id,
          item.question,
          item.type,
          JSON.stringify(item.type === 'multiple_choice' ? item.choices ?? null : null),
          item.correct_answer,
          item.type === 'open_ended' ? item.match_type ?? 'contains' : null,
          item.category ?? null,
          item.origin ?? 'human',
          JSON.stringify(item.generation_context ?? null),
          index,
        ]
      );
    }

    await client.query('COMMIT');
    const saved = await getEvalSetById(resolvedId);
    if (!saved) {
      throw new Error('Failed to reload saved eval set');
    }
    return saved;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function buildGeneratedChoice(seedText: string, label: string, variantIndex: number): string {
  return `${seedText} ${label.toLowerCase()} variant ${variantIndex + 1}`;
}

function fallbackGenerateRows(
  seeds: AuthoredEvalItem[],
  count: number,
  category?: string,
  instructions?: string
): AuthoredEvalItem[] {
  const generatedAt = new Date().toISOString();
  const focusText = category?.trim() ? ` Focus on category: ${category.trim()}.` : '';
  const instructionText = instructions?.trim() ? ` Style guidance: ${instructions.trim()}.` : '';

  return Array.from({ length: count }, (_, index) => {
    const seed = seeds[index % seeds.length];
    const variant = index + 1;
    if (seed.type === 'multiple_choice') {
      const baseChoices = seed.choices ?? { A: 'Option A', B: 'Option B', C: 'Option C', D: 'Option D' };
      return normalizeAuthoredItem({
        id: `ai-${Date.now()}-${variant}`,
        question: `${seed.question} Create a similar but distinct example ${variant}.${focusText}${instructionText}`,
        type: 'multiple_choice',
        choices: {
          A: buildGeneratedChoice(baseChoices.A ?? 'Choice A', 'A', index),
          B: buildGeneratedChoice(baseChoices.B ?? 'Choice B', 'B', index),
          C: buildGeneratedChoice(baseChoices.C ?? 'Choice C', 'C', index),
          D: buildGeneratedChoice(baseChoices.D ?? 'Choice D', 'D', index),
        },
        correct_answer: seed.correct_answer,
        category: category?.trim() || seed.category,
        origin: 'ai_generated',
        generation_context: {
          sourceItemKeys: [seed.id],
          promptVersion: 'fallback-v1',
          model: 'fallback-generator',
          generatedAt,
        },
      });
    }

    return normalizeAuthoredItem({
      id: `ai-${Date.now()}-${variant}`,
      question: `${seed.question} Produce a fresh example ${variant}.${focusText}${instructionText}`,
      type: 'open_ended',
      correct_answer: `${seed.correct_answer} (variant ${variant})`,
      match_type: seed.match_type ?? 'contains',
      category: category?.trim() || seed.category,
      origin: 'ai_generated',
      generation_context: {
        sourceItemKeys: [seed.id],
        promptVersion: 'fallback-v1',
        model: 'fallback-generator',
        generatedAt,
      },
    });
  });
}

async function generateRowsWithOpenAI(
  seeds: AuthoredEvalItem[],
  count: number,
  category?: string,
  instructions?: string
): Promise<AuthoredEvalItem[]> {
  if (!process.env.OPENAI_API_KEY) {
    return fallbackGenerateRows(seeds, count, category, instructions);
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const prompt = [
    'Generate eval items as strict JSON with shape {"items": AuthoredEvalItem[]}.',
    'Each item must include: id, question, type, correct_answer.',
    'For multiple_choice items include exactly choices A, B, C, D and correct_answer as one of those keys.',
    'For open_ended items omit choices and include match_type of exact, contains, or regex when useful.',
    'Keep the task format, answer style, and difficulty aligned to the seed rows.',
    'Avoid near-duplicates and do not repeat seed wording exactly.',
    category?.trim() ? `Category focus: ${category.trim()}` : '',
    instructions?.trim() ? `Additional guidance: ${instructions.trim()}` : '',
    `Generate ${count} items.`,
    `Seed rows: ${JSON.stringify(seeds)}`,
  ].filter(Boolean).join('\n');

  const completion = await client.chat.completions.create({
    model: AI_GENERATION_MODEL,
    temperature: 0.8,
    messages: [
      {
        role: 'system',
        content: 'You create eval-set rows for benchmarking LLMs. Return JSON only.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    response_format: { type: 'json_object' },
  });

  const content = completion.choices[0]?.message?.content ?? '{}';
  const parsed = JSON.parse(content) as { items?: AuthoredEvalItem[] };
  const validated = AuthoredEvalItemArraySchema.parse(parsed.items ?? []).map((item) =>
    normalizeAuthoredItem({
      ...item,
      origin: 'ai_generated',
      generation_context: {
        ...item.generation_context,
        sourceItemKeys: item.generation_context?.sourceItemKeys?.length ? item.generation_context.sourceItemKeys : seeds.map((seed) => seed.id),
        promptVersion: item.generation_context?.promptVersion ?? 'openai-v1',
        model: item.generation_context?.model ?? AI_GENERATION_MODEL,
        generatedAt: item.generation_context?.generatedAt ?? new Date().toISOString(),
      },
    })
  );

  return validated;
}

router.get('/sets', async (_req, res) => {
  try {
    const dbState = await checkDatabaseConnection();
    if (!dbState.connected) {
      return res.json(listMemoryEvalSets());
    }

    const readPool = getReadPool();
    const result = await readPool.query<EvalSetSummary & { item_count: string }>(
      `SELECT
        s.id,
        s.name,
        s.description,
        s.tags,
        s.created_at,
        s.updated_at,
        COUNT(i.id) AS item_count
      FROM eval_sets s
      LEFT JOIN eval_set_items i ON i.eval_set_id = s.id
      GROUP BY s.id
      ORDER BY s.updated_at DESC`
    );

    return res.json(result.rows.map((row) => ({
      ...row,
      tags: Array.isArray(row.tags) ? row.tags : [],
      item_count: Number(row.item_count),
    })));
  } catch (error) {
    console.error('[routes/evals] GET /sets error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/sets', async (req, res) => {
  try {
    const dbState = await checkDatabaseConnection();
    const parsed = EvalSetPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid eval set payload', details: parsed.error.flatten() });
    }

    const payload = parsed.data;
    const normalizedPayload = {
      ...payload,
      description: payload.description?.trim() || null,
      default_system_prompt: payload.default_system_prompt?.trim() || null,
      items: payload.items.map(normalizeAuthoredItem),
    };
    const saved = dbState.connected
      ? await saveEvalSet(null, normalizedPayload)
      : saveMemoryEvalSet({ id: null, ...normalizedPayload });
    return res.status(201).json(saved);
  } catch (error) {
    console.error('[routes/evals] POST /sets error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/sets/:id', async (req, res) => {
  try {
    const dbState = await checkDatabaseConnection();
    if (!dbState.connected) {
      const memorySet = getMemoryEvalSet(req.params.id);
      if (!memorySet) {
        return res.status(404).json({ error: 'Eval set not found' });
      }
      return res.json(memorySet);
    }

    const evalSet = await getEvalSetById(req.params.id);
    if (!evalSet) {
      return res.status(404).json({ error: 'Eval set not found' });
    }

    return res.json(evalSet);
  } catch (error) {
    console.error('[routes/evals] GET /sets/:id error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/sets/:id', async (req, res) => {
  try {
    const dbState = await checkDatabaseConnection();
    const parsed = EvalSetPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid eval set payload', details: parsed.error.flatten() });
    }

    const payload = parsed.data;
    const normalizedPayload = {
      ...payload,
      description: payload.description?.trim() || null,
      default_system_prompt: payload.default_system_prompt?.trim() || null,
      items: payload.items.map(normalizeAuthoredItem),
    };

    if (!dbState.connected) {
      const existing = getMemoryEvalSet(req.params.id);
      if (!existing) {
        return res.status(404).json({ error: 'Eval set not found' });
      }
      return res.json(saveMemoryEvalSet({ id: req.params.id, ...normalizedPayload }));
    }

    const existing = await getEvalSetById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Eval set not found' });
    }

    const saved = await saveEvalSet(req.params.id, normalizedPayload);
    return res.json(saved);
  } catch (error) {
    console.error('[routes/evals] PUT /sets/:id error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/sets/:id', async (req, res) => {
  try {
    const dbState = await checkDatabaseConnection();
    if (!dbState.connected) {
      const deleted = deleteMemoryEvalSet(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: 'Eval set not found' });
      }
      return res.status(204).send();
    }

    const pool = getPool();
    const result = await pool.query('DELETE FROM eval_sets WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Eval set not found' });
    }

    return res.status(204).send();
  } catch (error) {
    console.error('[routes/evals] DELETE /sets/:id error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/sets/:id/generate', async (req, res) => {
  try {
    const dbState = await checkDatabaseConnection();
    const evalSet = dbState.connected
      ? await getEvalSetById(req.params.id)
      : getMemoryEvalSet(req.params.id);
    if (!evalSet) {
      return res.status(404).json({ error: 'Eval set not found' });
    }

    const parsed = EvalSetGenerationRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid generation payload', details: parsed.error.flatten() });
    }

    const { seedItemKeys, count, category, instructions } = parsed.data;
    const seeds = seedItemKeys.length > 0
      ? evalSet.items.filter((item) => seedItemKeys.includes(item.id))
      : evalSet.items.filter((item) => item.question.trim() && item.correct_answer.trim()).slice(0, 3);

    if (seeds.length === 0) {
      return res.status(400).json({ error: 'Select at least one valid seed row before generation.' });
    }

    let generated = await generateRowsWithOpenAI(seeds, count, category, instructions);
    generated = AuthoredEvalItemArraySchema.parse(generated).map((item) =>
      normalizeAuthoredItem({
        ...item,
        origin: 'ai_generated',
        generation_context: {
          ...item.generation_context,
          sourceItemKeys: item.generation_context?.sourceItemKeys?.length ? item.generation_context.sourceItemKeys : seeds.map((seed) => seed.id),
          generatedAt: item.generation_context?.generatedAt ?? new Date().toISOString(),
        },
      })
    );

    return res.json({
      items: generated,
      provider: process.env.OPENAI_API_KEY ? 'openai' : 'fallback',
    });
  } catch (error) {
    console.error('[routes/evals] POST /sets/:id/generate error:', error);
    return res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to generate eval rows',
    });
  }
});

router.post('/runs', upload.single('evalFile'), async (req, res) => {
  try {
    const name = req.body.name?.trim();
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    let modelsConfig: ModelSpec[];
    try {
      modelsConfig = parseModelsConfig(req.body.modelsConfig);
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid modelsConfig' });
    }

    const maxTokens = parseInt(String(req.body.maxTokens ?? '256'), 10) || 256;
    const fileBuffer = req.file?.buffer;
    const evalSetId = typeof req.body.evalSetId === 'string' && req.body.evalSetId.trim()
      ? req.body.evalSetId.trim()
      : null;
    const inlineItemsRaw = req.body.evalItems;

    let authoredItems: AuthoredEvalItem[] | null = null;
    let evalSetName: string | null = null;
    let defaultSystemPrompt: string | null = null;

    if (fileBuffer) {
      try {
        authoredItems = parseEvalItems(fileBuffer, req.body as Record<string, string>).map((item) => ({
          ...item,
          origin: 'human' as const,
        }));
      } catch (error) {
        const details = (error as Error & { details?: unknown }).details;
        return res.status(400).json({
          error: error instanceof Error ? error.message : 'Invalid eval set format',
          ...(details ? { details } : {}),
        });
      }
    } else if (evalSetId) {
      const dbState = await checkDatabaseConnection();
      const evalSet = dbState.connected
        ? await getEvalSetById(evalSetId)
        : getMemoryEvalSet(evalSetId);
      if (!evalSet) {
        return res.status(404).json({ error: 'Eval set not found' });
      }

      authoredItems = evalSet.items.map(normalizeAuthoredItem);
      evalSetName = evalSet.name;
      defaultSystemPrompt = evalSet.default_system_prompt;
    } else if (inlineItemsRaw) {
      try {
        const inlineItems = typeof inlineItemsRaw === 'string' ? JSON.parse(inlineItemsRaw) : inlineItemsRaw;
        authoredItems = AuthoredEvalItemArraySchema.parse(inlineItems).map(normalizeAuthoredItem);
      } catch (error) {
        return res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid evalItems payload' });
      }
    } else {
      return res.status(400).json({ error: 'Provide one of evalFile, evalSetId, or evalItems.' });
    }

    const evalSet = stripAuthoredMetadata(authoredItems);
    const systemPrompt = req.body.systemPrompt?.trim() || defaultSystemPrompt || '';

    const { storageMode, databaseError } = await getStorageMode();
    const runId = uuidv4();
    const createdAt = new Date().toISOString();
    const run: EvalRun = {
      id: runId,
      name,
      system_prompt: systemPrompt || null,
      eval_set_filename: req.file?.originalname ?? (evalSetId ? `${evalSetName ?? 'saved-eval-set'}.ui` : null),
      eval_set_id: evalSetId,
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
        `INSERT INTO eval_runs (id, name, system_prompt, eval_set_filename, eval_set_id, eval_set_data, models_config, status)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, 'pending')`,
        [
          run.id,
          run.name,
          run.system_prompt,
          run.eval_set_filename,
          run.eval_set_id ?? null,
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

    const readPool = getReadPool();
    const result = await readPool.query<EvalRunSummary>(`
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

    const readPool = getReadPool();
    const runResult = await readPool.query<EvalRun>('SELECT * FROM eval_runs WHERE id = $1', [req.params.id]);
    if (runResult.rows.length === 0) {
      return res.status(404).json({ error: 'Run not found' });
    }

    const resultsResult = await readPool.query(
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
  const databaseConfig = resolveDatabaseConfig();

  return res.json({
    localModels,
    ollamaModels,
    apiProviders,
    runtime: {
      databaseConnected: dbState.connected,
      storageMode: dbState.connected ? 'database' : 'memory',
      databaseError: dbState.error && !isProd ? dbState.error : null,
      databaseConfig: {
        configured: databaseConfig.configured,
        source: databaseConfig.source,
        label: databaseConfig.label,
        envKeys: databaseConfig.envKeys,
        connectionString: databaseConfig.redactedConnectionString,
        sslEnabled: databaseConfig.sslEnabled,
        readReplicaConfigured: Boolean(process.env.DATABASE_READ_URL),
      },
    },
  });
});

export default router;
