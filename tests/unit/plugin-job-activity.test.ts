import { describe, expect, it } from "vitest";

import type { PluginJobRecord } from "../../src/plugins/plugin-jobs";
import {
  hasActivePluginJobs,
  selectPluginJobActivity,
} from "../../src/renderer/plugin-job-activity";

function job(status: PluginJobRecord["status"]): PluginJobRecord {
  return {
    jobId: "11111111-1111-4111-8111-111111111111",
    libraryId: "library-1",
    kind: "plugin.background",
    status,
    progress: status === "succeeded" ? 1 : 0.5,
    attemptCount: 0,
    errorCode: null,
    errorDetail: null,
    ownerPluginId: "com.serpent.probe",
    ownerPackageHash: "a".repeat(64),
    pluginHandlerId: "process",
    payload: {},
    recoveryStrategy: "idempotent",
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
  };
}

describe("hasActivePluginJobs", () => {
  it("treats queued and running plugin jobs as toolbar activity", () => {
    expect(
      hasActivePluginJobs({
        queued: 1,
        running: 0,
        succeeded: 0,
        failed: 0,
        paused: 0,
        cancelled: 0,
        jobs: [job("queued")],
      }),
    ).toBe(true);
    expect(
      hasActivePluginJobs({
        queued: 0,
        running: 1,
        succeeded: 0,
        failed: 0,
        paused: 0,
        cancelled: 0,
        jobs: [job("running")],
      }),
    ).toBe(true);
  });

  it("does not keep toolbar activity lit for terminal-only results", () => {
    expect(
      hasActivePluginJobs({
        queued: 0,
        running: 0,
        succeeded: 1,
        failed: 0,
        paused: 0,
        cancelled: 0,
        jobs: [job("succeeded")],
      }),
    ).toBe(false);
    expect(hasActivePluginJobs(null)).toBe(false);
  });

  it("keeps a recent terminal result discoverable briefly", () => {
    const recentJob = {
      ...job("failed"),
      updatedAt: "2026-08-02T00:00:00.000Z",
    };
    expect(
      selectPluginJobActivity(
        {
          queued: 0,
          running: 0,
          succeeded: 0,
          failed: 1,
          paused: 0,
          cancelled: 0,
          jobs: [recentJob],
        },
        Date.parse("2026-08-02T00:00:10.000Z"),
      ),
    ).toBe(recentJob);
    expect(
      selectPluginJobActivity(
        {
          queued: 0,
          running: 0,
          succeeded: 0,
          failed: 1,
          paused: 0,
          cancelled: 0,
          jobs: [recentJob],
        },
        Date.parse("2026-08-02T00:01:00.000Z"),
      ),
    ).toBeNull();
  });
});
