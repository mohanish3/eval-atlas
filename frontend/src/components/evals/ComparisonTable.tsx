// frontend/src/components/evals/ComparisonTable.tsx
import { useState, useEffect, useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
  type ColumnOrderState,
} from '@tanstack/react-table';
import { useEvalStore } from '../../store/useEvalStore';
import type { EvalResult } from '../../store/useEvalStore';
import { cn } from '../../lib/utils';

interface ComparisonTableProps {
  runId: string;
  models: Array<{ provider: string; modelId: string }>;
  onDrilldown: (modelId: string) => void;
}

interface MetricRow {
  metric: string;
  values: Record<string, string | number>;
  bestModelId: string | null;
  higherIsBetter: boolean;
}

const FIXED_COLUMNS = ['metric'];

function computeMetrics(
  results: EvalResult[],
  modelIds: string[],
): MetricRow[] {
  const rows: MetricRow[] = [];

  // Overall accuracy
  const accRow: MetricRow = { metric: 'Accuracy %', values: {}, bestModelId: null, higherIsBetter: true };
  let bestAcc = -1;
  for (const modelId of modelIds) {
    const modelResults = results.filter((r) => r.model_id === modelId);
    const total = modelResults.length;
    const correct = modelResults.filter((r) => r.is_correct === true).length;
    const acc = total > 0 ? Math.round((correct / total) * 1000) / 10 : 0;
    accRow.values[modelId] = total > 0 ? `${acc}%` : '—';
    if (acc > bestAcc) { bestAcc = acc; accRow.bestModelId = modelId; }
  }
  rows.push(accRow);

  // Average latency
  const latRow: MetricRow = { metric: 'Avg Latency (ms)', values: {}, bestModelId: null, higherIsBetter: false };
  let bestLat = Infinity;
  for (const modelId of modelIds) {
    const lats = results.filter((r) => r.model_id === modelId && r.latency_ms != null).map((r) => r.latency_ms!);
    const avg = lats.length > 0 ? Math.round(lats.reduce((a, b) => a + b, 0) / lats.length) : null;
    latRow.values[modelId] = avg != null ? avg : '—';
    if (avg != null && avg < bestLat) { bestLat = avg; latRow.bestModelId = modelId; }
  }
  rows.push(latRow);

  // Total tokens
  const tokRow: MetricRow = { metric: 'Total Tokens', values: {}, bestModelId: null, higherIsBetter: false };
  let bestTok = Infinity;
  for (const modelId of modelIds) {
    const total = results.filter((r) => r.model_id === modelId && r.tokens_used != null)
      .reduce((sum, r) => sum + r.tokens_used!, 0);
    tokRow.values[modelId] = total > 0 ? total : '—';
    if (total > 0 && total < bestTok) { bestTok = total; tokRow.bestModelId = modelId; }
  }
  rows.push(tokRow);

  // Per-category accuracy rows (only if category data present)
  const categories = [...new Set(results.map((r) => r.category).filter(Boolean))] as string[];
  for (const cat of categories.sort()) {
    const catRow: MetricRow = { metric: `${cat} acc %`, values: {}, bestModelId: null, higherIsBetter: true };
    let bestCatAcc = -1;
    for (const modelId of modelIds) {
      const catResults = results.filter((r) => r.model_id === modelId && r.category === cat);
      const total = catResults.length;
      const correct = catResults.filter((r) => r.is_correct === true).length;
      const acc = total > 0 ? Math.round((correct / total) * 1000) / 10 : 0;
      catRow.values[modelId] = total > 0 ? `${acc}%` : '—';
      if (acc > bestCatAcc) { bestCatAcc = acc; catRow.bestModelId = modelId; }
    }
    rows.push(catRow);
  }

  return rows;
}

export function ComparisonTable({ runId, models, onDrilldown }: ComparisonTableProps) {
  const results = useEvalStore((s) => s.results);
  const modelIds = models.map((m) => m.modelId);

  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>([
    ...FIXED_COLUMNS,
    ...modelIds,
  ]);

  const filteredResults = useMemo(
    () => Object.values(results).filter((r) => r.run_id === runId),
    [results, runId]
  );

  const metricRows = useMemo(
    () => computeMetrics(filteredResults, modelIds),
    [filteredResults, modelIds]
  );

  // Move best-performing model (by accuracy) to first non-fixed column
  useEffect(() => {
    const accRow = metricRows.find((r) => r.metric === 'Accuracy %');
    const bestModelId = accRow?.bestModelId;
    if (!bestModelId) return;
    setColumnOrder((prev) => {
      if (prev[FIXED_COLUMNS.length] === bestModelId) return prev; // already first
      const withoutBest = prev.filter((id) => id !== bestModelId);
      return [
        ...withoutBest.slice(0, FIXED_COLUMNS.length),
        bestModelId,
        ...withoutBest.slice(FIXED_COLUMNS.length),
      ];
    });
  }, [metricRows]);

  const columns = useMemo<ColumnDef<MetricRow>[]>(() => [
    {
      id: 'metric',
      accessorKey: 'metric',
      header: 'Metric',
      cell: ({ getValue }) => (
        <span className="font-medium text-muted-foreground">{getValue() as string}</span>
      ),
    },
    ...modelIds.map((modelId): ColumnDef<MetricRow> => ({
      id: modelId,
      header: () => (
        <button
          className="font-semibold hover:underline text-left w-full"
          onClick={() => onDrilldown(modelId)}
          title="Click for per-question detail"
        >
          {modelId}
        </button>
      ),
      cell: ({ row }) => {
        const isBest = row.original.bestModelId === modelId;
        const val = row.original.values[modelId];
        return (
          <span className={cn(isBest && 'font-bold text-green-600')}>
            {val ?? '—'}
          </span>
        );
      },
    })),
  ], [modelIds, onDrilldown]);

  const table = useReactTable({
    data: metricRows,
    columns,
    state: { columnOrder },
    onColumnOrderChange: setColumnOrder,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((header) => (
                <th key={header.id} className="text-left p-3 font-medium whitespace-nowrap">
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="border-t hover:bg-muted/20">
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="p-3">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
          {metricRows.length === 0 && (
            <tr>
              <td colSpan={modelIds.length + 1} className="p-8 text-center text-muted-foreground">
                Waiting for results...
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
