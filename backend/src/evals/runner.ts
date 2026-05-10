import { v4 as uuidv4 } from 'uuid';
import { getPool } from '../db/connection.js';
import { scoreAnswer } from './scorer.js';
import { broadcast, cleanup } from './sseManager.js';
import { addMemoryResult, updateMemoryRunStatus } from './fallbackStore.js';
import { openaiAdapter } from './adapters/openai.js';
import { anthropicAdapter } from './adapters/anthropic.js';
import { geminiAdapter } from './adapters/gemini.js';
import { groqAdapter } from './adapters/groq.js';
import { mistralAdapter } from './adapters/mistral.js';
import { cohereAdapter } from './adapters/cohere.js';
import { togetherAdapter } from './adapters/togetherai.js';
import { localAdapter } from './adapters/local.js';
import { ollamaAdapter } from './adapters/ollama.js';
import { mockAdapter } from './adapters/mock.js';
import type { EvalItem, ModelSpec, RunConfig, EvalResult, RunStatus, StorageMode } from '../shared/evalTypes.js';
import type { ModelAdapter } from './adapters/types.js';

function getAdapter(model: ModelSpec): ModelAdapter {
  switch (model.provider) {
    case 'openai': return openaiAdapter;
    case 'anthropic': return anthropicAdapter;
    case 'gemini': return geminiAdapter;
    case 'groq': return groqAdapter;
    case 'mistral': return mistralAdapter;
    case 'cohere': return cohereAdapter;
    case 'togetherai': return togetherAdapter;
    case 'local': return localAdapter;
    case 'ollama': return ollamaAdapter;
    case 'mock': 
      if (process.env.NODE_ENV === 'production' && process.env.MOCK_ENABLED !== 'true') {
        throw new Error('Mock provider is disabled in production');
      }
      return mockAdapter;
    default:
      throw new Error(`Unknown provider: ${(model as { provider: string }).provider}`);
  }
}

async function updateRunStatus(
  runId: string,
  storageMode: StorageMode,
  status: RunStatus,
  completedAt?: Date
): Promise<void> {
  if (storageMode === 'memory') {
    updateMemoryRunStatus(runId, status, completedAt);
    return;
  }

  const pool = getPool();
  if (completedAt) {
    await pool.query(
      'UPDATE eval_runs SET status = $1, completed_at = $2 WHERE id = $3',
      [status, completedAt.toISOString(), runId]
    );
    return;
  }

  await pool.query('UPDATE eval_runs SET status = $1 WHERE id = $2', [status, runId]);
}

async function saveResult(
  runId: string,
  storageMode: StorageMode,
  modelId: string,
  item: EvalItem,
  rawOutput: string,
  isCorrect: boolean,
  latencyMs: number,
  tokensUsed: number
): Promise<EvalResult> {
  const id = uuidv4();

  if (storageMode === 'memory') {
    return addMemoryResult({
      id,
      run_id: runId,
      model_id: modelId,
      question_id: item.id,
      category: item.category ?? null,
      model_output: rawOutput,
      correct_answer: item.correct_answer,
      is_correct: isCorrect,
      error_type: isCorrect ? null : 'wrong_answer',
      latency_ms: latencyMs,
      tokens_used: tokensUsed,
      created_at: new Date().toISOString(),
    });
  }

  const pool = getPool();
  const result = await pool.query<EvalResult>(
    `INSERT INTO eval_results
       (id, run_id, model_id, question_id, category, model_output, correct_answer,
        is_correct, error_type, latency_ms, tokens_used)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      id,
      runId,
      modelId,
      item.id,
      item.category ?? null,
      rawOutput,
      item.correct_answer,
      isCorrect,
      isCorrect ? null : 'wrong_answer',
      latencyMs,
      tokensUsed,
    ]
  );

  return result.rows[0];
}

async function saveErrorResult(
  runId: string,
  storageMode: StorageMode,
  modelId: string,
  item: EvalItem,
  error: unknown
): Promise<EvalResult> {
  const id = uuidv4();
  const errorMessage = error instanceof Error ? error.message : String(error);

  if (storageMode === 'memory') {
    return addMemoryResult({
      id,
      run_id: runId,
      model_id: modelId,
      question_id: item.id,
      category: item.category ?? null,
      model_output: errorMessage,
      correct_answer: item.correct_answer,
      is_correct: false,
      error_type: 'runtime_error',
      latency_ms: null,
      tokens_used: null,
      created_at: new Date().toISOString(),
    });
  }

  const pool = getPool();
  const result = await pool.query<EvalResult>(
    `INSERT INTO eval_results
       (id, run_id, model_id, question_id, category, model_output, correct_answer,
        is_correct, error_type, latency_ms, tokens_used)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      id,
      runId,
      modelId,
      item.id,
      item.category ?? null,
      errorMessage,
      item.correct_answer,
      false,
      'runtime_error',
      null,
      null,
    ]
  );

  return result.rows[0];
}

async function runQuestion(
  runId: string,
  storageMode: StorageMode,
  model: ModelSpec,
  item: EvalItem,
  systemPrompt: string,
  maxTokens: number
): Promise<void> {
  const adapter = getAdapter(model);

  try {
    const response = await adapter(model.modelId, {
      systemPrompt,
      question: item.question,
      choices: item.choices,
      maxTokens,
    });
    const isCorrect = scoreAnswer(item, response.rawOutput);
    const result = await saveResult(
      runId,
      storageMode,
      model.modelId,
      item,
      response.rawOutput,
      isCorrect,
      response.latencyMs,
      response.tokensUsed
    );
    broadcast(runId, 'question_result', result);
  } catch (error) {
    console.error(`[runner] Error for model=${model.modelId} question=${item.id}:`, error);
    const result = await saveErrorResult(runId, storageMode, model.modelId, item, error);
    broadcast(runId, 'question_result', result);
  }
}

export async function retryEvalErrors(
  runId: string,
  modelErrors: Array<{ model: ModelSpec; items: EvalItem[] }>,
  systemPrompt: string,
  maxTokens: number,
  storageMode: StorageMode
): Promise<void> {
  try {
    await updateRunStatus(runId, storageMode, 'running');
    await new Promise<void>((resolve) => setTimeout(resolve, 800));

    const apiEntries = modelErrors.filter(({ model }) => model.provider !== 'local' && model.provider !== 'ollama');
    const localEntries = modelErrors.filter(({ model }) => model.provider === 'local' || model.provider === 'ollama');

    if (apiEntries.length > 0) {
      const apiJobs = apiEntries.flatMap(({ model, items }) =>
        items.map((item) => runQuestion(runId, storageMode, model, item, systemPrompt, maxTokens))
      );
      await Promise.allSettled(apiJobs);
    }

    for (const { model, items } of localEntries) {
      for (const item of items) {
        await runQuestion(runId, storageMode, model, item, systemPrompt, maxTokens);
      }
    }

    await updateRunStatus(runId, storageMode, 'completed', new Date());
    broadcast(runId, 'run_complete', { runId, status: 'completed' });
  } catch (error) {
    console.error(`[runner] Fatal error during retry for run ${runId}:`, error);
    await updateRunStatus(runId, storageMode, 'failed').catch(() => {});
    broadcast(runId, 'run_complete', { runId, status: 'failed' });
  } finally {
    cleanup(runId);
  }
}

export async function runEval(config: RunConfig): Promise<void> {
  const { runId, systemPrompt, evalSet, apiModels, localModels, maxTokens, storageMode } = config;

  try {
    await updateRunStatus(runId, storageMode, 'running');

    if (apiModels.length > 0) {
      const apiJobs = apiModels.flatMap((model) =>
        evalSet.map((item) => runQuestion(runId, storageMode, model, item, systemPrompt, maxTokens))
      );
      await Promise.allSettled(apiJobs);
    }

    for (const model of localModels) {
      for (const item of evalSet) {
        await runQuestion(runId, storageMode, model, item, systemPrompt, maxTokens);
      }
    }

    await updateRunStatus(runId, storageMode, 'completed', new Date());
    broadcast(runId, 'run_complete', { runId, status: 'completed' });
  } catch (error) {
    console.error(`[runner] Fatal error for run ${runId}:`, error);
    await updateRunStatus(runId, storageMode, 'failed').catch(() => {});
    broadcast(runId, 'run_complete', { runId, status: 'failed' });
  } finally {
    cleanup(runId);
  }
}
