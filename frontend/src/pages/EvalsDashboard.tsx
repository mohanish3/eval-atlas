import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Clock, Database, FileText, FlaskConical, FolderKanban, Microscope, Plus, Settings2, Upload } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { ModelSelector } from '../components/evals/ModelSelector';
import { evalService, researchService, type AvailableModels, type EvalSetSummary, type ModelSpec, type PromptResearchRun } from '../services/api';
import { useEvalStore } from '../store/useEvalStore';
import { cn } from '../lib/utils';

const STATUS_BADGE: Record<string, string> = {
  completed: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100',
  running: 'border-cyan-400/20 bg-cyan-400/10 text-cyan-100',
  failed: 'border-red-400/20 bg-red-400/10 text-red-100',
  pending: 'border-amber-300/20 bg-amber-300/10 text-amber-100',
  queued: 'border-amber-300/20 bg-amber-300/10 text-amber-100',
  stopped: 'border-slate-400/20 bg-slate-400/10 text-slate-300',
};

export default function EvalsDashboard() {
  const navigate = useNavigate();
  const {
    runs,
    setRuns,
    addRunSummary,
    setActiveRun,
    clearResults,
    loading,
    setLoading,
    setError,
    runtimeStatus,
    setRuntimeStatus,
  } = useEvalStore();

  const [availableModels, setAvailableModels] = useState<AvailableModels | null>(null);
  const [savedSets, setSavedSets] = useState<EvalSetSummary[]>([]);
  const [researchRuns, setResearchRuns] = useState<PromptResearchRun[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  // Shared run config state (used by both quick-run and upload forms)
  const [runName, setRunName] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [selectedModels, setSelectedModels] = useState<ModelSpec[]>([]);
  const [maxTokens, setMaxTokens] = useState(256);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Quick session run form
  const [showQuickRunForm, setShowQuickRunForm] = useState(false);
  const [quickSelectedSetId, setQuickSelectedSetId] = useState('');

  // Upload eval file form
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [evalFile, setEvalFile] = useState<File | null>(null);
  const [parsedKeys, setParsedKeys] = useState<string[]>([]);
  const [inputKeys, setInputKeys] = useState<string[]>([]);
  const [outputKey, setOutputKey] = useState('');
  const [filePreview, setFilePreview] = useState<Record<string, unknown> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto Research state
  const [showResearchForm, setShowResearchForm] = useState(false);
  const [researchName, setResearchName] = useState('');
  const [researchBasePrompt, setResearchBasePrompt] = useState('');
  const [researchSelectedSetId, setResearchSelectedSetId] = useState('');
  const [researchTargetModel, setResearchTargetModel] = useState<ModelSpec | null>(null);
  const [researchModel, setResearchModel] = useState<ModelSpec | null>(null);
  const [researchMaxIterations, setResearchMaxIterations] = useState(5);
  const [researchCandidateCount, setResearchCandidateCount] = useState(1);
  const [researchHoldout, setResearchHoldout] = useState(true);
  const [researchEarlyStopK, setResearchEarlyStopK] = useState(3);
  const [researchConsent, setResearchConsent] = useState(false);
  const [researchSubmitting, setResearchSubmitting] = useState(false);
  const [researchFormError, setResearchFormError] = useState<string | null>(null);

  const localMode = runtimeStatus.storageMode === 'memory';

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setModelsLoading(true);
      setError(null);
      try {
        const models = await evalService.getModels();
        if (cancelled) return;
        setAvailableModels(models);
        setRuntimeStatus(models.runtime);

        const runSummaries = await evalService.listRuns();
        if (cancelled) return;
        setRuns(runSummaries);

        const evalSets = await evalService.listEvalSets();
        if (!cancelled) setSavedSets(evalSets);

        const rRuns = await researchService.list().catch(() => [] as PromptResearchRun[]);
        if (!cancelled) setResearchRuns(rRuns);
      } catch (error: any) {
        if (!cancelled) {
          setError(error.message ?? 'Failed to load Eval Atlas');
          setFormError(error.message ?? 'Failed to load Eval Atlas');
        }
      } finally {
        if (!cancelled) {
          setModelsLoading(false);
          setLoading(false);
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [setError, setLoading, setRuns, setRuntimeStatus]);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setEvalFile(file);
    setParsedKeys([]);
    setInputKeys([]);
    setOutputKey('');
    setFilePreview(null);
    if (!file) return;

    try {
      const text = await file.text();
      const raw = text.trim();
      const items = raw.startsWith('[')
        ? JSON.parse(raw)
        : raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));

      if (items.length === 0 || typeof items[0] !== 'object' || items[0] === null) return;

      const first = items[0] as Record<string, unknown>;
      const keys = Object.keys(first).filter((key) => {
        const value = first[key];
        return typeof value === 'string' || typeof value === 'number' || (typeof value === 'object' && value !== null && !Array.isArray(value));
      });

      setParsedKeys(keys);
      setFilePreview(first);

      const guessedOutput = keys.find((key) =>
        ['answer', 'correct_answer', 'output', 'expected', 'label', 'target'].includes(key.toLowerCase())
      ) ?? '';
      const guessedInputs = keys.filter((key) =>
        key !== guessedOutput && ['question', 'input', 'prompt', 'query', 'text', 'context', 'instruction'].includes(key.toLowerCase())
      );
      const nextInputs = guessedInputs.length > 0 ? guessedInputs : keys.filter((key) => key !== guessedOutput).slice(0, 1);

      setInputKeys(nextInputs);
      setOutputKey(guessedOutput || keys.find((key) => !nextInputs.includes(key)) || '');
    } catch {
      // Backend validation is authoritative.
    }
  }

  function toggleInputKey(key: string) {
    setInputKeys((current) =>
      current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key]
    );
  }

  async function handleQuickRunSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!runName.trim()) { setFormError('Run name is required.'); return; }
    if (!quickSelectedSetId) { setFormError('Select a saved eval set.'); return; }
    if (selectedModels.length === 0) { setFormError('Select at least one model.'); return; }

    setSubmitting(true);
    try {
      const response = await evalService.createRun({
        name: runName.trim(),
        systemPrompt: systemPrompt.trim(),
        modelsConfig: selectedModels,
        evalSetId: quickSelectedSetId,
        maxTokens,
      });
      clearResults();
      setActiveRun(response.run);
      addRunSummary({
        id: response.run.id,
        name: response.run.name,
        status: response.run.status,
        model_count: response.run.models_config.length,
        created_at: response.run.created_at,
        completed_at: response.run.completed_at,
        storage_mode: response.run.storage_mode,
      });
      navigate(`/evals/${response.runId}`);
    } catch (error: any) {
      setFormError(error.message ?? 'Failed to start eval.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUploadSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!runName.trim()) { setFormError('Run name is required.'); return; }
    if (!evalFile) { setFormError('Select an eval file.'); return; }
    if (selectedModels.length === 0) { setFormError('Select at least one model.'); return; }

    setSubmitting(true);
    try {
      const response = await evalService.createRun({
        name: runName.trim(),
        systemPrompt: systemPrompt.trim(),
        modelsConfig: selectedModels,
        evalFile,
        inputKeys: inputKeys.length > 0 ? inputKeys : undefined,
        outputKey: outputKey || undefined,
        maxTokens,
      });
      clearResults();
      setActiveRun(response.run);
      addRunSummary({
        id: response.run.id,
        name: response.run.name,
        status: response.run.status,
        model_count: response.run.models_config.length,
        created_at: response.run.created_at,
        completed_at: response.run.completed_at,
        storage_mode: response.run.storage_mode,
      });
      navigate(`/evals/${response.runId}`);
    } catch (error: any) {
      setFormError(error.message ?? 'Failed to start eval.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResearchSubmit(event: React.FormEvent) {
    event.preventDefault();
    setResearchFormError(null);
    if (!researchName.trim()) { setResearchFormError('Run name is required.'); return; }
    if (!researchSelectedSetId) { setResearchFormError('Select a saved eval set.'); return; }
    if (!researchTargetModel) { setResearchFormError('Select a target model.'); return; }
    if (!researchModel) { setResearchFormError('Select a research model.'); return; }

    const isLocalProvider = (p: string) => ['local', 'ollama', 'mock'].includes(p);
    const needsConsent =
      (researchTargetModel && !isLocalProvider(researchTargetModel.provider)) ||
      (researchModel && !isLocalProvider(researchModel.provider));
    if (needsConsent && !researchConsent) {
      setResearchFormError('Acknowledge that eval data will be sent to a hosted model provider.');
      return;
    }

    setResearchSubmitting(true);
    try {
      const response = await researchService.create({
        name: researchName.trim(),
        evalSetId: researchSelectedSetId,
        basePrompt: researchBasePrompt.trim(),
        targetModel: researchTargetModel,
        researchModel,
        maxIterations: researchMaxIterations,
        candidateCountPerIteration: researchCandidateCount,
        holdoutEnabled: researchHoldout,
        earlyStopK: researchEarlyStopK,
        maxTokens: 256,
        consentAcknowledged: researchConsent,
      });
      const freshRuns = await researchService.list().catch(() => researchRuns);
      setResearchRuns(freshRuns);
      navigate(`/evals/research/${response.researchRunId}`);
    } catch (error: any) {
      setResearchFormError(error.message ?? 'Failed to start research run.');
    } finally {
      setResearchSubmitting(false);
    }
  }

  function toggleQuickRun() {
    setShowQuickRunForm((v) => !v);
    setShowUploadForm(false);
    setFormError(null);
  }

  function toggleUpload() {
    setShowUploadForm((v) => !v);
    setShowQuickRunForm(false);
    setFormError(null);
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="space-y-6">

          {/* Header */}
          <section className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-6 shadow-[0_30px_90px_rgba(0,0,0,0.28)] backdrop-blur-xl sm:p-8">
            <div>
              <div className="mb-3 flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-300/10">
                  <FlaskConical className="h-4 w-4 text-cyan-200" />
                </div>
                <span className="text-xs font-bold uppercase tracking-[0.28em] text-cyan-200/70">Eval Atlas</span>
              </div>
              <h1 className="text-3xl font-bold tracking-tight text-slate-100 sm:text-4xl">Evaluation dashboard</h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-400">
                Run ad hoc eval files, jump into saved eval sets, and keep database wiring isolated in config instead of mixing it into run workflow.
              </p>
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
                <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Storage mode</p>
                <p className="mt-3 text-lg font-semibold text-slate-100">{localMode ? 'Local memory' : 'Persistent database'}</p>
                <p className="mt-1 text-sm text-slate-400">{localMode ? 'Runs and authored sets are kept for the current server session.' : 'Runs and authored eval sets persist in Postgres.'}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
                <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Saved eval sets</p>
                <p className="mt-3 text-3xl font-bold text-slate-100">{localMode ? '0' : savedSets.length}</p>
                <p className="mt-1 text-sm text-slate-400">Reusable authored datasets</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
                <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Recent runs</p>
                <p className="mt-3 text-3xl font-bold text-slate-100">{runs.length}</p>
                <p className="mt-1 text-sm text-slate-400">Visible in this workspace</p>
              </div>
            </div>

            {localMode && (
              <div className="mt-6 rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
                Database connectivity unavailable. Session still supports authoring and runs in memory, but saved eval sets are not durable across restarts.
              </div>
            )}
          </section>

          {/* Auto Research — top section */}
          <section className="rounded-[2rem] border border-violet-400/20 bg-violet-400/[0.03] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.22)] backdrop-blur-xl">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="mb-2 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-violet-400/20 bg-violet-300/10">
                    <Microscope className="h-4 w-4 text-violet-300" />
                  </div>
                  <span className="text-xs font-bold uppercase tracking-[0.28em] text-violet-300/70">Auto Research</span>
                </div>
                <p className="text-sm text-slate-400 max-w-xl">
                  Karpathy-style prompt optimization loop. A research model proposes prompt candidates; the eval harness keeps only improvements.
                </p>
              </div>
              <Button
                type="button"
                variant={showResearchForm ? 'outline' : 'default'}
                className="gap-2"
                onClick={() => setShowResearchForm((v) => !v)}
              >
                <Microscope className="h-4 w-4" />
                {showResearchForm ? 'Cancel' : 'Start Auto Research'}
              </Button>
            </div>
          </section>

          {showResearchForm && (
            <form onSubmit={handleResearchSubmit} className="grid gap-6 xl:grid-cols-[1.45fr_1fr]">
              <section className="space-y-6 rounded-[2rem] border border-white/10 bg-white/[0.03] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.22)] backdrop-blur-xl">
                <div>
                  <h2 className="text-xl font-semibold text-slate-100">Auto Research</h2>
                  <p className="mt-2 text-sm text-slate-400">Karpathy-style prompt optimization loop. Research model proposes prompt variants; eval loop keeps only improvements.</p>
                </div>
                <div className="grid gap-4">
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Run name</label>
                    <Input value={researchName} onChange={(e) => setResearchName(e.target.value)} placeholder="e.g. prompt-research-v1" />
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Eval set</label>
                    {savedSets.length === 0 ? (
                      <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
                        No saved eval sets found. Create one via the builder first.
                      </div>
                    ) : (
                      <select
                        value={researchSelectedSetId}
                        onChange={(e) => setResearchSelectedSetId(e.target.value)}
                        className="h-10 w-full rounded-xl border border-white/10 bg-slate-950/90 px-3 text-sm text-slate-100 outline-none"
                      >
                        <option value="">Select eval set…</option>
                        {savedSets.map((s) => (
                          <option key={s.id} value={s.id}>{s.name} ({s.item_count} items)</option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Base system prompt</label>
                    <textarea
                      value={researchBasePrompt}
                      onChange={(e) => setResearchBasePrompt(e.target.value)}
                      rows={4}
                      className="w-full rounded-2xl border border-white/10 bg-slate-950/90 px-4 py-3 text-sm text-slate-100 outline-none"
                      placeholder="Starting system prompt to optimize from (can be empty)"
                    />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Max iterations</label>
                      <input type="number" min={1} max={20} value={researchMaxIterations} onChange={(e) => setResearchMaxIterations(Number(e.target.value))} className="h-10 w-full rounded-xl border border-white/10 bg-slate-950/90 px-3 text-sm text-slate-100 outline-none" />
                    </div>
                    <div>
                      <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Candidates / iter</label>
                      <input type="number" min={1} max={3} value={researchCandidateCount} onChange={(e) => setResearchCandidateCount(Number(e.target.value))} className="h-10 w-full rounded-xl border border-white/10 bg-slate-950/90 px-3 text-sm text-slate-100 outline-none" />
                    </div>
                    <div>
                      <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Early stop K</label>
                      <input type="number" min={1} max={10} value={researchEarlyStopK} onChange={(e) => setResearchEarlyStopK(Number(e.target.value))} className="h-10 w-full rounded-xl border border-white/10 bg-slate-950/90 px-3 text-sm text-slate-100 outline-none" />
                    </div>
                    <div className="flex items-center gap-3 pt-6">
                      <input type="checkbox" id="holdout" checked={researchHoldout} onChange={(e) => setResearchHoldout(e.target.checked)} className="h-4 w-4 accent-cyan-400" />
                      <label htmlFor="holdout" className="text-sm text-slate-300">Holdout verification</label>
                    </div>
                  </div>
                </div>
              </section>

              <section className="space-y-6 rounded-[2rem] border border-white/10 bg-white/[0.03] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.22)] backdrop-blur-xl">
                <div>
                  <h2 className="text-xl font-semibold text-slate-100">Models</h2>
                  <p className="mt-2 text-sm text-slate-400">Select one target model (evaluated each trial) and one research model (proposes prompt candidates).</p>
                </div>

                {modelsLoading && <p className="text-sm text-slate-400">Loading models…</p>}

                {availableModels && (
                  <div className="space-y-4">
                    <div>
                      <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Target model (evaluated)</label>
                      <ModelSelector
                        availableModels={availableModels}
                        selectedModels={researchTargetModel ? [researchTargetModel] : []}
                        onChange={(models) => setResearchTargetModel(models[0] ?? null)}
                        singleSelect
                      />
                      <p className="mt-1 text-xs text-slate-500">Exactly one model evaluated against each candidate prompt.</p>
                    </div>
                    <div>
                      <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Research model (proposes prompts)</label>
                      <ModelSelector
                        availableModels={availableModels}
                        selectedModels={researchModel ? [researchModel] : []}
                        onChange={(models) => setResearchModel(models[0] ?? null)}
                        singleSelect
                      />
                      <p className="mt-1 text-xs text-slate-500">Needs a real LLM. OpenAI gpt-4o-mini recommended.</p>
                    </div>
                  </div>
                )}

                {researchTargetModel && researchModel &&
                  (!['local', 'ollama', 'mock'].includes(researchTargetModel.provider) ||
                    !['local', 'ollama', 'mock'].includes(researchModel.provider)) && (
                  <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4">
                    <p className="mb-3 text-sm font-semibold text-amber-200">Privacy disclosure</p>
                    <p className="text-xs text-amber-100 leading-5">
                      Eval questions, expected answers, and model outputs may be sent to hosted providers (
                      {[
                        ...new Set(
                          [researchTargetModel.provider, researchModel.provider].filter(
                            (p) => !['local', 'ollama', 'mock'].includes(p)
                          )
                        ),
                      ].join(', ') || 'selected models'}
                      ).
                    </p>
                    <label className="mt-3 flex items-start gap-2 cursor-pointer">
                      <input type="checkbox" checked={researchConsent} onChange={(e) => setResearchConsent(e.target.checked)} className="mt-0.5 h-4 w-4 accent-amber-400" />
                      <span className="text-xs text-amber-100">I understand and consent to sending eval data to hosted model providers.</span>
                    </label>
                  </div>
                )}

                {researchFormError && (
                  <div className="rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-100">
                    {researchFormError}
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={researchSubmitting || !researchName.trim() || !researchSelectedSetId || !researchTargetModel || !researchModel}
                  className="w-full gap-2"
                >
                  <Microscope className="h-4 w-4" />
                  {researchSubmitting ? 'Starting research…' : 'Start research run'}
                </Button>
              </section>
            </form>
          )}

          {/* Research runs listing */}
          {researchRuns.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">Research runs</h2>
                <span className="text-xs text-slate-500">{researchRuns.length} visible</span>
              </div>
              {researchRuns.map((rr) => (
                <button
                  key={rr.id}
                  onClick={() => navigate(`/evals/research/${rr.id}`)}
                  className="group w-full rounded-[1.4rem] border border-violet-400/10 bg-violet-400/[0.03] px-5 py-4 text-left shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:border-violet-400/20 hover:shadow-card-hover"
                >
                  <div className="flex items-center gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-slate-100 transition-colors group-hover:text-violet-200">{rr.name}</div>
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                        <span className="flex items-center gap-1">
                          <Microscope className="h-3 w-3" />
                          {rr.research_model_provider}/{rr.research_model_id}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {new Date(rr.created_at).toLocaleString()}
                        </span>
                        {rr.best_accuracy != null && (
                          <span className="text-emerald-400">best {(rr.best_accuracy * 100).toFixed(1)}%</span>
                        )}
                      </div>
                    </div>
                    <Badge className={cn('rounded-full border px-2.5 py-0.5 text-[11px] font-semibold', STATUS_BADGE[rr.status] ?? '')}>
                      {rr.status}
                    </Badge>
                  </div>
                </button>
              ))}
            </section>
          )}

          {/* Session runs */}
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">
                  {localMode ? 'Local runs' : 'Recent runs'}
                </h2>
                {!loading && <span className="text-xs text-slate-500">{runs.length} visible</span>}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  className="gap-2"
                  onClick={toggleQuickRun}
                  variant={showQuickRunForm ? 'outline' : 'default'}
                >
                  <FlaskConical className="h-4 w-4" />
                  {showQuickRunForm ? 'Cancel' : 'New Session Run'}
                </Button>
                <Button type="button" variant="outline" className="gap-2" onClick={toggleUpload}>
                  <Upload className="h-4 w-4" />
                  {showUploadForm ? 'Cancel upload' : 'Upload eval file'}
                </Button>
                <Button type="button" variant="outline" className="gap-2" onClick={() => navigate('/evals/builder/new')}>
                  <Plus className="h-4 w-4" />
                  Create evals
                </Button>
              </div>
            </div>

            {/* Quick session run form */}
            {showQuickRunForm && (
              <form onSubmit={handleQuickRunSubmit} className="grid gap-6 xl:grid-cols-[1.45fr_1fr]">
                <section className="space-y-5 rounded-[2rem] border border-white/10 bg-white/[0.03] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.22)] backdrop-blur-xl">
                  <div>
                    <h2 className="text-xl font-semibold text-slate-100">New session run</h2>
                    <p className="mt-2 text-sm text-slate-400">Run against a saved eval set immediately.</p>
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Run name</label>
                    <Input value={runName} onChange={(e) => setRunName(e.target.value)} placeholder="e.g. quick-benchmark-v1" />
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Eval set</label>
                    {savedSets.length === 0 ? (
                      <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
                        No saved eval sets. Create one first or use "Upload eval file".
                      </div>
                    ) : (
                      <select
                        value={quickSelectedSetId}
                        onChange={(e) => setQuickSelectedSetId(e.target.value)}
                        className="h-10 w-full rounded-xl border border-white/10 bg-slate-950/90 px-3 text-sm text-slate-100 outline-none"
                      >
                        <option value="">Select eval set…</option>
                        {savedSets.map((s) => (
                          <option key={s.id} value={s.id}>{s.name} ({s.item_count} items)</option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">System prompt</label>
                    <textarea
                      value={systemPrompt}
                      onChange={(e) => setSystemPrompt(e.target.value)}
                      rows={3}
                      className="w-full rounded-2xl border border-white/10 bg-slate-950/90 px-4 py-3 text-sm text-slate-100 outline-none"
                      placeholder="Optional instructions shared across all models"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Max tokens</label>
                    <input
                      type="range"
                      min={16}
                      max={2048}
                      step={16}
                      value={maxTokens}
                      onChange={(e) => setMaxTokens(Number(e.target.value))}
                      className="w-full accent-cyan-300"
                    />
                    <div className="mt-1 text-xs text-slate-400">Current ceiling: {maxTokens}</div>
                  </div>
                </section>

                <section className="space-y-5 rounded-[2rem] border border-white/10 bg-white/[0.03] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.22)] backdrop-blur-xl">
                  <div>
                    <h2 className="text-xl font-semibold text-slate-100">Models</h2>
                    <p className="mt-2 text-sm text-slate-400">Pick one or more endpoints to score against the same eval set.</p>
                  </div>
                  {modelsLoading && <p className="text-sm text-slate-400">Loading available models…</p>}
                  {availableModels && <ModelSelector availableModels={availableModels} selectedModels={selectedModels} onChange={setSelectedModels} />}
                  {formError && (
                    <div className="rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-100">
                      {formError}
                    </div>
                  )}
                  <Button
                    type="submit"
                    disabled={submitting || !runName.trim() || !quickSelectedSetId || selectedModels.length === 0}
                    className="w-full gap-2"
                  >
                    {submitting ? 'Starting eval…' : 'Start eval run'}
                  </Button>
                </section>
              </form>
            )}

            {/* Upload eval file form */}
            {showUploadForm && (
              <form onSubmit={handleUploadSubmit} className="grid gap-6 xl:grid-cols-[1.45fr_1fr]">
                <section className="space-y-6 rounded-[2rem] border border-white/10 bg-white/[0.03] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.22)] backdrop-blur-xl">
                  <div>
                    <h2 className="text-xl font-semibold text-slate-100">Upload eval file</h2>
                    <p className="mt-2 text-sm text-slate-400">Upload a dataset, map fields, and launch a run immediately.</p>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="md:col-span-2">
                      <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Run name</label>
                      <Input value={runName} onChange={(e) => setRunName(e.target.value)} placeholder="e.g. support-qa-benchmark-v2" />
                    </div>
                    <div className="md:col-span-2">
                      <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">System prompt</label>
                      <textarea
                        value={systemPrompt}
                        onChange={(e) => setSystemPrompt(e.target.value)}
                        rows={4}
                        className="w-full rounded-2xl border border-white/10 bg-slate-950/90 px-4 py-3 text-sm text-slate-100 outline-none"
                        placeholder="Optional instructions shared across all models"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Max tokens</label>
                      <input
                        type="range"
                        min={16}
                        max={2048}
                        step={16}
                        value={maxTokens}
                        onChange={(e) => setMaxTokens(Number(e.target.value))}
                        className="w-full accent-cyan-300"
                      />
                      <div className="mt-2 text-xs text-slate-400">Current ceiling: {maxTokens}</div>
                    </div>
                  </div>

                  <section className="rounded-2xl border border-white/10 bg-slate-900/50 p-5">
                    <div className="mb-4 flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-lg font-semibold text-slate-100">Dataset</h3>
                        <p className="mt-1 text-sm text-slate-400">Upload JSON or JSONL. First row is previewed so you can map prompt and expected-answer fields.</p>
                      </div>
                      <Button type="button" variant="outline" className="gap-2" onClick={() => fileInputRef.current?.click()}>
                        <FileText className="h-4 w-4" />
                        {evalFile ? 'Replace file' : 'Choose file'}
                      </Button>
                    </div>

                    <input ref={fileInputRef} type="file" accept=".json,.jsonl" onChange={handleFileChange} className="hidden" />

                    <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/50 p-4">
                      <p className="text-sm font-medium text-slate-100">{evalFile ? evalFile.name : 'No file selected'}</p>
                      <p className="mt-1 text-xs text-slate-400">{evalFile ? `${Math.max(1, Math.round(evalFile.size / 1024))} KB` : 'Upload a file to enable preview and field mapping.'}</p>
                    </div>

                    {parsedKeys.length > 0 && (
                      <div className="mt-4 grid gap-4 lg:grid-cols-2">
                        <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Prompt fields</p>
                          <div className="flex flex-wrap gap-2">
                            {parsedKeys.map((key) => (
                              <button
                                key={key}
                                type="button"
                                onClick={() => toggleInputKey(key)}
                                className={cn(
                                  'rounded-full border px-3 py-1 text-xs transition-colors',
                                  inputKeys.includes(key)
                                    ? 'border-cyan-300/30 bg-cyan-300/15 text-cyan-100'
                                    : 'border-white/10 bg-white/[0.03] text-slate-300'
                                )}
                              >
                                {key}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Expected answer field</p>
                          <select
                            value={outputKey}
                            onChange={(e) => setOutputKey(e.target.value)}
                            className="h-10 w-full rounded-xl border border-white/10 bg-slate-950/90 px-3 text-sm text-slate-100 outline-none"
                          >
                            <option value="">Select output field</option>
                            {parsedKeys.map((key) => (
                              <option key={key} value={key}>{key}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}

                    {filePreview && (
                      <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">First record preview</p>
                        <div className="space-y-3 text-sm text-slate-300">
                          {inputKeys.length > 0 && (
                            <div>
                              <p className="mb-1 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Prompt content</p>
                              <div className="rounded-xl border border-white/8 bg-slate-950/70 px-3 py-2">
                                {inputKeys.map((key) => (
                                  <p key={key} className="break-words"><span className="font-semibold text-slate-100">{key}:</span> {String(filePreview[key] ?? '')}</p>
                                ))}
                              </div>
                            </div>
                          )}
                          {outputKey && (
                            <div>
                              <p className="mb-1 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Expected output</p>
                              <div className="rounded-xl border border-white/8 bg-slate-950/70 px-3 py-2">
                                {String(filePreview[outputKey] ?? '')}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </section>
                </section>

                <section className="space-y-6 rounded-[2rem] border border-white/10 bg-white/[0.03] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.22)] backdrop-blur-xl">
                  <div>
                    <h2 className="text-xl font-semibold text-slate-100">Models</h2>
                    <p className="mt-2 text-sm text-slate-400">Pick one or more endpoints to score against the same eval set.</p>
                  </div>
                  {modelsLoading && <p className="text-sm text-slate-400">Loading available models…</p>}
                  {availableModels && <ModelSelector availableModels={availableModels} selectedModels={selectedModels} onChange={setSelectedModels} />}
                  <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-4 text-sm text-slate-300">
                    <div><span className="font-semibold text-slate-100">Selected models:</span> {selectedModels.length}</div>
                    <div className="mt-2"><span className="font-semibold text-slate-100">Eval file:</span> {evalFile?.name ?? 'none'}</div>
                  </div>
                  {formError && (
                    <div className="rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-100">
                      {formError}
                    </div>
                  )}
                  <Button
                    type="submit"
                    disabled={submitting || !runName.trim() || !evalFile || selectedModels.length === 0}
                    className="w-full gap-2"
                  >
                    {submitting ? 'Starting eval…' : 'Start eval run'}
                  </Button>
                </section>
              </form>
            )}

            {/* Run cards */}
            {loading ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, index) => (
                  <div key={index} className="h-20 rounded-2xl shimmer" />
                ))}
              </div>
            ) : runs.length === 0 ? (
              <div className="rounded-[2rem] border border-dashed border-white/10 bg-white/[0.03] py-16 text-center shadow-card backdrop-blur-xl">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
                  <FlaskConical className="h-7 w-7 text-muted-foreground/50" />
                </div>
                <h3 className="font-semibold text-slate-100">{localMode ? 'No local runs yet' : 'No evaluation runs yet'}</h3>
                <p className="mx-auto mt-2 max-w-sm text-sm text-slate-400">
                  {localMode
                    ? 'Create a run to execute immediately. Without Postgres, only current-session runs are shown here.'
                    : 'Create your first eval run to compare model outputs side-by-side.'}
                </p>
              </div>
            ) : (
              runs.map((run) => (
                <button
                  key={run.id}
                  onClick={() => navigate(`/evals/${run.id}`)}
                  className="group w-full rounded-[1.4rem] border border-white/10 bg-white/[0.03] px-5 py-4 text-left shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:border-cyan-400/20 hover:shadow-card-hover"
                >
                  <div className="flex items-center gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-slate-100 transition-colors group-hover:text-cyan-100">{run.name}</div>
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                        <span className="flex items-center gap-1">
                          <Database className="h-3 w-3" />
                          {run.model_count} model{run.model_count !== 1 ? 's' : ''}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {new Date(run.created_at).toLocaleString()}
                        </span>
                        <span>{run.storage_mode === 'memory' ? 'local only' : 'persisted'}</span>
                      </div>
                    </div>
                    <Badge className={cn('rounded-full border px-2.5 py-0.5 text-[11px] font-semibold', STATUS_BADGE[run.status] ?? '')}>
                      {run.status}
                    </Badge>
                  </div>
                </button>
              ))
            )}
          </section>

          {/* Bottom nav cards */}
          <section className="grid gap-4 lg:grid-cols-2">
            <button
              type="button"
              onClick={() => navigate('/evals/sets')}
              className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-6 text-left shadow-[0_20px_60px_rgba(0,0,0,0.22)] backdrop-blur-xl transition-all hover:-translate-y-0.5 hover:border-cyan-400/20"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-300/10">
                    <FolderKanban className="h-5 w-5 text-cyan-200" />
                  </div>
                  <h2 className="mt-5 text-xl font-semibold text-slate-100">Saved eval sets</h2>
                  <p className="mt-2 text-sm text-slate-400">Browse reusable sets on separate page. Export CSV or reopen builder from there.</p>
                </div>
                <ArrowRight className="h-5 w-5 text-slate-500" />
              </div>
              <div className="mt-5 text-3xl font-bold text-slate-100">{localMode ? '0' : savedSets.length}</div>
            </button>

            <button
              type="button"
              onClick={() => navigate('/evals/config')}
              className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-6 text-left shadow-[0_20px_60px_rgba(0,0,0,0.22)] backdrop-blur-xl transition-all hover:-translate-y-0.5 hover:border-cyan-400/20"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-orange-400/20 bg-orange-300/10">
                    <Settings2 className="h-5 w-5 text-orange-200" />
                  </div>
                  <h2 className="mt-5 text-xl font-semibold text-slate-100">Database config</h2>
                  <p className="mt-2 text-sm text-slate-400">Keep Postgres connection patterns and runtime persistence details off main evals page.</p>
                </div>
                <ArrowRight className="h-5 w-5 text-slate-500" />
              </div>
              <div className="mt-5 text-sm text-slate-300">{localMode ? 'Local memory active' : 'Database persistence active'}</div>
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
