import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Database, FileText, FlaskConical, Radio, RefreshCw } from 'lucide-react';
import { useEvalStore } from '../store/useEvalStore';
import { evalService } from '../services/api';
import { useEvalStream } from '../hooks/useEvalStream';
import { ComparisonTable } from '../components/evals/ComparisonTable';
import { ModelDrilldown } from '../components/evals/ModelDrilldown';
import { RunProgress } from '../components/evals/RunProgress';
import { Badge } from '../components/ui/badge';
import { cn } from '../lib/utils';

const STATUS_STYLES: Record<string, string> = {
  completed: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100',
  running: 'border-cyan-400/20 bg-cyan-400/10 text-cyan-100',
  failed: 'border-red-400/20 bg-red-400/10 text-red-100',
  pending: 'border-amber-300/20 bg-amber-300/10 text-amber-100',
};

type EvalSetItem = {
  id?: string;
  question?: string;
  type?: string;
  choices?: Record<string, string>;
  correct_answer?: string;
  category?: string;
};

export default function EvalResults() {
  const { id: runId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    activeRun,
    setActiveRun,
    setResults,
    clearResults,
    results,
    loading,
    setLoading,
    setError,
    runtimeStatus,
  } = useEvalStore();
  const [drilldownModelId, setDrilldownModelId] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const isLive = activeRun?.status === 'running' || activeRun?.status === 'pending';
  useEvalStream(isLive && runId ? runId : null);

  const runResults = useMemo(
    () => Object.values(results).filter((result) => result.run_id === runId),
    [results, runId]
  );
  const runtimeErrorCount = runResults.filter((result) => result.error_type === 'runtime_error').length;
  const evalSetItems = useMemo(
    () => Array.isArray(activeRun?.eval_set_data) ? activeRun.eval_set_data as EvalSetItem[] : [],
    [activeRun]
  );
  const correctCount = runResults.filter((result) => result.is_correct === true).length;
  const scoredCount = runResults.filter((result) => result.is_correct != null).length;
  const overallAccuracy = scoredCount > 0 ? Math.round((correctCount / scoredCount) * 1000) / 10 : null;

  useEffect(() => {
    let cancelled = false;

    if (!runId) {
      return;
    }

    clearResults();
    setError(null);

    setLoading(true);
    evalService.getRun(runId)
      .then((response) => {
        if (cancelled) {
          return;
        }
        setActiveRun(response.run);
        setResults(response.results);
      })
      .catch((error) => {
        if (!cancelled) {
          setError(error.message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [runId, clearResults, setActiveRun, setError, setLoading, setResults]);

  async function handleRetryErrors() {
    if (!runId) {
      return;
    }

    setRetrying(true);
    try {
      await evalService.retryErrors(runId);
      navigate(0);
    } catch (error: any) {
      setError(error.message ?? 'Failed to retry errors');
      setRetrying(false);
    }
  }

  if (loading) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 py-10 space-y-4">
          {[...Array(4)].map((_, index) => (
            <div key={index} className="h-16 rounded-2xl shimmer" />
          ))}
        </div>
      </div>
    );
  }

  if (!activeRun) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 py-10">
          <div className="rounded-[1.8rem] border border-white/10 bg-white/[0.03] p-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 text-amber-300" />
              <div>
                <p className="font-semibold text-slate-100">
                  {runtimeStatus.storageMode === 'memory'
                    ? 'No cached local run found in the current UI session.'
                    : 'Run not found.'}
                </p>
                <p className="mt-2 text-sm text-slate-400">
                  {runtimeStatus.storageMode === 'memory'
                    ? 'When Postgres is down, runs only stay visible if this page was opened directly after launch or the server can still serve the in-memory run.'
                    : 'The run may have been deleted or the identifier is wrong.'}
                </p>
                <button
                  onClick={() => navigate('/evals')}
                  className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-cyan-200 hover:text-cyan-100"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to runs
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const totalQuestions = (activeRun.eval_set_data as unknown[]).length;
  const storageLabel = activeRun.storage_mode === 'memory' ? 'local memory' : 'database-backed';

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-10 space-y-6">
        <button
          className="inline-flex items-center gap-2 text-sm font-medium text-slate-400 transition-colors hover:text-slate-100"
          onClick={() => navigate('/evals')}
        >
          <ArrowLeft className="h-4 w-4" />
          All runs
        </button>

        <section className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-6 shadow-card backdrop-blur-xl">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="mb-3 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-300/10">
                  <FlaskConical className="h-4 w-4 text-cyan-200" />
                </div>
                <Badge className={cn('rounded-full border px-2.5 py-1 text-[11px] font-semibold', STATUS_STYLES[activeRun.status] ?? '')}>
                  {isLive && <Radio className="mr-1 h-3 w-3 animate-pulse" />}
                  {activeRun.status}
                </Badge>
                <Badge className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-semibold text-slate-200">
                  {storageLabel}
                </Badge>
              </div>
              <h1 className="truncate text-2xl font-bold tracking-tight text-slate-100">{activeRun.name}</h1>
              <p className="mt-2 text-sm text-slate-400">
                Created {new Date(activeRun.created_at).toLocaleString()} · {activeRun.models_config.length} model{activeRun.models_config.length !== 1 ? 's' : ''} · {totalQuestions} question{totalQuestions !== 1 ? 's' : ''}
              </p>
            </div>

            {!isLive && runtimeErrorCount > 0 && (
              <button
                onClick={handleRetryErrors}
                disabled={retrying}
                className="inline-flex items-center gap-2 rounded-full border border-amber-300/20 bg-amber-300/10 px-4 py-2 text-xs font-semibold text-amber-100 transition-colors hover:bg-amber-300/15 disabled:opacity-50"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', retrying && 'animate-spin')} />
                Retry {runtimeErrorCount} runtime error{runtimeErrorCount !== 1 ? 's' : ''}
              </button>
            )}
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
              <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Eval file</p>
              <p className="mt-3 flex items-center gap-2 text-sm font-medium text-slate-100">
                <FileText className="h-4 w-4 text-slate-400" />
                {activeRun.eval_set_filename ?? 'inline dataset'}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
              <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Persistence</p>
              <p className="mt-3 flex items-center gap-2 text-sm font-medium text-slate-100">
                <Database className="h-4 w-4 text-slate-400" />
                {activeRun.storage_mode === 'memory' ? 'Server memory only' : 'Stored in Postgres'}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
              <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">System prompt</p>
              <p className="mt-3 text-sm font-medium text-slate-100">
                {activeRun.system_prompt?.trim() ? 'Provided' : 'None'}
              </p>
            </div>
          </div>

          {activeRun.storage_mode === 'memory' && (
            <div className="mt-5 rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
              This run is in local memory mode. It survives only while the current server session stays alive.
            </div>
          )}
        </section>

        {isLive && (
          <section className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-5 shadow-card backdrop-blur-xl">
            <div className="mb-4 flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-300 opacity-60" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-cyan-300" />
              </span>
              <h2 className="text-sm font-semibold text-slate-100">Live progress</h2>
              <span className="text-xs text-slate-500">Results stream in as each question finishes.</span>
            </div>
            <RunProgress runId={activeRun.id} models={activeRun.models_config} totalQuestions={totalQuestions} />
          </section>
        )}

        <section className="grid gap-4 md:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Questions</p>
            <p className="mt-3 text-2xl font-bold text-slate-100">{totalQuestions}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Results</p>
            <p className="mt-3 text-2xl font-bold text-slate-100">{runResults.length}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Correct</p>
            <p className="mt-3 text-2xl font-bold text-slate-100">{correctCount}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Accuracy</p>
            <p className="mt-3 text-2xl font-bold text-slate-100">{overallAccuracy != null ? `${overallAccuracy}%` : 'N/A'}</p>
          </div>
        </section>

        <section className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-5 shadow-card backdrop-blur-xl">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Dataset</h2>
              <p className="mt-1 text-xs text-slate-500">Exact eval rows used for this run.</p>
            </div>
            <div className="text-xs text-slate-500">{evalSetItems.length} row{evalSetItems.length !== 1 ? 's' : ''}</div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-white/10">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-slate-950/50">
                <tr className="text-left text-xs uppercase tracking-[0.2em] text-slate-500">
                  <th className="p-3">Id</th>
                  <th className="p-3">Question</th>
                  <th className="p-3">Expected</th>
                  <th className="p-3">Category</th>
                </tr>
              </thead>
              <tbody>
                {evalSetItems.map((item, index) => (
                  <tr key={`${item.id ?? 'row'}-${index}`} className="border-t border-white/10 align-top">
                    <td className="p-3 text-slate-300">{item.id ?? `row-${index + 1}`}</td>
                    <td className="p-3 text-slate-200">
                      <div className="space-y-2">
                        <div>{item.question ?? 'N/A'}</div>
                        {item.type === 'multiple_choice' && item.choices ? (
                          <div className="text-xs text-slate-500">
                            {(['A', 'B', 'C', 'D'] as const)
                              .filter((key) => item.choices?.[key])
                              .map((key) => `${key}: ${item.choices?.[key]}`)
                              .join(' | ')}
                          </div>
                        ) : null}
                      </div>
                    </td>
                    <td className="p-3 text-slate-300">{item.correct_answer ?? 'N/A'}</td>
                    <td className="p-3 text-slate-400">{item.category ?? 'N/A'}</td>
                  </tr>
                ))}
                {evalSetItems.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-8 text-center text-slate-500">No dataset rows available for this run.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-5 shadow-card backdrop-blur-xl">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Comparison</h2>
              <p className="mt-1 text-xs text-slate-500">Accuracy, latency, token spend, and category breakdowns. Click a model header for question-level detail.</p>
            </div>
            <div className="text-xs text-slate-500">{runResults.length} result{runResults.length !== 1 ? 's' : ''} received</div>
          </div>
          <ComparisonTable runId={activeRun.id} models={activeRun.models_config} onDrilldown={(modelId) => setDrilldownModelId(modelId)} />
        </section>

        {drilldownModelId && runId && (
          <ModelDrilldown runId={runId} modelId={drilldownModelId} onClose={() => setDrilldownModelId(null)} />
        )}
      </div>
    </div>
  );
}
