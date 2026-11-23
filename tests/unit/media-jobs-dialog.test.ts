import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MediaJobsDialog } from "../../src/renderer/MediaJobsDialog";
import { LocaleProvider } from "../../src/renderer/i18n";

describe("MediaJobsDialog", () => {
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

  it("shows a load-more control only when another page exists", () => {
    const dialog = createElement(MediaJobsDialog, {
      open: true,
      mediaJobsLoading: false,
      mediaJobs: {
        queued: 2,
        running: 0,
        succeeded: 0,
        failed: 0,
        paused: 0,
        cancelled: 0,
        hasMore: true,
        nextCursor: { createdAt: "2026-09-16T12:00:00.000Z", jobId: "job-1" },
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
          createdAt: "2026-09-16T12:00:00.000Z",
          updatedAt: "2026-09-16T12:00:00.000Z",
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

    expect(html).toContain("加载更多");
  });

  it("shows semantic index progress while indexing and hides it when ready", () => {
    const indexing = createElement(MediaJobsDialog, {
      open: true,
      mediaJobsLoading: false,
      mediaJobs: {
        queued: 0,
        running: 0,
        succeeded: 0,
        failed: 0,
        paused: 0,
        cancelled: 0,
        jobs: [],
      },
      aiJobs: null,
      pluginJobs: null,
      embeddingIndex: {
        modelId: "svc_textonly1",
        snapshot: { phase: "indexing", done: 1, total: 3, failedCount: 0 },
      },
      onClose: () => undefined,
      onControlMediaJobs: () => undefined,
      onControlAiJobs: () => undefined,
    });
    const indexingHtml = renderToStaticMarkup(
      createElement(LocaleProvider, { initialPreference: "en", children: indexing }),
    );
    expect(indexingHtml).toContain("media-jobs-embedding-section");
    expect(indexingHtml).toContain("task-progress-fill");
    expect(indexingHtml).toContain("Already indexed text can be searched now");

    const ready = createElement(MediaJobsDialog, {
      open: true,
      mediaJobsLoading: false,
      mediaJobs: {
        queued: 0,
        running: 0,
        succeeded: 0,
        failed: 0,
        paused: 0,
        cancelled: 0,
        jobs: [],
      },
      aiJobs: null,
      pluginJobs: null,
      embeddingIndex: {
        modelId: "svc_textonly1",
        snapshot: { phase: "ready", done: 3, total: 3, failedCount: 0 },
      },
      onClose: () => undefined,
      onControlMediaJobs: () => undefined,
      onControlAiJobs: () => undefined,
    });
    const readyHtml = renderToStaticMarkup(
      createElement(LocaleProvider, { initialPreference: "en", children: ready }),
    );
    expect(readyHtml).not.toContain("media-jobs-embedding-section");
  });

  it("enables queue pause on an empty queue and resumes a globally paused queue", () => {
    const render = (queuePaused?: boolean) => {
      const dialog = createElement(MediaJobsDialog, {
        open: true,
        mediaJobsLoading: false,
        mediaJobs: {
          queued: 0,
          running: 0,
          succeeded: 0,
          failed: 0,
          paused: 0,
          cancelled: 0,
          ...(queuePaused === undefined ? {} : { queuePaused }),
          jobs: [],
        },
        aiJobs: null,
        pluginJobs: null,
        onClose: () => undefined,
        onControlMediaJobs: () => undefined,
        onControlAiJobs: () => undefined,
      });
      return renderToStaticMarkup(
        createElement(LocaleProvider, { initialPreference: "en", children: dialog }),
      );
    };
    const button = (html: string, label: string) => {
      const match = html.match(new RegExp(`<button\\b[^>]*>\\s*${label}\\s*</button>`))?.[0];
      expect(match).toBeDefined();
      return match ?? "";
    };

    const runningQueue = render();
    expect(button(runningQueue, "Pause all")).not.toContain("disabled");
    expect(button(runningQueue, "Resume paused")).toContain("disabled");
    expect(button(runningQueue, "Cancel incomplete")).toContain("disabled");

    const pausedQueue = render(true);
    expect(button(pausedQueue, "Pause all")).toContain("disabled");
    expect(button(pausedQueue, "Resume paused")).not.toContain("disabled");
  });
});
