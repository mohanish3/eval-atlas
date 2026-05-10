// frontend/src/components/evals/ModelDrilldown.tsx
import { useState } from 'react';
import { X, ChevronUp, ChevronDown } from 'lucide-react';
import { Badge } from '../ui/badge';
import { useEvalStore } from '../../store/useEvalStore';
import type { EvalResult } from '../../store/useEvalStore';
import { cn } from '../../lib/utils';

type SortField = 'category' | 'is_correct' | 'latency_ms';

interface ModelDrilldownProps {
  runId: string;
  modelId: string;
  onClose: () => void;
}

export function ModelDrilldown({ runId, modelId, onClose }: ModelDrilldownProps) {
  const results = useEvalStore((s) => s.results);
  const [sortField, setSortField] = useState<SortField>('is_correct');
  const [sortAsc, setSortAsc] = useState(false);

  const modelResults: EvalResult[] = Object.values(results)
    .filter((r) => r.run_id === runId && r.model_id === modelId)
    .sort((a, b) => {
      let cmp = 0;
      if (sortField === 'category') {
        cmp = (a.category ?? '').localeCompare(b.category ?? '');
      } else if (sortField === 'is_correct') {
        cmp = a.is_correct === b.is_correct ? 0 : a.is_correct ? -1 : 1;
      } else if (sortField === 'latency_ms') {
        cmp = (a.latency_ms ?? 0) - (b.latency_ms ?? 0);
      }
      return sortAsc ? cmp : -cmp;
    });

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortAsc((v) => !v);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ChevronUp className="w-3 h-3 opacity-20" />;
    return sortAsc
      ? <ChevronUp className="w-3 h-3 text-primary" />
      : <ChevronDown className="w-3 h-3 text-primary" />;
  }

  const passCount = modelResults.filter((r) => r.is_correct === true).length;
  const failCount = modelResults.filter((r) => r.is_correct === false && r.error_type !== 'runtime_error').length;
  const errorCount = modelResults.filter((r) => r.error_type === 'runtime_error').length;

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-background rounded-t-2xl sm:rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col animate-slide-up">

        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b shrink-0">
          <div>
            <h2 className="font-semibold">{modelId}</h2>
            <div className="flex items-center gap-3 mt-1 text-xs">
              <span className="text-emerald-600 font-medium">{passCount} pass</span>
              <span className="text-muted-foreground">{failCount} fail</span>
              {errorCount > 0 && <span className="text-destructive">{errorCount} error</span>}
              <span className="text-muted-foreground">{modelResults.length} total</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Table */}
        <div className="overflow-auto flex-1">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card/95 backdrop-blur border-b">
              <tr>
                <th
                  className="text-left p-3 text-xs font-semibold text-muted-foreground cursor-pointer hover:text-foreground transition-colors whitespace-nowrap"
                  onClick={() => toggleSort('category')}
                >
                  <span className="flex items-center gap-1">Category <SortIcon field="category" /></span>
                </th>
                <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Input</th>
                <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Output</th>
                <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Expected</th>
                <th
                  className="text-left p-3 text-xs font-semibold text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
                  onClick={() => toggleSort('is_correct')}
                >
                  <span className="flex items-center gap-1">Result <SortIcon field="is_correct" /></span>
                </th>
                <th
                  className="text-left p-3 text-xs font-semibold text-muted-foreground cursor-pointer hover:text-foreground transition-colors whitespace-nowrap"
                  onClick={() => toggleSort('latency_ms')}
                >
                  <span className="flex items-center gap-1">Latency <SortIcon field="latency_ms" /></span>
                </th>
              </tr>
            </thead>
            <tbody>
              {modelResults.map((r, i) => (
                <tr
                  key={r.id}
                  className={cn(
                    'border-t transition-colors',
                    r.is_correct === true
                      ? 'hover:bg-emerald-50/50'
                      : r.error_type === 'runtime_error'
                      ? 'hover:bg-red-50/50'
                      : 'hover:bg-muted/30'
                  )}
                  style={{ animationDelay: `${i * 20}ms` }}
                >
                  <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">{r.category ?? '—'}</td>
                  <td className="p-3 max-w-[200px]">
                    <span className="text-xs text-muted-foreground truncate block" title={r.question_id}>
                      {r.question_id}
                    </span>
                  </td>
                  <td className="p-3 max-w-[200px]">
                    <span className="font-mono text-[11px] break-all line-clamp-2 text-foreground">
                      {r.model_output ?? '—'}
                    </span>
                  </td>
                  <td className="p-3 max-w-[150px]">
                    <span className="text-[11px] text-muted-foreground break-all line-clamp-2">
                      {r.correct_answer ?? '—'}
                    </span>
                  </td>
                  <td className="p-3">
                    {r.error_type === 'runtime_error' ? (
                      <Badge variant="destructive" className="text-[10px] px-1.5">error</Badge>
                    ) : r.is_correct ? (
                      <Badge className="bg-emerald-500/10 text-emerald-700 border border-emerald-200 text-[10px] px-1.5">pass</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[10px] px-1.5">fail</Badge>
                    )}
                  </td>
                  <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
                    {r.latency_ms != null ? `${r.latency_ms}ms` : '—'}
                  </td>
                </tr>
              ))}
              {modelResults.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-sm text-muted-foreground">No results yet</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
