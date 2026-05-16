import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle, XCircle, AlertTriangle, TrendingUp, Copy, Check } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { researchService, type PromptResearchRunDetail, type PromptResearchTrial } from '../services/api';
import { useResearchStream } from '../hooks/useResearchStream';
import { cn } from '../lib/utils';

const STATUS_BADGE: Record<string, string> = {
  completed: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100',
  running: 'border-cyan-400/20 bg-cyan-400/10 text-cyan-100',
  failed: 'border-red-400/20 bg-red-400/10 text-red-100',
  queued: 'border-amber-300/20 bg-amber-300/10 text-amber-100',
  stopped: 'border-slate-400/20 bg-slate-400/10 text-slate-300',
};

const TRIAL_STATUS_STYLES: Record<string, string> = {
  keep: 'text-emerald-300',
  discard: 'text-slate-400',
  crash: 'text-red-400',
  running: 'text-cyan-300',
};

function pct(value: number | null): string {
  if (value == null) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

function TrialStatusIcon({ status }: { status: string }) {
  if (status === 'keep') return <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />;
  if (status === 'crash') return <AlertTriangle className="h-3.5 w-3.5 text-red-400" />;
  if (status === 'running') return <div className="h-3.5 w-3.5 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />;
  return <XCircle className="h-3.5 w-3.5 text-slate-500" />;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button onClick={handleCopy} className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-xs text-slate-400 hover:text-slate-100 transition-colors flex items-center gap-1">
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

export default function EvalResearch() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [run, setRun] = useState<PromptResearchRunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [promoting, setPromoting] = useState(false);
  const [promoted, setPromoted] = useState(false);

  const isLive = run?.status === 'running' || run?.status === 'queued';
  const streamState = useResearchStream(id ?? null, isLive ?? false);

  // Merge SSE live trials with loaded trials for display
  const loadedTrials: PromptResearchTrial[] = run?.trials ?? [];
  const liveOnlyTrials = streamState.liveTrials.filter(
    (lt) => !loadedTrials.some((t) => t.id === lt.trialId)
  );

  const allTrials = [
    ...loadedTrials,
    ...liveOnlyTrials.map((lt) => ({
      id: lt.trialId,
      research_run_id: id!,
      iteration: lt.iteration,
      candidate_prompt: lt.candidatePrompt ?? '',
      mutation_summary: lt.mutationSummary,
      status: lt.status as any,
      overall_accuracy: lt.overallAccuracy,
      latency_ms_avg: lt.latencyMsAvg,
      tokens_used_total: lt.tokensUsedTotal,
      runtime_error_count: null,
      target_run_snapshot: {},
      created_at: new Date().toISOString(),
    })),
  ];

  const baselineAccuracy = run?.baseline_accuracy ?? (streamState.baselineAccuracy != null ? streamState.baselineAccuracy : null);
  const bestAccuracy = run?.best_accuracy ?? (streamState.bestAccuracy != null ? streamState.bestAccuracy : null);
  const delta = (baselineAccuracy != null && bestAccuracy != null) ? bestAccuracy - baselineAccuracy : null;
  const bestPrompt = run?.best_prompt ?? null;
  const currentIteration = Math.max(0, ...allTrials.map((t) => t.iteration));

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const data = await researchService.get(id!);
        if (!cancelled) {
          setRun(data);
          setPromoted(data.promoted_at != null);
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message ?? 'Failed to load research run');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [id]);

  // Refresh once SSE signals completion
  useEffect(() => {
    if (streamState.completed && id) {
      researchService.get(id).then(setRun).catch(() => {});
    }
  }, [streamState.completed, id]);

  async function handlePromote() {
    if (!id) return;
    setPromoting(true);
    try {
      await researchService.promote(id);
      setPromoted(true);
      setRun((prev) => prev ? { ...prev, promoted_at: new Date().toISOString() } : prev);
    } finally {
      setPromoting(false);
    }
  }

  if (loading) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-7xl px-4 py-8">
          <div className="space-y-4">
            {[...Array(4)].map((_, i) => <div key={i} className="h-24 rounded-2xl shimmer" />)}
          </div>
        </div>
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-7xl px-4 py-8">
          <div className="rounded-2xl border border-red-400/20 bg-red-400/10 p-6 text-red-100">
            {error ?? 'Research run not found'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10 space-y-6">

        {/* Header */}
        <div className="flex flex-wrap items-start gap-4 justify-between">
          <div>
            <button onClick={() => navigate('/evals')} className="mb-3 flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 transition-colors">
              <ArrowLeft className="h-4 w-4" />
              Back to dashboard
            </button>
            <h1 className="text-2xl font-bold text-slate-100">{run.name}</h1>
            <p className="mt-1 text-sm text-slate-400">
              Auto Research — {run.research_model_provider}/{run.research_model_id} optimizing for {run.target_models_config[0]?.provider}/{run.target_models_config[0]?.modelId}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge className={cn('rounded-full border px-3 py-1 text-xs font-semibold', STATUS_BADGE[run.status] ?? '')}>
              {run.status}
            </Badge>
            {run.status === 'completed' && !promoted && (
              <Button onClick={handlePromote} disabled={promoting} className="gap-2">
                <TrendingUp className="h-4 w-4" />
                {promoting ? 'Promoting…' : 'Promote best prompt'}
              </Button>
            )}
            {promoted && (
              <Badge className="rounded-full border border-emerald-400/20 bg-emerald-400/10 text-emerald-100 px-3 py-1 text-xs">
                Promoted
              </Badge>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid gap-4 md:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Baseline accuracy</p>
            <p className="mt-3 text-2xl font-bold text-slate-100">{pct(baselineAccuracy)}</p>
            <p className="mt-1 text-xs text-slate-400">Original prompt</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Best accuracy</p>
            <p className={cn('mt-3 text-2xl font-bold', bestAccuracy != null && bestAccuracy > (baselineAccuracy ?? 0) ? 'text-emerald-300' : 'text-slate-100')}>
              {pct(bestAccuracy)}
            </p>
            <p className="mt-1 text-xs text-slate-400">Best candidate so far</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Delta</p>
            <p className={cn('mt-3 text-2xl font-bold', delta != null && delta > 0 ? 'text-emerald-300' : delta != null && delta < 0 ? 'text-red-400' : 'text-slate-100')}>
              {delta != null ? `${delta > 0 ? '+' : ''}${(delta * 100).toFixed(1)}%` : '—'}
            </p>
            <p className="mt-1 text-xs text-slate-400">vs baseline</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Progress</p>
            <p className="mt-3 text-2xl font-bold text-slate-100">
              {currentIteration} / {run.max_iterations}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {isLive ? 'Iterations running…' : 'Iterations completed'}
            </p>
          </div>
        </div>

        {/* Best prompt */}
        {bestPrompt && (
          <section className="rounded-[2rem] border border-emerald-400/20 bg-emerald-400/[0.03] p-6">
            <div className="flex items-center justify-between gap-4 mb-4">
              <h2 className="text-sm font-semibold uppercase tracking-[0.24em] text-emerald-300/80">Best prompt found</h2>
              <CopyButton text={bestPrompt} />
            </div>
            <pre className="whitespace-pre-wrap text-sm text-slate-200 font-mono leading-relaxed">{bestPrompt}</pre>
          </section>
        )}

        {/* Base prompt */}
        <section className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-6">
          <div className="flex items-center justify-between gap-4 mb-4">
            <h2 className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">Base prompt</h2>
            {run.base_prompt && <CopyButton text={run.base_prompt} />}
          </div>
          <pre className="whitespace-pre-wrap text-sm text-slate-400 font-mono leading-relaxed">
            {run.base_prompt || <span className="italic text-slate-600">(empty)</span>}
          </pre>
        </section>

        {/* Trial table */}
        <section className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">
            Trial log — {allTrials.length} trial{allTrials.length !== 1 ? 's' : ''}
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left">
                  <th className="pb-3 pr-4 text-[11px] uppercase tracking-[0.24em] text-slate-500 font-semibold">Iter</th>
                  <th className="pb-3 pr-4 text-[11px] uppercase tracking-[0.24em] text-slate-500 font-semibold">Status</th>
                  <th className="pb-3 pr-4 text-[11px] uppercase tracking-[0.24em] text-slate-500 font-semibold">Accuracy</th>
                  <th className="pb-3 pr-4 text-[11px] uppercase tracking-[0.24em] text-slate-500 font-semibold hidden md:table-cell">Latency</th>
                  <th className="pb-3 pr-4 text-[11px] uppercase tracking-[0.24em] text-slate-500 font-semibold hidden md:table-cell">Tokens</th>
                  <th className="pb-3 text-[11px] uppercase tracking-[0.24em] text-slate-500 font-semibold">Notes</th>
                </tr>
              </thead>
              <tbody>
                {allTrials.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-500 text-sm">
                      {isLive ? 'Waiting for first trial…' : 'No trials recorded'}
                    </td>
                  </tr>
                ) : (
                  allTrials.map((trial) => (
                    <tr key={trial.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                      <td className="py-3 pr-4 font-mono text-slate-300">
                        {trial.iteration === 0 ? <span className="text-amber-300">base</span> : trial.iteration}
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2">
                          <TrialStatusIcon status={trial.status} />
                          <span className={cn('text-xs font-medium', TRIAL_STATUS_STYLES[trial.status] ?? 'text-slate-400')}>
                            {trial.status}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 pr-4 font-mono text-slate-200">{pct(trial.overall_accuracy)}</td>
                      <td className="py-3 pr-4 font-mono text-slate-400 hidden md:table-cell">
                        {trial.latency_ms_avg != null ? `${Math.round(trial.latency_ms_avg)}ms` : '—'}
                      </td>
                      <td className="py-3 pr-4 font-mono text-slate-400 hidden md:table-cell">
                        {trial.tokens_used_total ?? '—'}
                      </td>
                      <td className="py-3 text-xs text-slate-400 max-w-xs truncate">
                        {trial.mutation_summary ?? '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Config */}
        <section className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">Run config</h2>
          <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 text-sm">
            {[
              ['Target model', `${run.target_models_config[0]?.provider}/${run.target_models_config[0]?.modelId}`],
              ['Research model', `${run.research_model_provider}/${run.research_model_id}`],
              ['Max iterations', run.max_iterations],
              ['Candidates / iter', run.candidate_count_per_iteration],
              ['Holdout', run.holdout_enabled ? 'enabled' : 'disabled'],
              ['Early stop K', run.early_stop_k],
              ['Token budget', run.max_token_budget != null ? run.max_token_budget.toLocaleString() : 'unlimited'],
              ['Storage', run.storage_mode],
              ['Created', new Date(run.created_at).toLocaleString()],
            ].map(([label, value]) => (
              <div key={String(label)} className="flex flex-col gap-0.5">
                <dt className="text-[11px] uppercase tracking-[0.2em] text-slate-500">{label}</dt>
                <dd className="text-slate-200 font-mono text-xs">{String(value)}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </div>
  );
}
