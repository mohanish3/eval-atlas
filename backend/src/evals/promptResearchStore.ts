import { v4 as uuidv4 } from 'uuid';
import { getPool } from '../db/connection.js';
import type {
  EvalItem,
  ModelSpec,
  PromptResearchRun,
  PromptResearchRunDetail,
  PromptResearchTrial,
  ResearchRunStatus,
  StorageMode,
} from '../shared/evalTypes.js';

// ─── In-memory fallback ──────────────────────────────────────────────────────

const memRuns = new Map<string, PromptResearchRun>();
const memTrials = new Map<string, PromptResearchTrial[]>();

// ─── Create ──────────────────────────────────────────────────────────────────

export async function createResearchRun(params: {
  name: string;
  evalSetData: EvalItem[];
  sourceEvalSetId: string | null;
  basePrompt: string;
  researchSpec: string;
  researchModelProvider: string;
  researchModelId: string;
  targetModelsConfig: ModelSpec[];
  maxIterations: number;
  candidateCountPerIteration: number;
  sampleSize: number | null;
  holdoutEnabled: boolean;
  earlyStopK: number;
  maxTokenBudget: number | null;
  storageMode: StorageMode;
}): Promise<PromptResearchRun> {
  const id = uuidv4();
  const now = new Date().toISOString();

  const run: PromptResearchRun = {
    id,
    name: params.name,
    eval_run_id: null,
    source_eval_set_id: params.sourceEvalSetId,
    eval_set_data: params.evalSetData,
    base_prompt: params.basePrompt,
    best_prompt: null,
    research_spec: params.researchSpec,
    research_model_provider: params.researchModelProvider,
    research_model_id: params.researchModelId,
    target_models_config: params.targetModelsConfig,
    optimization_metric: 'accuracy',
    status: 'queued',
    storage_mode: params.storageMode,
    max_iterations: params.maxIterations,
    candidate_count_per_iteration: params.candidateCountPerIteration,
    sample_size: params.sampleSize,
    holdout_enabled: params.holdoutEnabled,
    early_stop_k: params.earlyStopK,
    max_token_budget: params.maxTokenBudget,
    baseline_accuracy: null,
    best_accuracy: null,
    promoted_at: null,
    created_at: now,
    completed_at: null,
  };

  if (params.storageMode === 'memory') {
    memRuns.set(id, run);
    memTrials.set(id, []);
    return run;
  }

  const pool = getPool();
  await pool.query(
    `INSERT INTO prompt_research_runs
     (id, name, source_eval_set_id, eval_set_data, base_prompt, research_spec,
      research_model_provider, research_model_id, target_models_config,
      max_iterations, candidate_count_per_iteration, sample_size,
      holdout_enabled, early_stop_k, max_token_budget, storage_mode, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [
      id,
      params.name,
      params.sourceEvalSetId,
      JSON.stringify(params.evalSetData),
      params.basePrompt,
      params.researchSpec,
      params.researchModelProvider,
      params.researchModelId,
      JSON.stringify(params.targetModelsConfig),
      params.maxIterations,
      params.candidateCountPerIteration,
      params.sampleSize,
      params.holdoutEnabled,
      params.earlyStopK,
      params.maxTokenBudget,
      params.storageMode,
      now,
    ]
  );

  return run;
}

// ─── Get ─────────────────────────────────────────────────────────────────────

export async function getResearchRunDetailAny(id: string): Promise<PromptResearchRunDetail | null> {
  // Memory check first (covers both memory-mode runs and recently-queued runs)
  const memRun = memRuns.get(id);
  if (memRun) {
    return { ...memRun, trials: [...(memTrials.get(id) ?? [])] };
  }

  // DB check
  try {
    const pool = getPool();
    const runResult = await pool.query('SELECT * FROM prompt_research_runs WHERE id = $1', [id]);
    if (runResult.rows.length === 0) return null;

    const trialsResult = await pool.query(
      'SELECT * FROM prompt_research_trials WHERE research_run_id = $1 ORDER BY iteration, created_at',
      [id]
    );

    const row = runResult.rows[0];
    return {
      ...row,
      eval_set_data: (row.eval_set_data as unknown) as EvalItem[],
      target_models_config: (row.target_models_config as unknown) as ModelSpec[],
      trials: trialsResult.rows.map((t: any) => ({
        ...t,
        target_run_snapshot: t.target_run_snapshot ?? {},
        overall_accuracy: t.overall_accuracy != null ? Number(t.overall_accuracy) : null,
        latency_ms_avg: t.latency_ms_avg != null ? Number(t.latency_ms_avg) : null,
      })),
    } as PromptResearchRunDetail;
  } catch {
    return null;
  }
}

export function hasMemoryResearchRun(id: string): boolean {
  return memRuns.has(id);
}

// ─── Update status ───────────────────────────────────────────────────────────

export async function updateResearchRunStatus(
  id: string,
  storageMode: StorageMode,
  status: ResearchRunStatus,
  extras?: {
    bestPrompt?: string;
    baselineAccuracy?: number;
    bestAccuracy?: number;
    completedAt?: Date;
  }
): Promise<void> {
  if (storageMode === 'memory') {
    const run = memRuns.get(id);
    if (!run) return;
    memRuns.set(id, {
      ...run,
      status,
      best_prompt: extras?.bestPrompt ?? run.best_prompt,
      baseline_accuracy: extras?.baselineAccuracy ?? run.baseline_accuracy,
      best_accuracy: extras?.bestAccuracy ?? run.best_accuracy,
      completed_at: extras?.completedAt ? extras.completedAt.toISOString() : run.completed_at,
    });
    return;
  }

  const pool = getPool();
  await pool.query(
    `UPDATE prompt_research_runs SET
       status = $1,
       best_prompt = COALESCE($2, best_prompt),
       baseline_accuracy = COALESCE($3, baseline_accuracy),
       best_accuracy = COALESCE($4, best_accuracy),
       completed_at = COALESCE($5, completed_at)
     WHERE id = $6`,
    [
      status,
      extras?.bestPrompt ?? null,
      extras?.baselineAccuracy ?? null,
      extras?.bestAccuracy ?? null,
      extras?.completedAt?.toISOString() ?? null,
      id,
    ]
  );
}

// ─── Save trial ──────────────────────────────────────────────────────────────

export async function saveResearchTrial(
  trial: Omit<PromptResearchTrial, 'id' | 'created_at'> & { id?: string },
  storageMode: StorageMode
): Promise<PromptResearchTrial> {
  const id = trial.id ?? uuidv4();
  const now = new Date().toISOString();
  const saved: PromptResearchTrial = { ...trial, id, created_at: now };

  if (storageMode === 'memory') {
    const list = memTrials.get(trial.research_run_id) ?? [];
    list.push(saved);
    memTrials.set(trial.research_run_id, list);
    return saved;
  }

  const pool = getPool();
  await pool.query(
    `INSERT INTO prompt_research_trials
     (id, research_run_id, iteration, candidate_prompt, mutation_summary, status,
      overall_accuracy, latency_ms_avg, tokens_used_total, runtime_error_count,
      target_run_snapshot, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      id,
      trial.research_run_id,
      trial.iteration,
      trial.candidate_prompt,
      trial.mutation_summary,
      trial.status,
      trial.overall_accuracy,
      trial.latency_ms_avg,
      trial.tokens_used_total,
      trial.runtime_error_count,
      JSON.stringify(trial.target_run_snapshot),
      now,
    ]
  );

  return saved;
}

// ─── Promote ─────────────────────────────────────────────────────────────────

export async function promoteResearchRun(id: string, storageMode: StorageMode): Promise<void> {
  const now = new Date().toISOString();

  if (storageMode === 'memory') {
    const run = memRuns.get(id);
    if (run) memRuns.set(id, { ...run, promoted_at: now });
    return;
  }

  const pool = getPool();
  await pool.query('UPDATE prompt_research_runs SET promoted_at = $1 WHERE id = $2', [now, id]);
}

// ─── List ────────────────────────────────────────────────────────────────────

export async function listResearchRuns(storageMode: StorageMode): Promise<PromptResearchRun[]> {
  if (storageMode === 'memory') {
    return Array.from(memRuns.values()).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  try {
    const pool = getPool();
    const result = await pool.query('SELECT * FROM prompt_research_runs ORDER BY created_at DESC');
    return result.rows.map((row: any) => ({
      ...row,
      eval_set_data: (row.eval_set_data as unknown) as EvalItem[],
      target_models_config: (row.target_models_config as unknown) as ModelSpec[],
      baseline_accuracy: row.baseline_accuracy != null ? Number(row.baseline_accuracy) : null,
      best_accuracy: row.best_accuracy != null ? Number(row.best_accuracy) : null,
    }));
  } catch {
    return [];
  }
}
