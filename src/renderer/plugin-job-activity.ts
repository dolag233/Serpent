import type { PluginJobRecord } from "../plugins/plugin-jobs";
import type { PluginJobStatus } from "../shared/library-api";

const liveStatuses = new Set<PluginJobRecord["status"]>([
  "queued",
  "running",
]);

const attentionStatuses = new Set<PluginJobRecord["status"]>([
  "paused",
  "succeeded",
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

/**
 * Pick the single job surfaced by the unobtrusive workspace activity banner.
 * Terminal or paused jobs remain discoverable briefly after a state change so
 * the result is not replaced by nothing before the user can open the full task panel.
 */
export function selectPluginJobActivity(
  pluginJobs: PluginJobStatus | null,
  now = Date.now(),
): PluginJobRecord | null {
  if (pluginJobs === null) return null;
  const activityJob = pluginJobs.jobs.find((candidate) =>
    isActivityStatus(candidate.status),
  );
  if (activityJob !== undefined) return activityJob;

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
