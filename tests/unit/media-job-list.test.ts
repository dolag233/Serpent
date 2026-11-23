import { describe, expect, it } from "vitest";

import {
  clampMediaJobListLimit,
  MEDIA_JOB_LIST_DEFAULT_LIMIT,
  MEDIA_JOB_LIST_PAGE_MAX,
  MEDIA_JOB_LIST_PAGE_SIZE,
  sliceMediaJobListPage,
} from "../../src/shared/media-jobs";
import {
  appendMediaJobListPage,
  applyMediaJobSummary,
  replaceMediaJobListPage,
} from "../../src/renderer/media-job-status-state";
import type { MediaJobStatus } from "../../src/shared/library-api";

function job(id: string, createdAt: string): MediaJobStatus["jobs"][number] {
  return {
    jobId: id,
    assetId: `asset-${id}`,
    assetName: `${id}.png`,
    revisionId: "revision-1",
    kind: "generate_thumbnail",
    status: "queued",
    progress: 0,
    attemptCount: 0,
    errorCode: null,
    errorDetail: null,
    createdAt,
    updatedAt: createdAt,
  };
}

describe("media job list pagination helpers", () => {
  it("clamps omitted and oversized limits", () => {
    expect(clampMediaJobListLimit(undefined)).toBe(MEDIA_JOB_LIST_DEFAULT_LIMIT);
    expect(clampMediaJobListLimit(MEDIA_JOB_LIST_PAGE_MAX + 50)).toBe(MEDIA_JOB_LIST_PAGE_MAX);
    expect(clampMediaJobListLimit(0)).toBe(1);
    expect(clampMediaJobListLimit(MEDIA_JOB_LIST_PAGE_SIZE)).toBe(MEDIA_JOB_LIST_PAGE_SIZE);
  });

  it("returns a keyset cursor only when another page exists", () => {
    const rows = [
      { createdAt: "2026-09-16T12:00:02.000Z", jobId: "job-3" },
      { createdAt: "2026-09-16T12:00:01.000Z", jobId: "job-2" },
      { createdAt: "2026-09-16T12:00:01.000Z", jobId: "job-1" },
    ];

    const first = sliceMediaJobListPage(rows, 2);
    expect(first.page).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).toEqual({
      createdAt: "2026-09-16T12:00:01.000Z",
      jobId: "job-2",
    });

    const last = sliceMediaJobListPage(rows.slice(2), 2);
    expect(last.hasMore).toBe(false);
    expect(last.nextCursor).toBeNull();
  });
});

describe("media job panel state", () => {
  it("keeps loaded rows when a summary snapshot arrives", () => {
    const listed: MediaJobStatus = {
      queued: 2,
      running: 1,
      succeeded: 0,
      failed: 0,
      paused: 0,
      cancelled: 0,
      queuePaused: true,
      jobs: [job("job-1", "2026-09-16T12:00:00.000Z")],
      nextCursor: { createdAt: "2026-09-16T12:00:00.000Z", jobId: "job-1" },
      hasMore: true,
    };

    const merged = applyMediaJobSummary(listed, {
      queued: 1,
      running: 0,
      succeeded: 2,
      failed: 0,
      paused: 0,
      cancelled: 0,
    });

    expect(merged.queued).toBe(1);
    expect(merged.succeeded).toBe(2);
    expect(merged.jobs).toEqual(listed.jobs);
    expect(merged.nextCursor).toEqual(listed.nextCursor);
    expect(merged.hasMore).toBe(true);
    expect(merged.queuePaused).toBe(true);

    const resumed = applyMediaJobSummary(merged, {
      queued: 1,
      running: 0,
      succeeded: 2,
      failed: 0,
      paused: 0,
      cancelled: 0,
      queuePaused: false,
    });
    expect(resumed.queuePaused).toBe(false);
  });

  it("appends the next page without duplicating job ids", () => {
    const first = replaceMediaJobListPage({
      queued: 3,
      running: 0,
      succeeded: 0,
      failed: 0,
      paused: 0,
      cancelled: 0,
      queuePaused: true,
      jobs: [job("job-1", "2026-09-16T12:00:02.000Z")],
      nextCursor: { createdAt: "2026-09-16T12:00:02.000Z", jobId: "job-1" },
      hasMore: true,
    });
    const merged = appendMediaJobListPage(first, {
      queued: 2,
      running: 0,
      succeeded: 1,
      failed: 0,
      paused: 0,
      cancelled: 0,
      jobs: [
        job("job-1", "2026-09-16T12:00:02.000Z"),
        job("job-2", "2026-09-16T12:00:01.000Z"),
      ],
      nextCursor: null,
      hasMore: false,
    });

    expect(merged.jobs.map((row) => row.jobId)).toEqual(["job-1", "job-2"]);
    expect(merged.queued).toBe(2);
    expect(merged.hasMore).toBe(false);
    expect(merged.nextCursor).toBeNull();
    expect(merged.queuePaused).toBe(true);
  });

  it("defaults a first page to unpaused and preserves the previous mode when an old page omits it", () => {
    const firstPage: MediaJobStatus = {
      queued: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      paused: 0,
      cancelled: 0,
      jobs: [],
    };
    expect(replaceMediaJobListPage(firstPage).queuePaused).toBe(false);

    const previous: MediaJobStatus = { ...firstPage, queuePaused: true };
    expect(replaceMediaJobListPage(firstPage, previous).queuePaused).toBe(true);
    expect(appendMediaJobListPage(previous, firstPage).queuePaused).toBe(true);
  });
});
