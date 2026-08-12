import type { SerpentLibraryApi } from "../shared/library-api";
import type { MediaJob } from "../shared/protocol/responses";

const TERMINAL_MEDIA_JOB_STATUSES = new Set<MediaJob["status"]>([
  "succeeded",
  "failed",
  "cancelled",
]);

export function mediaJobKindForArtifact(
  artifactKind: "thumbnail" | "webm_proxy" | "audio_proxy",
): MediaJob["kind"] {
  switch (artifactKind) {
    case "thumbnail":
      return "generate_thumbnail";
    case "webm_proxy":
      return "generate_webm_proxy";
    case "audio_proxy":
      return "generate_audio_proxy";
  }
}

export async function waitForMediaArtifactRetry({
  api,
  libraryId,
  assetId,
  artifactKind,
  timeoutMs = 30_000,
  pollIntervalMs = 200,
}: {
  api: Pick<SerpentLibraryApi, "listMediaJobs">;
  libraryId: string;
  assetId: string;
  artifactKind: "thumbnail" | "webm_proxy" | "audio_proxy";
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<MediaJob | null> {
  const jobKind = mediaJobKindForArtifact(artifactKind);
  const deadline = Date.now() + timeoutMs;
  let latestJobId: string | null = null;

  while (Date.now() <= deadline) {
    const result = await api.listMediaJobs({ libraryId });
    if (!result.ok) return null;

    const matchingJobs = result.value.jobs
      .filter((job) => job.assetId === assetId && job.kind === jobKind)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const job =
      matchingJobs.find((candidate) => candidate.jobId === latestJobId) ??
      matchingJobs[0];
    if (job) {
      latestJobId ??= job.jobId;
      if (TERMINAL_MEDIA_JOB_STATUSES.has(job.status)) return job;
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, Math.min(pollIntervalMs, remainingMs));
    });
  }

  return null;
}
