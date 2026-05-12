import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Download, Plus, TableProperties } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { evalService, type EvalSetSummary } from '../services/api';

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export default function EvalSetsPage() {
  const navigate = useNavigate();
  const [savedSets, setSavedSets] = useState<EvalSetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportingSetId, setExportingSetId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const evalSets = await evalService.listEvalSets();
        if (!cancelled) {
          setSavedSets(evalSets);
        }
      } catch (loadError: any) {
        if (!cancelled) {
          setError(loadError.message ?? 'Failed to load eval sets');
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
  }, []);

  async function handleExport(evalSetId: string) {
    setExportingSetId(evalSetId);
    try {
      const exported = await evalService.exportEvalSetCsv(evalSetId);
      downloadCsv(exported.filename, exported.csv);
    } catch (exportError: any) {
      setError(exportError.message ?? 'Failed to export eval set');
    } finally {
      setExportingSetId(null);
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="space-y-6">
          <section className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-6 shadow-[0_30px_90px_rgba(0,0,0,0.28)] backdrop-blur-xl sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-300/10">
                  <TableProperties className="h-5 w-5 text-cyan-200" />
                </div>
                <h1 className="text-3xl font-bold tracking-tight text-slate-100 sm:text-4xl">Saved eval sets</h1>
                <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-400">
                  Browse authored datasets separately from run dashboard. Export CSV, reopen builder, or create new set.
                </p>
              </div>
              <Button type="button" className="gap-2" onClick={() => navigate('/evals/builder/new')}>
                <Plus className="h-4 w-4" />
                New set
              </Button>
            </div>
          </section>

          {error && (
            <div className="rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-100">
              {error}
            </div>
          )}

          {loading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, index) => (
                <div key={index} className="h-28 rounded-2xl shimmer" />
              ))}
            </div>
          ) : savedSets.length === 0 ? (
            <section className="rounded-[2rem] border border-dashed border-white/10 bg-white/[0.03] py-16 text-center backdrop-blur-xl">
              <h2 className="text-lg font-semibold text-slate-100">No saved eval sets yet</h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">Create first reusable dataset in builder, then return here to manage and export it.</p>
            </section>
          ) : (
            <section className="grid gap-4 md:grid-cols-2">
              {savedSets.map((evalSet) => (
                <div key={evalSet.id} className="rounded-[1.6rem] border border-white/10 bg-white/[0.03] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.22)] backdrop-blur-xl">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-lg font-semibold text-slate-100">{evalSet.name}</div>
                      <p className="mt-2 text-sm text-slate-400">{evalSet.description || 'No description'}</p>
                    </div>
                    <ArrowRight className="mt-1 h-4 w-4 text-slate-500" />
                  </div>

                  <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-400">
                    <span>{evalSet.item_count} rows</span>
                    <span>Created {new Date(evalSet.created_at).toLocaleString()}</span>
                    <span>Updated {new Date(evalSet.updated_at).toLocaleString()}</span>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {evalSet.tags.length > 0 ? evalSet.tags.map((tag) => (
                      <Badge key={tag} className="rounded-full border border-white/10 bg-white/[0.04] text-slate-300">{tag}</Badge>
                    )) : (
                      <Badge className="rounded-full border border-white/10 bg-white/[0.04] text-slate-500">No tags</Badge>
                    )}
                  </div>

                  <div className="mt-5 flex flex-wrap gap-3">
                    <Button type="button" variant="outline" className="gap-2" onClick={() => navigate(`/evals/builder/${evalSet.id}`)}>
                      Edit set
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="gap-2"
                      disabled={exportingSetId === evalSet.id}
                      onClick={() => void handleExport(evalSet.id)}
                    >
                      <Download className="h-4 w-4" />
                      {exportingSetId === evalSet.id ? 'Exporting...' : 'Export CSV'}
                    </Button>
                  </div>
                </div>
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
