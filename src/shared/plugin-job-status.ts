import type { PluginJobStatus } from './library-api';
import type { PluginJobRecord } from '../plugins/plugin-jobs';

/** Aggregate Worker plugin job rows into the dialog summary shape. */
export function summarizePluginJobs(jobs: readonly PluginJobRecord[]): PluginJobStatus {
  const summary: PluginJobStatus = {
    queued: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    paused: 0,
    cancelled: 0,
    jobs: [...jobs],
  };
  for (const job of jobs) {
    switch (job.status) {
      case 'queued':
        summary.queued += 1;
        break;
      case 'running':
        summary.running += 1;
        break;
      case 'succeeded':
        summary.succeeded += 1;
        break;
      case 'failed':
        summary.failed += 1;
        break;
      case 'paused':
        summary.paused += 1;
        break;
      case 'cancelled':
        summary.cancelled += 1;
        break;
      default: {
        const _exhaustive: never = job.status;
        void _exhaustive;
      }
    }
  }
  return summary;
}
