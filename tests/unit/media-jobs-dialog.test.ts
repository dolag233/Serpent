import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MediaJobsDialog } from "../../src/renderer/MediaJobsDialog";
import { LocaleProvider } from "../../src/renderer/i18n";

describe("MediaJobsDialog asset labels", () => {
  it("shows the associated asset filename instead of only the job kind", () => {
    const dialog = createElement(MediaJobsDialog, {
      open: true,
      mediaJobsLoading: false,
      mediaJobs: {
        queued: 1,
        running: 0,
        succeeded: 0,
        failed: 0,
        paused: 0,
        cancelled: 0,
        jobs: [{
          jobId: "job-1",
          assetId: "asset-1",
          assetName: "poster.mp4",
          revisionId: "revision-1",
          kind: "generate_thumbnail",
          status: "queued",
          progress: 0,
          attemptCount: 0,
          errorCode: null,
          errorDetail: null,
          createdAt: "2026-08-22T00:00:00.000Z",
          updatedAt: "2026-08-22T00:00:00.000Z",
        }],
      },
      aiJobs: null,
      pluginJobs: null,
      onClose: () => undefined,
      onControlMediaJobs: () => undefined,
      onControlAiJobs: () => undefined,
    });
    const html = renderToStaticMarkup(
      createElement(
        LocaleProvider,
        { initialPreference: "zh-CN", children: dialog },
      ),
    );

    expect(html).toContain("poster.mp4");
    expect(html).toContain('data-hover-tip="poster.mp4"');
    expect(html).toContain("media-jobs-asset-name");
    expect(html).toContain("thumbnail");
  });
});
