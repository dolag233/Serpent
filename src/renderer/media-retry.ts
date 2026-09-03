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
  pollIntervalMs = 200,
  signal,
}: {
  api: Pick<SerpentLibraryApi, "listMediaJobs">;
  libraryId: string;
  assetId: string;
  artifactKind: "thumbnail" | "webm_proxy" | "audio_proxy";
  pollIntervalMs?: number;
  signal?: AbortSignal;
}): Promise<MediaJob | null> {
  const jobKind = mediaJobKindForArtifact(artifactKind);
  let latestJobId: string | null = null;

  for (;;) {
    if (signal?.aborted) {
      throw new DOMException("Media artifact retry was cancelled.", "AbortError");
    }
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

    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(new DOMException("Media artifact retry was cancelled.", "AbortError"));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, Math.max(0, pollIntervalMs));
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
  }
}
