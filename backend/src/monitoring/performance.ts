import { logDebug, logWarn } from '../middleware/logger.js';

export interface PerformanceEntry {
  name: string;
  durationMs: number;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

export class PerformanceMonitor {
  private static entries: PerformanceEntry[] = [];
  private static maxEntries = 500;

  static startSpan(
    name: string,
    metadata?: Record<string, unknown>
  ): (extraMetadata?: Record<string, unknown>) => PerformanceEntry {
    const start = process.hrtime.bigint();
    return (extraMetadata?: Record<string, unknown>) => {
      const end = process.hrtime.bigint();
      const durationMs = Number(end - start) / 1_000_000;
      const entry: PerformanceEntry = {
        name,
        durationMs: Math.round(durationMs * 100) / 100,
        metadata: { ...metadata, ...extraMetadata },
        timestamp: new Date().toISOString(),
      };

      this.entries.push(entry);
      if (this.entries.length > this.maxEntries) {
        this.entries.shift();
      }

      logDebug(`perf:${name}`, { durationMs: entry.durationMs, ...metadata });
      return entry;
    };
  }

  static record(name: string, durationMs: number, metadata?: Record<string, unknown>): PerformanceEntry {
    const entry: PerformanceEntry = {
      name,
      durationMs: Math.round(durationMs * 100) / 100,
      metadata,
      timestamp: new Date().toISOString(),
    };
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
    logDebug(`perf:${name}`, { durationMs: entry.durationMs, ...metadata });
    return entry;
  }

  static recent(name?: string): PerformanceEntry[] {
    if (!name) return [...this.entries];
    return this.entries.filter((e) => e.name === name);
  }

  static summarize(name: string): { p50: number; p90: number; p99: number } | null {
    const samples = this.entries.filter((e) => e.name === name).map((e) => e.durationMs);
    if (samples.length === 0) {
      logWarn(`perf:${name} has no samples to summarize`);
      return null;
    }

    const sorted = samples.sort((a, b) => a - b);
    const pick = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
    return {
      p50: pick(50),
      p90: pick(90),
      p99: pick(99),
    };
  }
}
