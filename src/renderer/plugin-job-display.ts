import type { PluginJobRecord } from "../plugins/plugin-jobs";
import { projectPluginJobProgress } from "../plugins/plugin-jobs";

type PluginJobDisplayRecord = Pick<
  PluginJobRecord,
  "completed" | "total" | "progress" | "phase" | "message"
> & Pick<PluginJobRecord, "status">;

function clampProgress(progress: number): number {
  return Math.max(0, Math.min(1, progress));
}

const MAX_PLUGIN_JOB_ERROR_DISPLAY_LENGTH = 240;
// Path details may contain spaces. Stop at common sentence/diagnostic
// delimiters rather than treating whitespace as the end of a path.
const UNIX_PATH_PATTERN = /(?:file:\/\/)?\/(?:Users|private|tmp|var|home|Volumes|Applications|System|Library|etc|opt|dev)\/[^,;|()[\]{}\n]*/giu;
const WINDOWS_PATH_PATTERN = /[A-Za-z]:\\[^,;|()[\]{}\n]*/gu;

export function formatPluginJobPluginName(pluginId: string): string {
  const localName = pluginId.split(".").at(-1) ?? pluginId;
  return localName
    .split(/[-_]+/u)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

/**
 * Keep plugin-provided failure text useful without putting host paths or
 * unbounded protocol payloads into the Renderer UI. The original detail is
 * still available in the application log for diagnostics.
 */
export function formatPluginJobError(
  errorDetail: string | null | undefined,
  errorCode: string | null | undefined,
): string {
  const source = errorDetail?.trim() || errorCode?.trim() || "";
  if (!source) return "";
  const redacted = source
    .replace(UNIX_PATH_PATTERN, "<path>")
    .replace(WINDOWS_PATH_PATTERN, "<path>")
    .replace(/\s+/gu, " ")
    .trim();
  if (redacted.length <= MAX_PLUGIN_JOB_ERROR_DISPLAY_LENGTH) return redacted;
  return `${redacted.slice(0, MAX_PLUGIN_JOB_ERROR_DISPLAY_LENGTH - 3)}...`;
}

/**
 * Return the progress projection used by every plugin-job UI surface.
 * Counters are authoritative whenever the total is known and non-zero;
 * `progress` is only a fallback for zero-total or legacy/unknown-total jobs.
 */
export function getPluginJobDisplayProgress(
  job: Pick<PluginJobRecord, "completed" | "total" | "progress">,
): number {
  if (job.total !== undefined) {
    return clampProgress(
      projectPluginJobProgress({
        completed: job.completed ?? 0,
        total: job.total,
        progress: job.progress,
      }),
    );
  }
  return clampProgress(job.progress);
}

export function formatPluginJobProgressSummary(
  job: PluginJobDisplayRecord,
): string {
  const percentage = `${Math.round(getPluginJobDisplayProgress(job) * 100)}%`;
  const count =
    job.completed !== undefined && job.total !== undefined
      ? `${job.completed}/${job.total}`
      : undefined;
  return [count, percentage].filter(Boolean).join(" · ");
}

export function formatPluginJobProgressMessage(
  job: PluginJobDisplayRecord,
): string {
  if (job.status === "queued" || job.status === "interrupted") return "";
  return formatPluginJobError([job.phase, job.message]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join(" · "), undefined);
}
