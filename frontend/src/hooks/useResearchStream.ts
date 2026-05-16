import { useEffect, useRef, useState } from 'react';
import type { TrialStatus } from '../services/api';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export interface LiveTrial {
  trialId: string;
  iteration: number;
  status: TrialStatus | 'running';
  overallAccuracy: number | null;
  latencyMsAvg: number | null;
  tokensUsedTotal: number | null;
  mutationSummary: string | null;
  candidatePrompt?: string;
}

export interface ResearchStreamState {
  liveTrials: LiveTrial[];
  completed: boolean;
  baselineAccuracy: number | null;
  bestAccuracy: number | null;
  delta: number | null;
  holdoutAccuracy: number | null;
  stoppedReason: string | null;
}

export function useResearchStream(researchRunId: string | null, isLive: boolean): ResearchStreamState {
  const esRef = useRef<EventSource | null>(null);
  const [state, setState] = useState<ResearchStreamState>({
    liveTrials: [],
    completed: false,
    baselineAccuracy: null,
    bestAccuracy: null,
    delta: null,
    holdoutAccuracy: null,
    stoppedReason: null,
  });

  useEffect(() => {
    if (!researchRunId || !isLive) return;

    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    const token = localStorage.getItem('auth_token');
    const url = new URL(`${API_URL}/api/evals/prompt-research/${researchRunId}/stream`);
    if (token) url.searchParams.set('token', token);

    const es = new EventSource(url.toString());
    esRef.current = es;

    es.addEventListener('trial_started', (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      setState((prev) => ({
        ...prev,
        liveTrials: [
          ...prev.liveTrials.filter((t) => t.trialId !== data.trialId),
          {
            trialId: data.trialId,
            iteration: data.iteration,
            status: 'running' as const,
            overallAccuracy: null,
            latencyMsAvg: null,
            tokensUsedTotal: null,
            mutationSummary: null,
            candidatePrompt: data.candidatePrompt,
          },
        ],
      }));
    });

    es.addEventListener('trial_completed', (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      setState((prev) => ({
        ...prev,
        liveTrials: prev.liveTrials.map((t) =>
          t.trialId === data.trialId
            ? {
                ...t,
                status: data.status as TrialStatus,
                overallAccuracy: data.overallAccuracy,
                latencyMsAvg: data.latencyMsAvg,
                tokensUsedTotal: data.tokensUsedTotal,
                mutationSummary: data.mutationSummary,
              }
            : t
        ),
      }));
    });

    es.addEventListener('research_completed', (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      setState((prev) => ({
        ...prev,
        completed: true,
        baselineAccuracy: data.baselineAccuracy,
        bestAccuracy: data.bestAccuracy,
        delta: data.delta,
        holdoutAccuracy: data.holdoutAccuracy,
        stoppedReason: data.stoppedReason,
      }));
      es.close();
      esRef.current = null;
    });

    es.addEventListener('error', (e: MessageEvent) => {
      console.warn('[useResearchStream] SSE error event:', e);
    });

    es.onerror = () => {
      console.warn('[useResearchStream] SSE connection error — browser will retry');
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [researchRunId, isLive]);

  return state;
}
