import type { PluginJobRecord } from "../plugins/plugin-jobs";
import type { PluginJobStatus } from "../shared/library-api";

const liveStatuses = new Set<PluginJobRecord["status"]>([
  "queued",
  "running",
]);

const attentionStatuses = new Set<PluginJobRecord["status"]>([
  "paused",
  "failed",
  "cancelled",
  "interrupted",
]);

const TERMINAL_ACTIVITY_RETENTION_MS = 30_000;

function isActivityStatus(status: PluginJobRecord["status"]): boolean {
  return liveStatuses.has(status);
}

function isAttentionStatus(status: PluginJobRecord["status"]): boolean {
  return attentionStatuses.has(status);
}

export function hasActivePluginJobs(
  pluginJobs: PluginJobStatus | null,
): boolean {
  return (
    pluginJobs !== null &&
    pluginJobs.jobs.some(
      (candidate) =>
        candidate.status === "queued" || candidate.status === "running",
    )
  );
}

function createdAtMs(job: PluginJobRecord): number {
  const parsed = Date.parse(job.createdAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function earliestJob(
  jobs: readonly PluginJobRecord[],
  status: PluginJobRecord["status"],
): PluginJobRecord | undefined {
  return jobs
    .filter((candidate) => candidate.status === status)
    .sort((left, right) => createdAtMs(left) - createdAtMs(right))[0];
}

/**
 * Pick the single job surfaced by the unobtrusive workspace activity banner.
 * A running job always wins over a later queued job so enqueueing another
 * task cannot hide the work that is actually in progress.
 * Terminal or paused jobs remain discoverable briefly after a state change so
 * the result is not replaced by nothing before the user can open the full task panel.
 */
export function selectPluginJobActivity(
  pluginJobs: PluginJobStatus | null,
  now = Date.now(),
): PluginJobRecord | null {
  if (pluginJobs === null) return null;
  const runningJob = earliestJob(pluginJobs.jobs, "running");
  if (runningJob !== undefined) return runningJob;
  const queuedJob = earliestJob(pluginJobs.jobs, "queued");
  if (queuedJob !== undefined) return queuedJob;

  const attentionJob = pluginJobs.jobs
    .filter((candidate) => isAttentionStatus(candidate.status))
    .sort(
      (left, right) =>
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
    )[0];
  if (attentionJob === undefined) return null;
  const updatedAt = Date.parse(attentionJob.updatedAt);
  if (!Number.isFinite(updatedAt) || now - updatedAt > TERMINAL_ACTIVITY_RETENTION_MS) {
    return null;
  }
  return attentionJob;
}

/** Live jobs other than the one currently shown on the activity banner. */
export function countOtherLivePluginJobs(
  pluginJobs: PluginJobStatus | null,
  selectedJobId: string | undefined,
): number {
  if (pluginJobs === null || selectedJobId === undefined) return 0;
  return pluginJobs.jobs.filter(
    (candidate) =>
      isActivityStatus(candidate.status) && candidate.jobId !== selectedJobId,
  ).length;
}
