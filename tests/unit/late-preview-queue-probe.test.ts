import { describe, expect, it, vi } from "vitest";
import {
  anonymizeMissingPreviewCards,
  collectCompetingWorkStages,
  collectLatePreviewQueueStages,
  queryMissingAssetIds,
  type MissingAssetState,
  type RawMissingCard,
} from "../e2e/late-preview-queue-probe";

const jumpStarted = Date.parse("2026-11-17T04:00:00.000Z");

function queueLog(atMs: number, context: Record<string, unknown>): string {
  return JSON.stringify({
    timestamp: new Date(jumpStarted + atMs).toISOString(),
    scope: "worker.media-queue",
    context: { libraryId: "library-private", ...context },
  });
}

function stage(
  mediaStage: string,
  assetId: string,
  jobId: string,
  atMs: number,
  values: Record<string, unknown> = {},
): string {
  return queueLog(atMs, {
    mediaStage,
    assetId,
    jobId,
    kind: "generate_thumbnail",
    priority: 40,
    ...values,
  });
}

describe("late preview queue diagnostics", () => {
  it("correlates late generation and keeps a pre-jump active job without exposing IDs", () => {
    const logText = [
      stage("job-start", "asset-private-a", "job-private-a", -500),
      stage("job-lease-acquired", "asset-private-a", "job-private-a", -450, { elapsedMs: 50 }),
      stage("job-generated", "asset-private-a", "job-private-a", 800, { elapsedMs: 1_300 }),
      stage("job-finish", "asset-private-a", "job-private-a", 850, { elapsedMs: 1_350 }),
      stage("job-start", "asset-private-b", "job-private-b", 300),
      stage("job-lease-acquired", "asset-private-b", "job-private-b", 320, { elapsedMs: 20 }),
      stage("job-generated", "asset-private-b", "job-private-b", 1_400, { elapsedMs: 1_100 }),
      stage("job-finish", "asset-private-b", "job-private-b", 1_420, { elapsedMs: 1_120 }),
      stage("job-start", "asset-expired", "job-expired", -2_000),
      stage("job-finish", "asset-expired", "job-expired", -1_500, { elapsedMs: 500 }),
      "not-json",
    ].join("\n");

    const result = collectLatePreviewQueueStages({
      logText,
      assetIds: ["asset-private-a", "asset-private-b", "asset-no-log", "asset-expired"],
      startedEpochMs: jumpStarted,
      endedEpochMs: jumpStarted + 1_500,
    });

    expect(result.assets.map((asset) => ({ ordinal: asset.ordinal, found: asset.found }))).toEqual([
      { ordinal: 1, found: true },
      { ordinal: 2, found: true },
      { ordinal: 3, found: false },
      { ordinal: 4, found: false },
    ]);
    expect(result.assets[0]?.jobs[0]?.stages.map(({ stage: name, jumpMs, elapsedMs }) => ({
      stage: name,
      jumpMs,
      elapsedMs,
    }))).toEqual([
      { stage: "job-start", jumpMs: -500, elapsedMs: null },
      { stage: "job-lease-acquired", jumpMs: -450, elapsedMs: 50 },
      { stage: "job-generated", jumpMs: 800, elapsedMs: 1_300 },
      { stage: "job-finish", jumpMs: 850, elapsedMs: 1_350 },
    ]);
    expect(result.assets[1]?.jobs[0]).toMatchObject({
      kind: "generate_thumbnail",
      priority: 40,
      stages: [
        { stage: "job-start", jumpMs: 300 },
        { stage: "job-lease-acquired", jumpMs: 320, elapsedMs: 20 },
        { stage: "job-generated", jumpMs: 1_400, elapsedMs: 1_100 },
        { stage: "job-finish", jumpMs: 1_420, elapsedMs: 1_120 },
      ],
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("asset-private");
    expect(serialized).not.toContain("job-private");
  });

  it("does not query all assets for an empty ID list and deduplicates targeted reads", async () => {
    const query = vi.fn(async (ids: readonly string[]) => [...ids]);

    await expect(queryMissingAssetIds([], query)).resolves.toEqual({ queried: false, value: null });
    expect(query).not.toHaveBeenCalled();
    await expect(queryMissingAssetIds(["asset-a", "asset-a", "asset-b"], query)).resolves.toEqual({
      queried: true,
      value: ["asset-a", "asset-b"],
    });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("limits other active/window jobs to 64 anonymous asset ordinals and reports truncation", () => {
    const rows = [
      stage("job-start", "target-private", "job-target", 100),
      stage("job-finish", "target-private", "job-target", 200, { elapsedMs: 100 }),
      stage("job-start", "other-private-0", "job-other-0", -500),
      stage("job-start", "other-private-1", "job-other-1", -3_000),
      stage("job-finish", "other-private-1", "job-other-1", -2_500, { elapsedMs: 500 }),
    ];
    for (let index = 1; index < 65; index += 1) {
      rows.push(stage("job-start", `other-private-${index}`, `job-other-${index}`, index));
      rows.push(stage("job-generated", `other-private-${index}`, `job-other-${index}`, index + 10,
        { elapsedMs: 10 }));
      rows.push(stage("job-finish", `other-private-${index}`, `job-other-${index}`, index + 15,
        { elapsedMs: 15 }));
    }

    const result = collectCompetingWorkStages({
      logText: rows.join("\n"),
      libraryId: "library-private",
      targetAssetIds: ["target-private"],
      startedEpochMs: jumpStarted,
      endedEpochMs: jumpStarted + 1_000,
    });

    expect(result).toMatchObject({
      candidateAssetCount: 65,
      includedAssetCount: 64,
      truncatedAssetCount: 1,
    });
    expect(result.assets).toHaveLength(64);
    expect(result.assets[0]?.ordinal).toBe(1);
    expect(result.assets[0]?.jobs[0]?.stages[0]?.jumpMs).toBe(-500);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("other-private");
    expect(serialized).not.toContain("job-other");
    expect(serialized).not.toContain("target-private");
  });

  it("distinguishes an existing asset without an artifact from an unresolvable asset", () => {
    const cards: RawMissingCard[] = [
      { assetId: "asset-found", extension: "arw", mounted: false, complete: null, route: "other" },
      { assetId: "asset-absent", extension: "arw", mounted: true, complete: false, route: "preview" },
    ];
    const assets: MissingAssetState[] = [
      { assetId: "asset-found", thumbnailStatus: "queued", hasArtifact: false, previewKind: null },
    ];

    expect(anonymizeMissingPreviewCards(cards, "ok", assets)).toEqual([
      {
        ordinal: 1,
        extension: "arw",
        mounted: false,
        complete: null,
        route: "other",
        found: true,
        thumbnailStatus: "queued",
        hasArtifact: false,
        previewKind: null,
      },
      {
        ordinal: 2,
        extension: "arw",
        mounted: true,
        complete: false,
        route: "preview",
        found: false,
        thumbnailStatus: null,
        hasArtifact: null,
        previewKind: null,
      },
    ]);
  });
});
