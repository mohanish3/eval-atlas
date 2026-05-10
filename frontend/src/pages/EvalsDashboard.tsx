import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Check, ChevronDown, ChevronRight, Clock, Cloud, Cpu, FlaskConical, Info, Plus, Upload, X, Zap } from 'lucide-react';
import { useEvalStore } from '../store/useEvalStore';
import { evalService } from '../services/api';
import type { AvailableModels, ModelSpec } from '../services/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { cn } from '../lib/utils';

const PROVIDER_META: Record<string, { icon: typeof Cloud; accent: string; dot: string }> = {
  openai: { icon: Cloud, accent: 'text-emerald-300', dot: 'bg-emerald-400' },
  anthropic: { icon: Cloud, accent: 'text-orange-300', dot: 'bg-orange-400' },
  gemini: { icon: Cloud, accent: 'text-blue-300', dot: 'bg-blue-400' },
  groq: { icon: Zap, accent: 'text-fuchsia-300', dot: 'bg-fuchsia-400' },
  mistral: { icon: Cloud, accent: 'text-amber-300', dot: 'bg-amber-400' },
  cohere: { icon: Cloud, accent: 'text-teal-300', dot: 'bg-teal-400' },
  togetherai: { icon: Cloud, accent: 'text-pink-300', dot: 'bg-pink-400' },
  local: { icon: Cpu, accent: 'text-slate-200', dot: 'bg-slate-300' },
  ollama: { icon: Cpu, accent: 'text-indigo-300', dot: 'bg-indigo-400' },
  mock: { icon: Cloud, accent: 'text-zinc-300', dot: 'bg-zinc-400' },
};

const STATUS_BADGE: Record<string, string> = {
  completed: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100',
  running: 'border-cyan-400/20 bg-cyan-400/10 text-cyan-100',
  failed: 'border-red-400/20 bg-red-400/10 text-red-100',
  pending: 'border-amber-300/20 bg-amber-300/10 text-amber-100',
};

function ProviderCard({
  provider,
  selected,
  disabled,
  modelId,
  models,
  onToggle,
  onChange,
}: {
  provider: string;
  selected: boolean;
  disabled?: boolean;
  modelId: string;
  models: string[];
  onToggle: () => void;
  onChange: (next: string) => void;
}) {
  const meta = PROVIDER_META[provider] ?? PROVIDER_META.mock;
  const Icon = meta.icon;

  return (
    <div
      className={cn(
        'rounded-2xl border p-3 transition-all',
        selected ? 'border-cyan-300/30 bg-cyan-300/10 shadow-[0_0_0_1px_rgba(103,232,249,0.12)]' : 'border-white/10 bg-white/[0.03]',
        disabled && 'opacity-45'
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        className="flex w-full items-center gap-2 text-left disabled:cursor-not-allowed"
      >
        <Icon className={cn('h-4 w-4', meta.accent)} />
        <span className={cn('flex-1 font-medium capitalize', meta.accent)}>{provider}</span>
        {disabled && <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">no key</span>}
        {selected && (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-cyan-300 text-slate-950">
            <Check className="h-3 w-3" />
          </span>
        )}
      </button>
      <select
        value={modelId}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="mt-3 h-9 w-full rounded-xl border border-white/10 bg-slate-950/90 px-3 text-xs text-slate-100 outline-none"
      >
        {models.map((model) => (
          <option key={model} value={model}>
            {model}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function EvalsDashboard() {
  const navigate = useNavigate();
  const {
    runs,
    setRuns,
    addRunSummary,
    activeRun,
    setActiveRun,
    clearResults,
    loading,
    setLoading,
    setError,
    runtimeStatus,
    setRuntimeStatus,
  } = useEvalStore();

  const [availableModels, setAvailableModels] = useState<AvailableModels | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showInfoPanel, setShowInfoPanel] = useState(false);
  const [runName, setRunName] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [evalFile, setEvalFile] = useState<File | null>(null);
  const [parsedKeys, setParsedKeys] = useState<string[]>([]);
  const [inputKeys, setInputKeys] = useState<string[]>([]);
  const [outputKey, setOutputKey] = useState('');
  const [filePreview, setFilePreview] = useState<Record<string, unknown> | null>(null);
  const [selectedModels, setSelectedModels] = useState<ModelSpec[]>([]);
  const [perProviderModel, setPerProviderModel] = useState<Record<string, string>>({});
  const [maxTokens, setMaxTokens] = useState(256);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const infoPanelRef = useRef<HTMLDivElement>(null);

  const fallbackMode = runtimeStatus.storageMode === 'memory';
  const configuredModelCount = availableModels
    ? availableModels.apiProviders.length + availableModels.localModels.length + availableModels.ollamaModels.length
    : 0;

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setModelsLoading(true);
      setModelsError(null);
      setError(null);

      try {
        const models = await evalService.getModels();
        if (cancelled) {
          return;
        }

        setAvailableModels(models);
        setRuntimeStatus(models.runtime);

        if (models.runtime.databaseConnected) {
          const summaries = await evalService.listRuns();
          if (!cancelled) {
            setRuns(summaries);
          }
        } else if (!cancelled) {
          setRuns(
            activeRun?.storage_mode === 'memory'
              ? [{
                  id: activeRun.id,
                  name: activeRun.name,
                  status: activeRun.status,
                  model_count: activeRun.models_config.length,
                  created_at: activeRun.created_at,
                  completed_at: activeRun.completed_at,
                  storage_mode: 'memory',
                }]
              : []
          );
        }
      } catch (error: any) {
        if (!cancelled) {
          const message = error.message ?? 'Failed to load Eval Atlas';
          setModelsError(message);
          setError(message);
        }
      } finally {
        if (!cancelled) {
          setModelsLoading(false);
          setLoading(false);
        }
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!showInfoPanel) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!infoPanelRef.current?.contains(event.target as Node)) {
        setShowInfoPanel(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setShowInfoPanel(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showInfoPanel]);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setEvalFile(file);
    setParsedKeys([]);
    setInputKeys([]);
    setOutputKey('');
    setFilePreview(null);

    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const raw = text.trim();
      const items = raw.startsWith('[')
        ? JSON.parse(raw)
        : raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));

      if (items.length === 0 || typeof items[0] !== 'object' || items[0] === null) {
        return;
      }

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
      // Backend does final validation. UI preview is best-effort only.
    }
  }

  function toggleInputKey(key: string) {
    setInputKeys((previous) =>
      previous.includes(key) ? previous.filter((entry) => entry !== key) : [...previous, key]
    );
  }

  function toggleProvider(provider: string, defaultModel: string, explicitModelId?: string) {
    const resolvedModelId = explicitModelId ?? perProviderModel[provider] ?? defaultModel;
    setSelectedModels((previous) =>
      previous.some((model) => model.provider === provider)
        ? previous.filter((model) => model.provider !== provider)
        : [...previous, { provider, modelId: resolvedModelId }]
    );
  }

  function changeProviderModel(provider: string, modelId: string) {
    setPerProviderModel((previous) => ({ ...previous, [provider]: modelId }));
    setSelectedModels((previous) =>
      previous.map((model) => (model.provider === provider ? { ...model, modelId } : model))
    );
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);

    if (!runName.trim()) {
      setFormError('Run name is required.');
      return;
    }
    if (!evalFile) {
      setFormError('Select an eval file.');
      return;
    }
    if (selectedModels.length === 0) {
      setFormError('Select at least one model.');
      return;
    }

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
      setRuntimeStatus({
        databaseConnected: response.storageMode === 'database',
        storageMode: response.storageMode,
        databaseError: response.databaseError ?? null,
      });

      navigate(`/evals/${response.runId}`);
    } catch (error: any) {
      setFormError(error.message ?? 'Failed to start eval.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="space-y-6">
            <section className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-6 shadow-[0_30px_90px_rgba(0,0,0,0.28)] backdrop-blur-xl sm:p-8">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="mb-3 flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-300/10">
                      <FlaskConical className="h-4 w-4 text-cyan-200" />
                    </div>
                    <span className="text-xs font-bold uppercase tracking-[0.28em] text-cyan-200/70">Eval Atlas</span>
                  </div>
                  <h1 className="text-3xl font-bold tracking-tight text-slate-100 sm:text-4xl">Evaluation Dashboard</h1>
                  <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-400">
                    Launch eval runs, stream results live, and compare model behavior without waiting on database recovery.
                  </p>
                </div>
                <div className="relative flex items-center gap-3" ref={infoPanelRef}>
                  <div className="group relative">
                    <button
                      type="button"
                      aria-label="Open dashboard guidance"
                      aria-expanded={showInfoPanel}
                      onClick={() => setShowInfoPanel((value) => !value)}
                      className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-slate-300 transition-colors hover:bg-white/[0.08] hover:text-slate-100"
                    >
                      <Info className="h-4 w-4" />
                    </button>
                    <div className="pointer-events-none absolute right-0 top-full z-10 mt-2 rounded-xl border border-white/10 bg-slate-950/95 px-3 py-2 text-xs text-slate-300 opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                      Relevant details and run checklist
                    </div>
                  </div>

                  <Button
                    onClick={() => setShowForm((value) => !value)}
                    className={cn(
                      'h-11 gap-2 rounded-2xl border border-cyan-300/20 bg-cyan-300/90 px-5 font-semibold text-slate-950 shadow-[0_10px_30px_rgba(34,211,238,0.28)] hover:bg-cyan-200',
                      showForm && 'border-white/10 bg-white/[0.04] text-slate-100 shadow-none hover:bg-white/[0.08]'
                    )}
                  >
                    {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                    {showForm ? 'Close form' : 'New eval run'}
                  </Button>

                  {showInfoPanel && (
                    <div className="absolute right-0 top-full z-20 mt-3 w-[min(30rem,calc(100vw-2rem))] rounded-[1.6rem] border border-white/10 bg-slate-950/96 p-4 shadow-[0_30px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">Dashboard guidance</p>
                        <button
                          type="button"
                          onClick={() => setShowInfoPanel(false)}
                          className="rounded-full border border-white/10 p-1 text-slate-400 transition-colors hover:text-slate-100"
                          aria-label="Close dashboard guidance"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      <div className="space-y-3">
                        <details className="group rounded-2xl border border-white/10 bg-white/[0.03] p-4" open>
                          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-slate-100">
                            Relevant details
                            <ChevronDown className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180" />
                          </summary>
                          <div className="mt-4 space-y-4 text-sm text-slate-300">
                            <div>
                              <p className="font-semibold text-slate-100">Persistence</p>
                              <p className="mt-1 text-slate-400">{fallbackMode ? 'Database is down, so UI skips stored-history fetches and new runs live in memory.' : 'Run metadata and results are stored in Postgres.'}</p>
                            </div>
                            <div>
                              <p className="font-semibold text-slate-100">Model access</p>
                              <p className="mt-1 text-slate-400">Cloud providers need API keys. Ollama and local agent models appear only when reachable.</p>
                            </div>
                            <div>
                              <p className="font-semibold text-slate-100">Eval flow</p>
                              <p className="mt-1 text-slate-400">Upload data, confirm field mapping, choose models, and stream results live on the next screen.</p>
                            </div>
                          </div>
                        </details>

                        <details className="group rounded-2xl border border-white/10 bg-gradient-to-br from-cyan-400/10 via-transparent to-orange-400/10 p-4">
                          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-slate-100">
                            Run checklist
                            <ChevronDown className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180" />
                          </summary>
                          <div className="mt-4 space-y-3 text-sm text-slate-300">
                            <div className="rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3">Name the run so results stay searchable.</div>
                            <div className="rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3">Use the first-record preview to verify prompt and expected-answer mapping.</div>
                            <div className="rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3">Keep token ceilings low unless the task truly needs long-form answers.</div>
                          </div>
                        </details>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-8 grid gap-4 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
                  <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Storage mode</p>
                  <p className="mt-3 text-lg font-semibold text-slate-100">{fallbackMode ? 'Fallback memory' : 'Persistent database'}</p>
                  <p className="mt-1 text-sm text-slate-400">{fallbackMode ? 'Runs stream live but are not durable.' : 'Runs persist and can be reopened later.'}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
                  <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Models discovered</p>
                  <p className="mt-3 text-3xl font-bold text-slate-100">{configuredModelCount || '—'}</p>
                  <p className="mt-1 text-sm text-slate-400">Cloud, Ollama, and local endpoints</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
                  <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Runs visible</p>
                  <p className="mt-3 text-3xl font-bold text-slate-100">{runs.length}</p>
                  <p className="mt-1 text-sm text-slate-400">{fallbackMode ? 'Current server session only' : 'Recent stored runs'}</p>
                </div>
              </div>
            </section>

            {fallbackMode && (
              <section className="rounded-[1.6rem] border border-amber-400/20 bg-amber-400/10 px-5 py-4 text-sm text-amber-100">
                <div className="flex items-start gap-3">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-semibold">Postgres unavailable. Eval Atlas switched to fallback mode.</p>
                    <p className="mt-1 text-amber-100/80">
                      The UI skips history calls that need the database. New runs still execute on the server and stream here live.
                      {runtimeStatus.databaseError ? ` Last DB error: ${runtimeStatus.databaseError}` : ''}
                    </p>
                  </div>
                </div>
              </section>
            )}

            {showForm && (
              <form onSubmit={handleSubmit} className="rounded-[2rem] border border-white/10 bg-slate-950/75 p-6 shadow-[0_28px_90px_rgba(0,0,0,0.35)] backdrop-blur-xl">
                <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]">
                  <div className="space-y-6">
                    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                      <div className="mb-4">
                        <h2 className="text-lg font-semibold text-slate-100">Run details</h2>
                        <p className="mt-1 text-sm text-slate-400">Name the run, add an optional system prompt, and set a token ceiling.</p>
                      </div>
                      <div className="space-y-4">
                        <div>
                          <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Run name</label>
                          <Input value={runName} onChange={(event) => setRunName(event.target.value)} placeholder="e.g. support-qa-benchmark-v2" />
                        </div>
                        <div>
                          <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">System prompt</label>
                          <textarea
                            value={systemPrompt}
                            onChange={(event) => setSystemPrompt(event.target.value)}
                            rows={5}
                            placeholder="Optional instructions shared across all models"
                            className="w-full rounded-2xl border border-white/10 bg-slate-950/90 px-4 py-3 text-sm text-slate-100 outline-none"
                          />
                        </div>
                        <div>
                          <div className="mb-2 flex items-center justify-between">
                            <label className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Max tokens</label>
                            <span className="rounded-full bg-white/8 px-2.5 py-0.5 text-xs font-semibold text-slate-200">{maxTokens}</span>
                          </div>
                          <input
                            type="range"
                            min={16}
                            max={2048}
                            step={16}
                            value={maxTokens}
                            onChange={(event) => setMaxTokens(Number(event.target.value))}
                            className="w-full accent-cyan-300"
                          />
                          <p className="mt-2 text-xs text-slate-400">Use 32-128 for short deterministic answers. Raise only when the task truly needs longer output.</p>
                        </div>
                      </div>
                    </section>

                    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                      <div className="mb-4 flex items-start justify-between gap-4">
                        <div>
                          <h2 className="text-lg font-semibold text-slate-100">Eval file</h2>
                          <p className="mt-1 text-sm text-slate-400">Upload JSON or JSONL. The first row is previewed so you can map input and expected-output fields.</p>
                        </div>
                        <Button type="button" variant="outline" className="gap-2" onClick={() => fileInputRef.current?.click()}>
                          <Upload className="h-4 w-4" />
                          {evalFile ? 'Replace file' : 'Choose file'}
                        </Button>
                      </div>

                      <input ref={fileInputRef} type="file" accept=".json,.jsonl" onChange={handleFileChange} className="hidden" />

                      <div className="rounded-2xl border border-dashed border-white/10 bg-slate-900/50 p-4">
                        <p className="text-sm font-medium text-slate-100">{evalFile ? evalFile.name : 'No file selected'}</p>
                        <p className="mt-1 text-xs text-slate-400">{evalFile ? `${Math.max(1, Math.round(evalFile.size / 1024))} KB` : 'Upload a dataset to enable field mapping and preview.'}</p>
                      </div>

                      {parsedKeys.length > 0 && (
                        <div className="mt-4 grid gap-4 lg:grid-cols-2">
                          <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-4">
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

                          <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-4">
                            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Expected answer field</p>
                            <select
                              value={outputKey}
                              onChange={(event) => setOutputKey(event.target.value)}
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
                        <div className="mt-4 rounded-2xl border border-white/10 bg-slate-900/50 p-4">
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
                  </div>

                  <div className="space-y-6">
                    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                      <div className="mb-4">
                        <h2 className="text-lg font-semibold text-slate-100">Models</h2>
                        <p className="mt-1 text-sm text-slate-400">Pick one or more endpoints to score against the same eval set.</p>
                      </div>

                      {modelsLoading && <p className="text-sm text-slate-400">Loading available models…</p>}
                      {modelsError && (
                        <div className="rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-100">
                          {modelsError}
                        </div>
                      )}

                      {availableModels && (
                        <div className="space-y-5">
                          <div>
                            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Cloud APIs</p>
                            <div className="grid gap-3">
                              {availableModels.apiProviders.map((provider) => {
                                const currentModel = perProviderModel[provider.provider] ?? provider.defaultModel;
                                const selected = selectedModels.some((entry) => entry.provider === provider.provider);
                                return (
                                  <ProviderCard
                                    key={provider.provider}
                                    provider={provider.provider}
                                    selected={selected}
                                    disabled={!provider.configured}
                                    modelId={currentModel}
                                    models={provider.models ?? [provider.defaultModel]}
                                    onToggle={() => toggleProvider(provider.provider, provider.defaultModel, currentModel)}
                                    onChange={(next) => changeProviderModel(provider.provider, next)}
                                  />
                                );
                              })}
                            </div>
                          </div>

                          {availableModels.ollamaModels.length > 0 && (
                            <div>
                              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Ollama</p>
                              <div className="grid gap-3">
                                {availableModels.ollamaModels.map((model) => {
                                  const selected = selectedModels.some((entry) => entry.provider === 'ollama' && entry.modelId === model.id);
                                  return (
                                    <ProviderCard
                                      key={model.id}
                                      provider="ollama"
                                      selected={selected}
                                      modelId={model.id}
                                      models={[model.id]}
                                      onToggle={() => {
                                        setSelectedModels((previous) =>
                                          previous.some((entry) => entry.provider === 'ollama' && entry.modelId === model.id)
                                            ? previous.filter((entry) => !(entry.provider === 'ollama' && entry.modelId === model.id))
                                            : [...previous, { provider: 'ollama', modelId: model.id }]
                                        );
                                      }}
                                      onChange={() => undefined}
                                    />
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {availableModels.localModels.length > 0 && (
                            <div>
                              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Local agent models</p>
                              <div className="grid gap-3">
                                {availableModels.localModels.map((model) => {
                                  const selected = selectedModels.some((entry) => entry.provider === 'local' && entry.modelId === model.id);
                                  return (
                                    <ProviderCard
                                      key={model.id}
                                      provider="local"
                                      selected={selected}
                                      modelId={model.id}
                                      models={[model.id]}
                                      onToggle={() => {
                                        setSelectedModels((previous) =>
                                          previous.some((entry) => entry.provider === 'local' && entry.modelId === model.id)
                                            ? previous.filter((entry) => !(entry.provider === 'local' && entry.modelId === model.id))
                                            : [...previous, { provider: 'local', modelId: model.id }]
                                        );
                                      }}
                                      onChange={() => undefined}
                                    />
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </section>

                    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Launch summary</p>
                      <div className="mt-4 space-y-3 text-sm text-slate-300">
                        <div className="rounded-2xl border border-white/10 bg-slate-900/50 px-4 py-3">
                          <span className="font-semibold text-slate-100">Selected models:</span> {selectedModels.length || 0}
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-slate-900/50 px-4 py-3">
                          <span className="font-semibold text-slate-100">Eval file:</span> {evalFile?.name ?? 'none'}
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-slate-900/50 px-4 py-3">
                          <span className="font-semibold text-slate-100">Persistence:</span> {fallbackMode ? 'memory only' : 'database-backed'}
                        </div>
                      </div>

                      {formError && (
                        <div className="mt-4 rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-100">
                          {formError}
                        </div>
                      )}

                      <Button
                        type="submit"
                        disabled={submitting || !runName.trim() || !evalFile || selectedModels.length === 0}
                        className="mt-5 h-11 w-full gap-2 rounded-2xl bg-cyan-300 font-semibold text-slate-950 hover:bg-cyan-200"
                      >
                        {submitting ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <FlaskConical className="h-4 w-4" />}
                        {submitting ? 'Starting eval…' : 'Start eval run'}
                      </Button>
                    </section>
                  </div>
                </div>
              </form>
            )}

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">
                  {fallbackMode ? 'Session runs' : 'Recent runs'}
                </h2>
                {!loading && <span className="text-xs text-slate-500">{runs.length} visible</span>}
              </div>

              {loading ? (
                <div className="space-y-3">
                  {[...Array(3)].map((_, index) => (
                    <div key={index} className="h-20 rounded-2xl shimmer" />
                  ))}
                </div>
              ) : runs.length === 0 ? (
                <div className="rounded-[2rem] border border-dashed border-white/10 bg-white/[0.03] py-16 text-center backdrop-blur-xl">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
                    <FlaskConical className="h-7 w-7 text-muted-foreground/50" />
                  </div>
                  <h3 className="font-semibold text-slate-100">{fallbackMode ? 'No fallback runs yet' : 'No evaluation runs yet'}</h3>
                  <p className="mx-auto mt-2 max-w-sm text-sm text-slate-400">
                    {fallbackMode
                      ? 'Create a run to execute immediately. Without Postgres, only current-session runs are shown here.'
                      : 'Create your first eval run to compare model outputs side-by-side.'}
                  </p>
                </div>
              ) : (
                runs.map((run) => (
                  <button
                    key={run.id}
                    onClick={() => navigate(`/evals/${run.id}`)}
                    className="group w-full rounded-[1.4rem] border border-white/10 bg-white/[0.03] px-5 py-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-cyan-400/20 hover:shadow-[0_20px_40px_rgba(0,0,0,0.18)]"
                  >
                    <div className="flex items-center gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-slate-100 transition-colors group-hover:text-cyan-100">{run.name}</div>
                        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                          <span className="flex items-center gap-1">
                            <Cpu className="h-3 w-3" />
                            {run.model_count} model{run.model_count !== 1 ? 's' : ''}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {new Date(run.created_at).toLocaleString()}
                          </span>
                          <span>{run.storage_mode === 'memory' ? 'session only' : 'persisted'}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge className={cn('rounded-full border px-2.5 py-0.5 text-[11px] font-semibold', STATUS_BADGE[run.status] ?? '')}>
                          {run.status}
                        </Badge>
                        <ChevronRight className="h-4 w-4 text-slate-500 transition-transform group-hover:translate-x-0.5 group-hover:text-cyan-100" />
                      </div>
                    </div>
                  </button>
                ))
              )}
            </section>
        </div>
      </div>
    </div>
  );
}
