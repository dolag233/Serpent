import type { PluginJobRecord } from "../plugins/plugin-jobs";

type PluginJobDisplayRecord = Pick<
  PluginJobRecord,
  "completed" | "total" | "progress" | "phase" | "message"
>;

export function formatPluginJobProgressSummary(
  job: PluginJobDisplayRecord,
): string {
  const percentage = `${Math.round(
    Math.max(0, Math.min(1, job.progress)) * 100,
  )}%`;
  const count =
    job.completed !== undefined && job.total !== undefined
      ? `${job.completed}/${job.total}`
      : undefined;
  return [count, percentage].filter(Boolean).join(" · ");
}

export function formatPluginJobProgressMessage(
  job: PluginJobDisplayRecord,
): string {
  return [job.phase, job.message]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join(" · ");
}
