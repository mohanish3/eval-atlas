// frontend/src/components/evals/RunProgress.tsx
import { useEvalStore } from '../../store/useEvalStore';
import { cn } from '../../lib/utils';

interface RunProgressProps {
  runId: string;
  models: Array<{ provider: string; modelId: string }>;
  totalQuestions: number;
}

export function RunProgress({ runId, models, totalQuestions }: RunProgressProps) {
  const results = useEvalStore((s) => s.results);

  return (
    <div className="space-y-3">
      {models.map((model) => {
        const modelResults = Object.values(results).filter(
          (r) => r.run_id === runId && r.model_id === model.modelId
        );
        const completed = modelResults.length;
        const correct = modelResults.filter((r) => r.is_correct === true).length;
        const pct = totalQuestions > 0 ? Math.round((completed / totalQuestions) * 100) : 0;
        const done = completed === totalQuestions && totalQuestions > 0;

        return (
          <div key={model.modelId} className="space-y-1.5">
            <div className="flex justify-between items-center text-xs">
              <div className="flex items-center gap-2">
                {!done && (
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-60" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                  </span>
                )}
                {done && (
                  <span className="relative flex h-2 w-2">
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                  </span>
                )}
                <span className="font-medium">{model.modelId}</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                {completed > 0 && (
                  <span className="text-emerald-600 font-medium">{correct}/{completed} correct</span>
                )}
                <span>{completed}/{totalQuestions}</span>
                <span className={cn(
                  'font-semibold tabular-nums min-w-[2.5rem] text-right',
                  done ? 'text-emerald-600' : 'text-primary'
                )}>
                  {pct}%
                </span>
              </div>
            </div>
            <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
              <div
                className={cn(
                  'h-1.5 rounded-full transition-all duration-500 ease-out',
                  done ? 'bg-emerald-500' : 'progress-gradient'
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
