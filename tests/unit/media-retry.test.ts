import { describe, expect, it, vi } from "vitest";

import {
  mediaJobKindForArtifact,
  waitForMediaArtifactRetry,
} from "../../src/renderer/media-retry";

describe("media retry", () => {
  it("maps artifact kinds to their durable media jobs", () => {
    expect(mediaJobKindForArtifact("thumbnail")).toBe("generate_thumbnail");
    expect(mediaJobKindForArtifact("webm_proxy")).toBe("generate_webm_proxy");
    expect(mediaJobKindForArtifact("audio_proxy")).toBe("generate_audio_proxy");
  });

  it("waits for the retried asset job to reach a terminal state", async () => {
    const listMediaJobs = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        value: {
          queued: 1,
          running: 0,
          succeeded: 0,
          failed: 0,
          paused: 0,
          cancelled: 0,
          jobs: [
            {
              jobId: "job-1",
              assetId: "asset-1",
              revisionId: null,
              kind: "generate_webm_proxy",
              status: "queued",
              progress: 0,
              attemptCount: 1,
              errorCode: null,
              errorDetail: null,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          queued: 0,
          running: 0,
          succeeded: 0,
          failed: 1,
          paused: 0,
          cancelled: 0,
          jobs: [
            {
              jobId: "job-1",
              assetId: "asset-1",
              revisionId: null,
              kind: "generate_webm_proxy",
              status: "failed",
              progress: 0,
              attemptCount: 1,
              errorCode: "FFMPEG_REQUIRED",
              errorDetail: "missing",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:01.000Z",
            },
          ],
        },
      });

    const result = await waitForMediaArtifactRetry({
      api: { listMediaJobs },
      libraryId: "library-1",
      assetId: "asset-1",
      artifactKind: "webm_proxy",
      timeoutMs: 100,
      pollIntervalMs: 1,
    });

    expect(result?.status).toBe("failed");
    expect(listMediaJobs).toHaveBeenCalledTimes(2);
  });
});
