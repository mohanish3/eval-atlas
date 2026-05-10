// backend/src/evals/sseManager.ts
// In-memory registry of active SSE Response objects keyed by run_id.
// The eval runner calls broadcast() as each question result arrives.
// On run completion, cleanup() closes all connections for that run.

import type { Response } from 'express';

const clients = new Map<string, Set<Response>>();

export function addClient(runId: string, res: Response): void {
  if (!clients.has(runId)) clients.set(runId, new Set());
  clients.get(runId)!.add(res);
}

export function removeClient(runId: string, res: Response): void {
  const set = clients.get(runId);
  if (set) {
    set.delete(res);
    if (set.size === 0) clients.delete(runId);
  }
}

export function broadcast(runId: string, eventType: string, data: unknown): void {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.get(runId)?.forEach((res) => {
    try {
      res.write(payload);
    } catch {
      // Socket may have closed; remove silently
    }
  });
}

/**
 * Called after run_complete is broadcast. Ends all SSE connections for a run
 * and removes the run's entry from the map to prevent memory leaks.
 */
export function cleanup(runId: string): void {
  clients.get(runId)?.forEach((res) => {
    try {
      res.end();
    } catch {
      // Already closed
    }
  });
  clients.delete(runId);
}
