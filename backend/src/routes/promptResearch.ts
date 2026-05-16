import { Router, type Response } from 'express';
import { z } from 'zod';
import { checkDatabaseConnection } from '../db/connection.js';
import { runResearch } from '../evals/promptResearchRunner.js';
import {
  createResearchRun,
  getResearchRunDetailAny,
  listResearchRuns,
  promoteResearchRun,
} from '../evals/promptResearchStore.js';
import { getMemoryEvalSet } from '../evals/fallbackStore.js';
import { addClient, removeClient } from '../evals/sseManager.js';
import { isHostedProvider, resolveMaxTokenBudget } from '../evals/researchBudget.js';
import type { EvalItem, ModelSpec, StorageMode } from '../shared/evalTypes.js';

const router = Router();

async function getStorageMode(): Promise<{ storageMode: StorageMode; databaseError?: string }> {
  const dbState = await checkDatabaseConnection();
  return { storageMode: dbState.connected ? 'database' : 'memory', databaseError: dbState.error };
}

const ModelSpecSchema = z.object({
  provider: z.enum(['openai', 'anthropic', 'gemini', 'groq', 'mistral', 'cohere', 'togetherai', 'local', 'ollama', 'mock']),
  modelId: z.string().min(1),
});

const EvalItemSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  type: z.enum(['multiple_choice', 'open_ended']),
  choices: z.record(z.string()).optional(),
  correct_answer: z.string().min(1),
  match_type: z.enum(['exact', 'contains', 'regex']).optional(),
  category: z.string().optional(),
});

const CreateResearchRunSchema = z.object({
  name: z.string().min(1),
  evalSetId: z.string().uuid().optional(),
  evalItems: z.array(EvalItemSchema).min(1).optional(),
  basePrompt: z.string().default(''),
  targetModel: ModelSpecSchema,
  researchModel: ModelSpecSchema,
  maxIterations: z.number().int().min(1).max(50).default(5),
  candidateCountPerIteration: z.number().int().min(1).max(3).default(1),
  holdoutEnabled: z.boolean().default(true),
  earlyStopK: z.number().int().min(1).max(20).default(5),
  maxTokens: z.number().int().min(16).max(2048).default(256),
  maxTokenBudget: z.number().int().min(10_000).max(2_000_000).optional(),
  researchSpec: z.string().optional(),
  consentAcknowledged: z.boolean().default(false),
}).refine(
  (d) => d.evalSetId != null || (d.evalItems != null && d.evalItems.length > 0),
  { message: 'Either evalSetId or evalItems is required' }
);

// POST /api/evals/prompt-research
router.post('/', async (req, res) => {
  const parsed = CreateResearchRunSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
  }

  const data = parsed.data;
  const isHostedResearch = isHostedProvider(data.researchModel.provider);
  const isHostedTarget = isHostedProvider(data.targetModel.provider);

  if ((isHostedResearch || isHostedTarget) && !data.consentAcknowledged) {
    return res.status(400).json({
      error: 'consent_required',
      message: 'You must acknowledge that eval data will be sent to a hosted model provider.',
    });
  }

  // Resolve eval items
  let evalItems: EvalItem[];
  if (data.evalItems && data.evalItems.length > 0) {
    evalItems = data.evalItems as EvalItem[];
  } else if (data.evalSetId) {
    // Try memory store first, then DB
    const memSet = getMemoryEvalSet(data.evalSetId);
    if (memSet) {
      evalItems = memSet.items as EvalItem[];
    } else {
      try {
        const { getPool } = await import('../db/connection.js');
        const pool = getPool();
        const setResult = await pool.query('SELECT * FROM eval_sets WHERE id = $1', [data.evalSetId]);
        if (setResult.rows.length === 0) {
          return res.status(404).json({ error: 'Eval set not found' });
        }
        const itemsResult = await pool.query(
          'SELECT * FROM eval_set_items WHERE eval_set_id = $1 ORDER BY sort_order',
          [data.evalSetId]
        );
        evalItems = itemsResult.rows.map((row: any) => ({
          id: row.item_key,
          question: row.question,
          type: row.type,
          choices: row.choices ?? undefined,
          correct_answer: row.correct_answer,
          match_type: row.match_type ?? undefined,
          category: row.category ?? undefined,
        }));
      } catch (err) {
        console.error('[prompt-research] DB lookup failed:', err);
        return res.status(500).json({ error: 'Failed to load eval set' });
      }
    }
  } else {
    return res.status(400).json({ error: 'No eval items provided' });
  }

  if (evalItems.length === 0) {
    return res.status(400).json({ error: 'Eval set is empty' });
  }

  const { storageMode } = await getStorageMode();

  const maxTokenBudget = resolveMaxTokenBudget({
    requested: data.maxTokenBudget,
    evalItemCount: evalItems.length,
    maxIterations: data.maxIterations,
    candidateCountPerIteration: data.candidateCountPerIteration,
    maxTokens: data.maxTokens,
    holdoutEnabled: data.holdoutEnabled,
    targetModel: data.targetModel,
    researchModel: data.researchModel,
  });

  const DEFAULT_RESEARCH_SPEC = `
Optimize the system prompt to maximize accuracy on the evaluation task.
Analyze the failing questions to identify patterns in what the model gets wrong.

When writing a revised prompt:
1. Be specific about the task format and expected response style
2. Address patterns you see in the failures
3. For multiple choice, explicitly instruct the model to answer with only the letter (A/B/C/D)
4. For open-ended, specify the exact format expected
5. Keep the prompt concise — avoid over-engineering
`.trim();

  let run;
  try {
    run = await createResearchRun({
      name: data.name,
      evalSetData: evalItems,
      sourceEvalSetId: data.evalSetId ?? null,
      basePrompt: data.basePrompt,
      researchSpec: data.researchSpec ?? DEFAULT_RESEARCH_SPEC,
      researchModelProvider: data.researchModel.provider,
      researchModelId: data.researchModel.modelId,
      targetModelsConfig: [data.targetModel] as ModelSpec[],
      maxIterations: data.maxIterations,
      candidateCountPerIteration: data.candidateCountPerIteration,
      sampleSize: null,
      holdoutEnabled: data.holdoutEnabled,
      earlyStopK: data.earlyStopK,
      maxTokenBudget,
      storageMode,
    });
  } catch (err) {
    console.error('[prompt-research] Create failed:', err);
    return res.status(500).json({ error: 'Failed to create research run' });
  }

  // Fire research loop async
  setImmediate(() => {
    runResearch({
      researchRunId: run.id,
      evalItems,
      basePrompt: data.basePrompt,
      targetModel: data.targetModel as ModelSpec,
      researchModelProvider: data.researchModel.provider,
      researchModelId: data.researchModel.modelId,
      maxIterations: data.maxIterations,
      candidateCountPerIteration: data.candidateCountPerIteration,
      holdoutEnabled: data.holdoutEnabled,
      earlyStopK: data.earlyStopK,
      maxTokens: data.maxTokens,
      maxTokenBudget,
      researchSpec: data.researchSpec ?? DEFAULT_RESEARCH_SPEC,
      storageMode,
    }).catch((err) => {
      console.error(`[prompt-research:${run.id}] Unhandled error:`, err);
    });
  });

  return res.status(202).json({
    researchRunId: run.id,
    status: 'queued',
    storageMode,
    maxTokenBudget,
  });
});

// GET /api/evals/prompt-research
router.get('/', async (_req, res) => {
  const { storageMode } = await getStorageMode();
  try {
    const runs = await listResearchRuns(storageMode);
    return res.json(runs);
  } catch (err) {
    console.error('[prompt-research] List failed:', err);
    return res.status(500).json({ error: 'Failed to list research runs' });
  }
});

// GET /api/evals/prompt-research/:id
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const detail = await getResearchRunDetailAny(id);
    if (!detail) return res.status(404).json({ error: 'Research run not found' });
    return res.json(detail);
  } catch (err) {
    console.error('[prompt-research] Get failed:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/evals/prompt-research/:id/stream
router.get('/:id/stream', (req, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(': connected\n\n');

  const { id } = req.params;
  addClient(id, res);

  req.on('close', () => {
    removeClient(id, res);
  });
});

// POST /api/evals/prompt-research/:id/promote
router.post('/:id/promote', async (req, res) => {
  const { id } = req.params;

  const detail = await getResearchRunDetailAny(id);
  if (!detail) return res.status(404).json({ error: 'Research run not found' });
  if (detail.status !== 'completed') {
    return res.status(400).json({ error: 'Research run must be completed before promoting' });
  }

  await promoteResearchRun(id, detail.storage_mode);
  return res.json({ promoted: true, bestPrompt: detail.best_prompt });
});

export default router;
