import type { EvalResult, EvalRun, EvalRunSummary, ModelSpec, RunStatus, StorageMode } from '../shared/evalTypes.js';

const runs = new Map<string, EvalRun>();
const results = new Map<string, EvalResult[]>();

function sortByNewest<T extends { created_at: string }>(items: T[]): T[] {
  return items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export function createMemoryRun(run: EvalRun): EvalRun {
  const storedRun: EvalRun = { ...run, storage_mode: 'memory' };
  runs.set(storedRun.id, storedRun);
  results.set(storedRun.id, []);
  return storedRun;
}

export function listMemoryRuns(): EvalRunSummary[] {
  return sortByNewest(
    Array.from(runs.values()).map((run) => ({
      id: run.id,
      name: run.name,
      status: run.status,
      model_count: run.models_config.length,
      created_at: run.created_at,
      completed_at: run.completed_at,
      storage_mode: 'memory' as StorageMode,
    }))
  );
}

export function getMemoryRun(runId: string): EvalRun | null {
  return runs.get(runId) ?? null;
}

export function getMemoryRunDetail(runId: string): { run: EvalRun; results: EvalResult[] } | null {
  const run = runs.get(runId);
  if (!run) {
    return null;
  }

  return {
    run,
    results: [...(results.get(runId) ?? [])],
  };
}

export function updateMemoryRunStatus(runId: string, status: RunStatus, completedAt?: Date): void {
  const run = runs.get(runId);
  if (!run) {
    return;
  }

  runs.set(runId, {
    ...run,
    status,
    completed_at: completedAt ? completedAt.toISOString() : run.completed_at,
  });
}

export function addMemoryResult(result: EvalResult): EvalResult {
  const runResults = results.get(result.run_id) ?? [];
  runResults.push(result);
  results.set(result.run_id, runResults);
  return result;
}

export function listMemoryRuntimeErrors(runId: string): Array<{ modelId: string; questionId: string }> {
  return (results.get(runId) ?? [])
    .filter((result) => result.error_type === 'runtime_error')
    .map((result) => ({
      modelId: result.model_id,
      questionId: result.question_id,
    }));
}

export function deleteMemoryRuntimeErrors(runId: string): void {
  const remaining = (results.get(runId) ?? []).filter((result) => result.error_type !== 'runtime_error');
  results.set(runId, remaining);
}

export function hasMemoryRun(runId: string): boolean {
  return runs.has(runId);
}

export function getMemoryModelsConfig(runId: string): ModelSpec[] {
  return runs.get(runId)?.models_config ?? [];
}
