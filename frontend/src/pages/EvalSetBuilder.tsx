import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Copy, Loader2, Plus, Sparkles, Trash2 } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { ModelSelector } from '../components/evals/ModelSelector';
import { evalService, type AuthoredEvalItem, type AvailableModels, type ModelSpec } from '../services/api';
import { useEvalStore } from '../store/useEvalStore';
import { cn } from '../lib/utils';

type RowErrors = Partial<Record<keyof AuthoredEvalItem, string>>;
const IN_EDIT_MODE = (evalSetId?: string | null) => Boolean(evalSetId);

function createBlankRow(index: number): AuthoredEvalItem {
  return {
    id: `row-${index + 1}`,
    question: '',
    type: 'multiple_choice',
    choices: {
      A: '',
      B: '',
      C: '',
      D: '',
    },
    correct_answer: 'A',
    category: '',
    origin: 'human',
  };
}

function normalizeRow(row: AuthoredEvalItem): AuthoredEvalItem {
  if (row.type === 'multiple_choice') {
    return {
      ...row,
      choices: {
        A: row.choices?.A ?? '',
        B: row.choices?.B ?? '',
        C: row.choices?.C ?? '',
        D: row.choices?.D ?? '',
      },
      match_type: undefined,
      origin: row.origin ?? 'human',
    };
  }

  return {
    ...row,
    choices: undefined,
    match_type: row.match_type ?? 'contains',
    origin: row.origin ?? 'human',
  };
}

function getRowErrors(row: AuthoredEvalItem): RowErrors {
  const errors: RowErrors = {};
  if (!row.id.trim()) {
    errors.id = 'Required';
  }
  if (!row.question.trim()) {
    errors.question = 'Required';
  }
  if (!row.correct_answer.trim()) {
    errors.correct_answer = 'Required';
  }
  if (row.type === 'multiple_choice') {
    for (const key of ['A', 'B', 'C', 'D'] as const) {
      if (!row.choices?.[key]?.trim()) {
        errors.choices = 'Choices A-D are required';
        break;
      }
    }
    if (!['A', 'B', 'C', 'D'].includes(row.correct_answer)) {
      errors.correct_answer = 'Must be A, B, C, or D';
    }
  }
  return errors;
}

export default function EvalSetBuilder() {
  const navigate = useNavigate();
  const { evalSetId } = useParams<{ evalSetId: string }>();
  const { setRuntimeStatus, clearResults, setActiveRun, addRunSummary } = useEvalStore();

  const [availableModels, setAvailableModels] = useState<AvailableModels | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [startingRun, setStartingRun] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [showGenerateModal, setShowGenerateModal] = useState(false);

  const [setId, setSetId] = useState<string | null>(evalSetId ?? null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [defaultSystemPrompt, setDefaultSystemPrompt] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [rows, setRows] = useState<AuthoredEvalItem[]>([createBlankRow(0)]);
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [runName, setRunName] = useState('');
  const [maxTokens, setMaxTokens] = useState(256);
  const [selectedModels, setSelectedModels] = useState<ModelSpec[]>([]);
  const [generateCount, setGenerateCount] = useState(3);
  const [generateCategory, setGenerateCategory] = useState('');
  const [generateInstructions, setGenerateInstructions] = useState('');
  const [generateProvider, setGenerateProvider] = useState<string | null>(null);
  const isEditMode = IN_EDIT_MODE(evalSetId);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setPageError(null);
      try {
        const models = await evalService.getModels();
        if (cancelled) {
          return;
        }
        setAvailableModels(models);
        setRuntimeStatus(models.runtime);

        if (evalSetId) {
          const evalSet = await evalService.getEvalSet(evalSetId);
          if (cancelled) {
            return;
          }
          setSetId(evalSet.id);
          setName(evalSet.name);
          setDescription(evalSet.description ?? '');
          setDefaultSystemPrompt(evalSet.default_system_prompt ?? '');
          setTagsInput(evalSet.tags.join(', '));
          setRows(evalSet.items.map(normalizeRow));
          setRunName(`${evalSet.name} run`);
        }
      } catch (error: any) {
        if (!cancelled) {
          setPageError(error.message ?? 'Failed to load eval builder');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [evalSetId, setRuntimeStatus]);

  const validationByRow = useMemo(() => {
    const seen = new Set<string>();
    return rows.map((row) => {
      const errors = getRowErrors(row);
      if (seen.has(row.id.trim())) {
        errors.id = 'Must be unique';
      }
      if (row.id.trim()) {
        seen.add(row.id.trim());
      }
      return errors;
    });
  }, [rows]);

  const validationSummary = useMemo(() => {
    const rowProblems = validationByRow
      .map((errors, index) => ({ index, count: Object.keys(errors).length }))
      .filter((entry) => entry.count > 0);

    const formErrors: string[] = [];
    if (!name.trim()) {
      formErrors.push('Eval set name is required.');
    }
    if (rows.length === 0) {
      formErrors.push('Add at least one row.');
    }

    return {
      formErrors,
      rowProblems,
      hasErrors: formErrors.length > 0 || rowProblems.length > 0,
    };
  }, [name, rows.length, validationByRow]);

  function updateRow(index: number, patch: Partial<AuthoredEvalItem>) {
    setRows((current) => current.map((row, rowIndex) => (
      rowIndex === index ? normalizeRow({ ...row, ...patch }) : row
    )));
  }

  function updateChoice(index: number, key: 'A' | 'B' | 'C' | 'D', value: string) {
    setRows((current) => current.map((row, rowIndex) => {
      if (rowIndex !== index) {
        return row;
      }
      return normalizeRow({
        ...row,
        choices: {
          A: row.choices?.A ?? '',
          B: row.choices?.B ?? '',
          C: row.choices?.C ?? '',
          D: row.choices?.D ?? '',
          [key]: value,
        },
      });
    }));
  }

  function addRow() {
    setRows((current) => [...current, createBlankRow(current.length)]);
  }

  function duplicateRow(index: number) {
    setRows((current) => {
      const row = current[index];
      const duplicate = normalizeRow({
        ...row,
        id: `${row.id || 'row'}-copy-${Date.now().toString(36).slice(-4)}`,
      });
      const next = [...current];
      next.splice(index + 1, 0, duplicate);
      return next;
    });
  }

  function deleteRow(index: number) {
    setRows((current) => current.filter((_, rowIndex) => rowIndex !== index));
  }

  function toggleRowSelection(rowId: string) {
    setSelectedRows((current) => current.includes(rowId)
      ? current.filter((entry) => entry !== rowId)
      : [...current, rowId]);
  }

  async function saveEvalSet() {
    setSaving(true);
    setPageError(null);
    try {
      if (validationSummary.hasErrors) {
        throw new Error('Resolve validation errors before saving.');
      }

      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        default_system_prompt: defaultSystemPrompt.trim() || null,
        tags: tagsInput.split(',').map((tag) => tag.trim()).filter(Boolean),
        items: rows.map(normalizeRow),
      };

      const saved = setId
        ? await evalService.updateEvalSet(setId, payload)
        : await evalService.createEvalSet(payload);

      setSetId(saved.id);
      setRows(saved.items.map(normalizeRow));
      setName(saved.name);
      setDescription(saved.description ?? '');
      setDefaultSystemPrompt(saved.default_system_prompt ?? '');
      setTagsInput(saved.tags.join(', '));
      if (!evalSetId) {
        navigate(`/evals/builder/${saved.id}`, { replace: true });
      }
      return saved;
    } finally {
      setSaving(false);
    }
  }

  async function handleGenerate() {
    setGenerating(true);
    setPageError(null);
    try {
      const saved = setId ? null : await saveEvalSet();
      const resolvedId = setId ?? saved?.id;
      if (!resolvedId) {
        throw new Error('Save the eval set before generation.');
      }

      const response = await evalService.generateEvalSetItems(resolvedId, {
        seedItemKeys: selectedRows,
        count: generateCount,
        category: generateCategory.trim() || undefined,
        instructions: generateInstructions.trim() || undefined,
      });

      setGenerateProvider(response.provider);
      setRows((current) => [...current, ...response.items.map(normalizeRow)]);
      setShowGenerateModal(false);
    } catch (error: any) {
      setPageError(error.message ?? 'Failed to generate rows');
    } finally {
      setGenerating(false);
    }
  }

  async function handleStartRun() {
    setStartingRun(true);
    setPageError(null);
    try {
      if (!runName.trim()) {
        throw new Error('Run name is required.');
      }
      if (selectedModels.length === 0) {
        throw new Error('Select at least one model.');
      }

      const saved = setId ? null : await saveEvalSet();
      const resolvedId = setId ?? saved?.id;
      if (!resolvedId) {
        throw new Error('Save the eval set before starting a run.');
      }

      const response = await evalService.createRun({
        name: runName.trim(),
        systemPrompt: defaultSystemPrompt.trim(),
        modelsConfig: selectedModels,
        evalSetId: resolvedId,
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
      setPageError(error.message ?? 'Failed to start run');
    } finally {
      setStartingRun(false);
    }
  }

  if (loading) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-7xl px-6 py-10">
          <div className="space-y-4">
            {[...Array(5)].map((_, index) => (
              <div key={index} className="h-20 rounded-2xl shimmer" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="space-y-6">
          <button
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-400 transition-colors hover:text-slate-100"
            onClick={() => navigate('/evals')}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to dashboard
          </button>

          <section className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-6 shadow-[0_30px_90px_rgba(0,0,0,0.28)] backdrop-blur-xl sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.28em] text-cyan-200/70">UI Authored Eval Sets</p>
                <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-100">
                  {setId ? 'Edit eval set' : 'Create eval set in UI'}
                </h1>
                <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-400">
                  Build reusable eval sets in the browser, save them to Postgres, generate candidate rows, and launch runs from the saved set snapshot.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button type="button" variant="outline" className="gap-2" onClick={() => setShowGenerateModal(true)}>
                  <Sparkles className="h-4 w-4" />
                  Generate with AI
                </Button>
                <Button type="button" className="gap-2" onClick={() => void saveEvalSet()} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Save eval set
                </Button>
              </div>
            </div>

            {pageError && (
              <div className="mt-5 rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-100">
                {pageError}
              </div>
            )}

            {generateProvider && (
              <div className="mt-5 rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
                Last generation source: {generateProvider}
              </div>
            )}

            <div className={cn('mt-8 grid gap-6', isEditMode ? 'grid-cols-1' : 'xl:grid-cols-[1.7fr_1fr]')}>
              <div className="space-y-6">
                <section className="rounded-2xl border border-white/10 bg-slate-950/40 p-5">
                  <h2 className="text-lg font-semibold text-slate-100">Metadata</h2>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div className="md:col-span-2">
                      <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Name</label>
                      <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. retail-support-regression-set" />
                    </div>
                    <div className="md:col-span-2">
                      <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Description</label>
                      <textarea
                        value={description}
                        onChange={(event) => setDescription(event.target.value)}
                        rows={3}
                        className="w-full rounded-2xl border border-white/10 bg-slate-950/90 px-4 py-3 text-sm text-slate-100 outline-none"
                        placeholder="What this eval set is measuring"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Default system prompt</label>
                      <textarea
                        value={defaultSystemPrompt}
                        onChange={(event) => setDefaultSystemPrompt(event.target.value)}
                        rows={4}
                        className="w-full rounded-2xl border border-white/10 bg-slate-950/90 px-4 py-3 text-sm text-slate-100 outline-none"
                        placeholder="Optional default instructions to reuse when launching runs"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Tags</label>
                      <Input value={tagsInput} onChange={(event) => setTagsInput(event.target.value)} placeholder="comma, separated, tags" />
                    </div>
                  </div>
                </section>

                <section className="rounded-2xl border border-white/10 bg-slate-950/40 p-5">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold text-slate-100">Spreadsheet-style editor</h2>
                      <p className="mt-1 text-sm text-slate-400">Select seed rows, tab between fields, and press Enter on the last row to append a new row.</p>
                    </div>
                    <div className="text-xs text-slate-500">{rows.length} row{rows.length !== 1 ? 's' : ''}</div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="min-w-[920px] w-full border-separate border-spacing-y-2 text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-[0.2em] text-slate-500">
                          <th className="px-2 py-2">Seed</th>
                          <th className="px-2 py-2">Id</th>
                          <th className="px-2 py-2">Question</th>
                          <th className="px-2 py-2">Answer</th>
                          <th className="px-2 py-2">Details</th>
                          <th className="px-2 py-2">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row, index) => {
                          const rowErrors = validationByRow[index];
                          return (
                            <tr key={`${row.id}-${index}`} className="align-top">
                              <td className="rounded-l-2xl border border-white/10 bg-white/[0.03] px-2 py-3">
                                <input
                                  type="checkbox"
                                  checked={selectedRows.includes(row.id)}
                                  onChange={() => toggleRowSelection(row.id)}
                                  aria-label={`Select row ${row.id} for AI generation`}
                                />
                              </td>
                              <td className="border-y border-white/10 bg-white/[0.03] px-2 py-3">
                                <Input
                                  value={row.id}
                                  onChange={(event) => updateRow(index, { id: event.target.value })}
                                  className={cn(rowErrors.id && 'border-red-400/40')}
                                />
                                {rowErrors.id && <p className="mt-1 text-xs text-red-300">{rowErrors.id}</p>}
                              </td>
                              <td className="border-y border-white/10 bg-white/[0.03] px-2 py-3">
                                <textarea
                                  value={row.question}
                                  onChange={(event) => updateRow(index, { question: event.target.value })}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter' && index === rows.length - 1 && !event.shiftKey) {
                                      addRow();
                                    }
                                  }}
                                  rows={3}
                                  className={cn(
                                    'w-full rounded-2xl border border-white/10 bg-slate-950/90 px-3 py-2 text-sm text-slate-100 outline-none',
                                    rowErrors.question && 'border-red-400/40',
                                  )}
                                />
                                {rowErrors.question && <p className="mt-1 text-xs text-red-300">{rowErrors.question}</p>}
                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                  <select
                                    value={row.type}
                                    onChange={(event) => updateRow(index, { type: event.target.value as AuthoredEvalItem['type'] })}
                                    className="h-9 rounded-xl border border-white/10 bg-slate-950/90 px-3 text-xs text-slate-100 outline-none"
                                  >
                                    <option value="multiple_choice">multiple_choice</option>
                                    <option value="open_ended">open_ended</option>
                                  </select>
                                  {row.origin === 'ai_generated' ? (
                                    <Badge className="rounded-full border border-cyan-300/20 bg-cyan-300/10 text-cyan-100">AI generated</Badge>
                                  ) : (
                                    <Badge className="rounded-full border border-white/10 bg-white/[0.04] text-slate-300">Human</Badge>
                                  )}
                                </div>
                              </td>
                              <td className="border-y border-white/10 bg-white/[0.03] px-2 py-3">
                                {row.type === 'multiple_choice' ? (
                                  <div className="grid gap-2">
                                    {(['A', 'B', 'C', 'D'] as const).map((choiceKey) => (
                                      <div key={choiceKey} className="flex items-center gap-2">
                                        <span className="w-4 text-xs font-semibold text-slate-400">{choiceKey}</span>
                                        <Input
                                          value={row.choices?.[choiceKey] ?? ''}
                                          onChange={(event) => updateChoice(index, choiceKey, event.target.value)}
                                          className={cn(rowErrors.choices && 'border-red-400/40')}
                                        />
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="rounded-2xl border border-dashed border-white/10 px-3 py-6 text-center text-xs text-slate-500">
                                    Choices disabled for open-ended rows
                                  </div>
                                )}
                                {rowErrors.choices && <p className="mt-1 text-xs text-red-300">{rowErrors.choices}</p>}
                                {row.type === 'multiple_choice' ? (
                                  <div className="mt-3">
                                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Correct answer</label>
                                    <select
                                      value={row.correct_answer}
                                      onChange={(event) => updateRow(index, { correct_answer: event.target.value })}
                                      className={cn(
                                        'h-10 w-full rounded-xl border border-white/10 bg-slate-950/90 px-3 text-sm text-slate-100 outline-none',
                                        rowErrors.correct_answer && 'border-red-400/40',
                                      )}
                                    >
                                      <option value="A">A</option>
                                      <option value="B">B</option>
                                      <option value="C">C</option>
                                      <option value="D">D</option>
                                    </select>
                                  </div>
                                ) : (
                                  <div className="mt-3">
                                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Expected answer</label>
                                    <Input
                                      value={row.correct_answer}
                                      onChange={(event) => updateRow(index, { correct_answer: event.target.value })}
                                      className={cn(rowErrors.correct_answer && 'border-red-400/40')}
                                    />
                                  </div>
                                )}
                                {rowErrors.correct_answer && <p className="mt-1 text-xs text-red-300">{rowErrors.correct_answer}</p>}
                              </td>
                              <td className="border-y border-white/10 bg-white/[0.03] px-2 py-3">
                                <div className="space-y-3">
                                  <div>
                                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Category</label>
                                    <Input value={row.category ?? ''} onChange={(event) => updateRow(index, { category: event.target.value })} />
                                  </div>
                                  {row.type === 'open_ended' && (
                                    <div>
                                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Match type</label>
                                      <select
                                        value={row.match_type ?? 'contains'}
                                        onChange={(event) => updateRow(index, { match_type: event.target.value as AuthoredEvalItem['match_type'] })}
                                        className="h-10 w-full rounded-xl border border-white/10 bg-slate-950/90 px-3 text-sm text-slate-100 outline-none"
                                      >
                                        <option value="contains">contains</option>
                                        <option value="exact">exact</option>
                                        <option value="regex">regex</option>
                                      </select>
                                    </div>
                                  )}
                                </div>
                              </td>
                              <td className="rounded-r-2xl border border-white/10 bg-white/[0.03] px-2 py-3">
                                <div className="flex gap-2">
                                  <Button type="button" variant="outline" size="sm" onClick={() => duplicateRow(index)}>
                                    <Copy className="h-4 w-4" />
                                  </Button>
                                  <Button type="button" variant="outline" size="sm" onClick={() => deleteRow(index)}>
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-4 flex justify-end">
                    <Button type="button" variant="outline" className="gap-2" onClick={addRow}>
                      <Plus className="h-4 w-4" />
                      Add row
                    </Button>
                  </div>
                </section>
              </div>

              {!isEditMode && (
                <div className="space-y-6">
                  <section className="rounded-2xl border border-white/10 bg-slate-950/40 p-5">
                    <h2 className="text-lg font-semibold text-slate-100">Validation</h2>
                    {!validationSummary.hasErrors ? (
                      <p className="mt-3 text-sm text-emerald-200">No blocking validation issues.</p>
                    ) : (
                      <div className="mt-3 space-y-2 text-sm text-amber-100">
                        {validationSummary.formErrors.map((error) => (
                          <div key={error} className="rounded-2xl border border-amber-300/20 bg-amber-300/10 px-3 py-2">{error}</div>
                        ))}
                        {validationSummary.rowProblems.map((problem) => (
                          <div key={problem.index} className="rounded-2xl border border-amber-300/20 bg-amber-300/10 px-3 py-2">
                            Row {problem.index + 1} has {problem.count} issue{problem.count !== 1 ? 's' : ''}.
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  <section className="rounded-2xl border border-white/10 bg-slate-950/40 p-5">
                    <h2 className="text-lg font-semibold text-slate-100">Use for run</h2>
                    <div className="mt-4 space-y-4">
                      <div>
                        <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Run name</label>
                        <Input value={runName} onChange={(event) => setRunName(event.target.value)} placeholder="e.g. retail-support-ui-set run" />
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
                      </div>
                      {availableModels ? (
                        <ModelSelector availableModels={availableModels} selectedModels={selectedModels} onChange={setSelectedModels} />
                      ) : null}
                      <Button
                        type="button"
                        className="w-full gap-2"
                        disabled={startingRun || validationSummary.hasErrors || selectedModels.length === 0}
                        onClick={() => void handleStartRun()}
                      >
                        {startingRun ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        Start run with this eval set
                      </Button>
                    </div>
                  </section>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      {showGenerateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4">
          <div className="w-full max-w-lg rounded-[1.8rem] border border-white/10 bg-slate-950 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-100">Generate with AI</h2>
                <p className="mt-2 text-sm text-slate-400">
                  {selectedRows.length > 0
                    ? `${selectedRows.length} selected seed row${selectedRows.length !== 1 ? 's' : ''} will be used.`
                    : 'No rows selected. The first few valid rows will be used as seeds.'}
                </p>
              </div>
              <Button type="button" variant="outline" onClick={() => setShowGenerateModal(false)}>Close</Button>
            </div>

            <div className="mt-6 space-y-4">
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Rows to generate</label>
                <Input type="number" min={1} max={25} value={generateCount} onChange={(event) => setGenerateCount(Number(event.target.value))} />
              </div>
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Category focus</label>
                <Input value={generateCategory} onChange={(event) => setGenerateCategory(event.target.value)} placeholder="Optional category" />
              </div>
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Difficulty or style guidance</label>
                <textarea
                  value={generateInstructions}
                  onChange={(event) => setGenerateInstructions(event.target.value)}
                  rows={4}
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/90 px-4 py-3 text-sm text-slate-100 outline-none"
                  placeholder="Optional instructions for difficulty, tone, or style"
                />
              </div>
            </div>

            <Button type="button" className="mt-6 w-full gap-2" onClick={() => void handleGenerate()} disabled={generating}>
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Generate draft rows
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
