// frontend/src/hooks/useEvalStream.ts
import { useEffect, useRef } from 'react';
import { useEvalStore } from '../store/useEvalStore';
import type { EvalResult } from '../store/useEvalStore';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

/**
 * Opens an SSE connection to /api/evals/runs/:runId/stream.
 * Feeds incoming question_result events into Zustand store.
 * Closes the connection on run_complete or component unmount.
 *
 * Only connects when runId is non-null (pass null when no active live run).
 */
export function useEvalStream(runId: string | null): void {
  const esRef = useRef<EventSource | null>(null);
  const { addResult, updateActiveRunStatus } = useEvalStore();

  useEffect(() => {
    if (!runId) return;

    // Close any existing connection before opening a new one
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    const token = localStorage.getItem('auth_token');
    const streamUrl = new URL(`${API_URL}/api/evals/runs/${runId}/stream`);
    if (token) {
      streamUrl.searchParams.set('token', token);
    }

    const es = new EventSource(streamUrl.toString());
    esRef.current = es;

    es.addEventListener('question_result', (e: MessageEvent) => {
      const result: EvalResult = JSON.parse(e.data);
      addResult(result);
    });

    es.addEventListener('run_complete', (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      updateActiveRunStatus(data.status ?? 'completed');
      es.close();
      esRef.current = null;
    });

    es.onerror = () => {
      console.warn('[useEvalStream] SSE error — browser will retry automatically');
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [runId]);
}
