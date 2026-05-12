import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Clock, Database, FileText, FlaskConical, FolderKanban, Plus, Settings2, Upload } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { ModelSelector } from '../components/evals/ModelSelector';
import { evalService, type AvailableModels, type EvalSetSummary, type ModelSpec } from '../services/api';
import { useEvalStore } from '../store/useEvalStore';
import { cn } from '../lib/utils';

const STATUS_BADGE: Record<string, string> = {
  completed: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100',
  running: 'border-cyan-400/20 bg-cyan-400/10 text-cyan-100',
  failed: 'border-red-400/20 bg-red-400/10 text-red-100',
  pending: 'border-amber-300/20 bg-amber-300/10 text-amber-100',
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
  const [modelsLoading, setModelsLoading] = useState(false);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [runName, setRunName] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [evalFile, setEvalFile] = useState<File | null>(null);
  const [parsedKeys, setParsedKeys] = useState<string[]>([]);
  const [inputKeys, setInputKeys] = useState<string[]>([]);
  const [outputKey, setOutputKey] = useState('');
  const [filePreview, setFilePreview] = useState<Record<string, unknown> | null>(null);
  const [selectedModels, setSelectedModels] = useState<ModelSpec[]>([]);
  const [maxTokens, setMaxTokens] = useState(256);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fallbackMode = runtimeStatus.storageMode === 'memory';

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setModelsLoading(true);
      setError(null);
      try {
        const models = await evalService.getModels();
        if (cancelled) {
          return;
        }
        setAvailableModels(models);
        setRuntimeStatus(models.runtime);

        const runSummaries = await evalService.listRuns();
        if (cancelled) {
          return;
        }
        setRuns(runSummaries);

        const evalSets = await evalService.listEvalSets();
        if (!cancelled) {
          setSavedSets(evalSets);
        }
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
    return () => {
      cancelled = true;
    };
  }, [setError, setLoading, setRuns, setRuntimeStatus]);

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
      // Backend validation is authoritative.
    }
  }

  function toggleInputKey(key: string) {
    setInputKeys((current) => current.includes(key)
      ? current.filter((entry) => entry !== key)
      : [...current, key]);
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
                <h1 className="text-3xl font-bold tracking-tight text-slate-100 sm:text-4xl">Evaluation dashboard</h1>
                <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-400">
                  Run ad hoc eval files, jump into saved eval sets, and keep database wiring isolated in config instead of mixing it into run workflow.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button type="button" variant="outline" className="gap-2" onClick={() => setShowUploadForm((value) => !value)}>
                  <Upload className="h-4 w-4" />
                  Upload eval file
                </Button>
                <Button type="button" className="gap-2" onClick={() => navigate('/evals/builder/new')}>
                  <Plus className="h-4 w-4" />
                  Create evals
                </Button>
              </div>
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
                <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Storage mode</p>
                <p className="mt-3 text-lg font-semibold text-slate-100">{fallbackMode ? 'Fallback memory' : 'Persistent database'}</p>
                <p className="mt-1 text-sm text-slate-400">{fallbackMode ? 'Runs and authored sets are kept for the current server session.' : 'Runs and authored eval sets persist in Postgres.'}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
                <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Saved eval sets</p>
                <p className="mt-3 text-3xl font-bold text-slate-100">{fallbackMode ? '0' : savedSets.length}</p>
                <p className="mt-1 text-sm text-slate-400">Reusable authored datasets</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
                <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Recent runs</p>
                <p className="mt-3 text-3xl font-bold text-slate-100">{runs.length}</p>
                <p className="mt-1 text-sm text-slate-400">Visible in this workspace</p>
              </div>
            </div>

            {fallbackMode && (
              <div className="mt-6 rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
                Database connectivity unavailable. Session still supports authoring and runs in memory, but saved eval sets are not durable across restarts.
              </div>
            )}
          </section>

          

          {showUploadForm && (
            <form onSubmit={handleSubmit} className="grid gap-6 xl:grid-cols-[1.45fr_1fr]">
              <section className="space-y-6 rounded-[2rem] border border-white/10 bg-white/[0.03] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.22)] backdrop-blur-xl">
                <div>
                  <h2 className="text-xl font-semibold text-slate-100">Upload eval file</h2>
                  <p className="mt-2 text-sm text-slate-400">This remains the existing flow. Upload a dataset, map fields, and launch a run immediately.</p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="md:col-span-2">
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Run name</label>
                    <Input value={runName} onChange={(event) => setRunName(event.target.value)} placeholder="e.g. support-qa-benchmark-v2" />
                  </div>
                  <div className="md:col-span-2">
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">System prompt</label>
                    <textarea
                      value={systemPrompt}
                      onChange={(event) => setSystemPrompt(event.target.value)}
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
                      onChange={(event) => setMaxTokens(Number(event.target.value))}
                      className="w-full accent-cyan-300"
                    />
                    <div className="mt-2 text-xs text-slate-400">Current ceiling: {maxTokens}</div>
                  </div>
                </div>

                <section className="rounded-2xl border border-white/10 bg-slate-900/50 p-5">
                  <div className="mb-4 flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-100">Dataset</h3>
                      <p className="mt-1 text-sm text-slate-400">Upload JSON or JSONL. The first row is previewed so you can map prompt and expected-answer fields.</p>
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
                  className="group w-full rounded-[1.4rem] border border-white/10 bg-white/[0.03] px-5 py-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-cyan-400/20"
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
                        <span>{run.storage_mode === 'memory' ? 'session only' : 'persisted'}</span>
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
              <div className="mt-5 text-3xl font-bold text-slate-100">{fallbackMode ? '0' : savedSets.length}</div>
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
              <div className="mt-5 text-sm text-slate-300">{fallbackMode ? 'Memory fallback active' : 'Database persistence active'}</div>
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
