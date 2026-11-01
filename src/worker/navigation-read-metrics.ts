import { performance } from 'node:perf_hooks';

/** Timings contain no library paths, names or query contents. */
export class NavigationReadMetrics {
  private readonly started = performance.now();
  private readonly stages: Record<string, number> = {};

  measure<T>(stage: string, operation: () => T): T {
    const started = performance.now();
    try {
      return operation();
    } finally {
      this.stages[stage] = Math.round((performance.now() - started) * 100) / 100;
    }
  }

  result(): { durationMs: number; stagesMs: Record<string, number> } {
    return { durationMs: Math.round((performance.now() - this.started) * 100) / 100, stagesMs: this.stages };
  }

  async measureAsync<T>(stage: string, operation: () => Promise<T>): Promise<T> {
    const started = performance.now();
    try {
      return await operation();
    } finally {
      this.stages[stage] = Math.round((performance.now() - started) * 100) / 100;
    }
  }
}
