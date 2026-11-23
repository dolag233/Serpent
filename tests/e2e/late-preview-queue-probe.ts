import type { Page } from "@playwright/test";
import type { SerpentLibraryApi } from "../../src/shared/library-api";

export type RawMissingCard = {
  assetId: string | null;
  extension: string;
  mounted: boolean;
  complete: boolean | null;
  route: "source" | "preview" | "other";
  firstObservedVisibleMs?: number | null;
  firstReportedImmediateMs?: number | null;
  firstReportedPrefetchMs?: number | null;
};

export type MissingAssetState = {
  assetId: string;
  thumbnailStatus: string | null;
  hasArtifact: boolean;
  previewKind: string | null;
};

export type MissingPreviewCard = Omit<RawMissingCard, "assetId"> & {
  ordinal: number | null;
  found: boolean | null;
  thumbnailStatus: string | null;
  hasArtifact: boolean | null;
  previewKind: string | null;
};

export type MissingPreviewSample = {
  /** Runtime-only join keys. Never include this field in diagnostic output. */
  assetIds: string[];
  queryStatus: "ok" | "failed" | "skipped-empty";
  cards: MissingPreviewCard[];
  queueSnapshot: MissingPreviewQueueSnapshot;
};

export type MissingPreviewQueueSnapshot = {
  queryStatus: "ok" | "partial" | "failed" | "skipped-empty";
  queryOk: { assets: boolean | null; jobs: boolean | null };
  hasMore: boolean | null;
  targets: Array<{
    ordinal: number;
    matchStatus: "matched" | "unmatched" | "unresolved-truncated" | "query-failed";
    jobs: Array<{
      kind: string;
      status: string;
      attemptCount: number;
      createdJumpMs: number | null;
      updatedJumpMs: number | null;
    }>;
  }>;
  unmatchedOrdinals: number[];
  truncatedOrdinals: number[];
};

const MEDIA_QUEUE_STAGES = new Set([
  "job-start",
  "job-lease-acquired",
  "job-generated",
  "job-finish",
]);

const MEDIA_JOB_KINDS = new Set([
  "generate_thumbnail",
  "generate_video_poster",
  "extract_metadata",
  "generate_contact_sheet",
  "generate_webm_proxy",
  "generate_audio_proxy",
  "extract_palette",
]);

type ParsedQueueStage = {
  atMs: number;
  libraryId: string | null;
  assetId: string;
  jobId: string;
  stage: string;
  kind: string | null;
  priority: number | null;
  elapsedMs: number | null;
};

export type AnonymousQueueStage = {
  stage: string;
  kind: string | null;
  priority: number | null;
  jumpMs: number;
  elapsedMs: number | null;
};

export type AnonymousQueueAttempt = {
  jobOrdinal: number;
  kind: string | null;
  priority: number | null;
  stages: AnonymousQueueStage[];
};

export type AnonymousQueueAsset = {
  ordinal: number;
  found: boolean;
  jobs: AnonymousQueueAttempt[];
};

export type LatePreviewQueueProbe = {
  assets: AnonymousQueueAsset[];
};

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sanitizedKind(value: unknown): string | null {
  return typeof value === "string" && MEDIA_JOB_KINDS.has(value) ? value : null;
}

function parseQueueStages(logText: string): ParsedQueueStage[] {
  const parsed: ParsedQueueStage[] = [];
  for (const line of logText.split(/\r?\n/)) {
    try {
      const record = JSON.parse(line) as {
        timestamp?: unknown;
        scope?: unknown;
        context?: Record<string, unknown>;
      };
      if (record.scope !== "worker.media-queue") continue;
      const context = record.context;
      if (!context || typeof context !== "object") continue;
      const stage = context.mediaStage;
      if (typeof stage !== "string" || !MEDIA_QUEUE_STAGES.has(stage)) continue;
      const assetId = context.assetId;
      const jobId = context.jobId;
      if (typeof assetId !== "string" || assetId.length === 0
        || typeof jobId !== "string" || jobId.length === 0) continue;
      const atMs = typeof record.timestamp === "string" ? Date.parse(record.timestamp) : Number.NaN;
      if (!Number.isFinite(atMs)) continue;
      const priority = finiteNumber(context.priority);
      const elapsed = finiteNumber(context.elapsedMs);
      parsed.push({
        atMs,
        libraryId: typeof context.libraryId === "string" ? context.libraryId : null,
        assetId,
        jobId,
        stage,
        kind: sanitizedKind(context.kind),
        priority: priority !== null && Number.isInteger(priority) ? priority : null,
        elapsedMs: elapsed !== null && elapsed >= 0 ? elapsed : null,
      });
    } catch {
      // Session logs are append-only JSONL and may end with a partial line.
    }
  }
  return parsed;
}

function roundMs(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Correlate only the explicitly supplied missing asset IDs and return no raw
 * IDs, job IDs, timestamps, file names, or paths. A negative jumpMs identifies
 * a stage that was already present when the measured jump began.
 */
export function collectLatePreviewQueueStages(input: {
  logText: string;
  libraryId?: string;
  assetIds: readonly string[];
  startedEpochMs: number;
  endedEpochMs: number;
}): LatePreviewQueueProbe {
  const assetIds = [...new Set(input.assetIds.filter((id) => id.length > 0))];
  if (assetIds.length === 0) return { assets: [] };

  const stagesByAsset = new Map<string, ParsedQueueStage[]>();
  const targets = new Set(assetIds);
  for (const stage of parseQueueStages(input.logText)) {
    if (input.libraryId !== undefined && stage.libraryId !== input.libraryId) continue;
    if (!targets.has(stage.assetId)) continue;
    const stages = stagesByAsset.get(stage.assetId) ?? [];
    stages.push(stage);
    stagesByAsset.set(stage.assetId, stages);
  }

  const assets: AnonymousQueueAsset[] = assetIds.map((assetId, assetIndex) => {
    const byJob = new Map<string, ParsedQueueStage[]>();
    for (const stage of stagesByAsset.get(assetId) ?? []) {
      const jobStages = byJob.get(stage.jobId) ?? [];
      jobStages.push(stage);
      byJob.set(stage.jobId, jobStages);
    }

    const selectedAttempts: Array<{ startedAt: number; records: ParsedQueueStage[] }> = [];
    for (const jobStages of byJob.values()) {
      jobStages.sort((left, right) => left.atMs - right.atMs);
      let attempt: { startedAt: number; records: ParsedQueueStage[] } | null = null;
      const attempts: Array<{ startedAt: number; records: ParsedQueueStage[] }> = [];
      for (const stage of jobStages) {
        if (stage.stage === "job-start") {
          attempt = { startedAt: stage.atMs, records: [stage] };
          attempts.push(attempt);
        } else if (attempt) {
          attempt.records.push(stage);
        }
      }

      for (const candidate of attempts) {
        const inWindow = candidate.records.some((stage) =>
          stage.atMs >= input.startedEpochMs && stage.atMs <= input.endedEpochMs);
        const finishedBeforeJump = candidate.records.some((stage) =>
          stage.stage === "job-finish" && stage.atMs < input.startedEpochMs);
        const activeBeforeJump = candidate.startedAt < input.startedEpochMs && !finishedBeforeJump;
        if (!inWindow && !activeBeforeJump) continue;
        selectedAttempts.push({
          startedAt: candidate.startedAt,
          records: candidate.records.filter((stage) => stage.atMs <= input.endedEpochMs),
        });
      }
    }

    selectedAttempts.sort((left, right) => left.startedAt - right.startedAt);
    const jobs = selectedAttempts.map((attempt, index): AnonymousQueueAttempt => {
      const start = attempt.records.find((stage) => stage.stage === "job-start");
      return {
        jobOrdinal: index + 1,
        kind: start?.kind ?? null,
        priority: start?.priority ?? null,
        stages: attempt.records.map((stage) => ({
          stage: stage.stage,
          kind: stage.kind,
          priority: stage.priority,
          jumpMs: roundMs(stage.atMs - input.startedEpochMs),
          elapsedMs: stage.elapsedMs === null ? null : roundMs(stage.elapsedMs),
        })),
      };
    });
    return { ordinal: assetIndex + 1, found: jobs.length > 0, jobs };
  });

  return { assets };
}

/** Report a bounded, anonymous sample of other active or in-window media jobs. */
export function collectCompetingWorkStages(input: {
  logText: string;
  libraryId: string;
  targetAssetIds: readonly string[];
  startedEpochMs: number;
  endedEpochMs: number;
  maxAssetIds?: number;
}): {
  candidateAssetCount: number;
  includedAssetCount: number;
  truncatedAssetCount: number;
  assets: AnonymousQueueAsset[];
} {
  const targetIds = new Set(input.targetAssetIds.filter((id) => id.length > 0));
  if (targetIds.size === 0) {
    return { candidateAssetCount: 0, includedAssetCount: 0, truncatedAssetCount: 0, assets: [] };
  }

  const relevantByAsset = new Map<string, number>();
  const byJob = new Map<string, ParsedQueueStage[]>();
  for (const stage of parseQueueStages(input.logText)) {
    if (stage.libraryId !== input.libraryId || targetIds.has(stage.assetId)) continue;
    const key = `${stage.assetId}\u0000${stage.jobId}`;
    const records = byJob.get(key) ?? [];
    records.push(stage);
    byJob.set(key, records);
  }

  for (const records of byJob.values()) {
    records.sort((left, right) => left.atMs - right.atMs);
    let attempt: ParsedQueueStage[] = [];
    const attempts: ParsedQueueStage[][] = [];
    for (const record of records) {
      if (record.stage === "job-start") {
        attempt = [record];
        attempts.push(attempt);
      } else if (attempt.length > 0) {
        attempt.push(record);
      }
    }
    for (const current of attempts) {
      const inWindow = current.filter((record) =>
        record.atMs >= input.startedEpochMs && record.atMs <= input.endedEpochMs);
      const start = current.find((record) => record.stage === "job-start");
      const finishedBeforeStart = current.some((record) =>
        record.stage === "job-finish" && record.atMs < input.startedEpochMs);
      const activeBeforeStart = start !== undefined
        && start.atMs < input.startedEpochMs
        && !finishedBeforeStart;
      if (inWindow.length === 0 && !activeBeforeStart) continue;
      const assetId = current[0]!.assetId;
      const relevantAt = inWindow.length > 0 ? Math.min(...inWindow.map((record) => record.atMs)) : start!.atMs;
      const previous = relevantByAsset.get(assetId);
      if (previous === undefined || relevantAt < previous) relevantByAsset.set(assetId, relevantAt);
    }
  }

  const candidates = [...relevantByAsset.entries()]
    .sort((left, right) => left[1] - right[1])
    .map(([assetId]) => assetId);
  const maxAssetIds = Math.max(0, Math.trunc(input.maxAssetIds ?? 64));
  const selectedIds = candidates.slice(0, maxAssetIds);
  const assets = collectLatePreviewQueueStages({
    logText: input.logText,
    libraryId: input.libraryId,
    assetIds: selectedIds,
    startedEpochMs: input.startedEpochMs,
    endedEpochMs: input.endedEpochMs,
  }).assets;
  return {
    candidateAssetCount: candidates.length,
    includedAssetCount: selectedIds.length,
    truncatedAssetCount: Math.max(0, candidates.length - selectedIds.length),
    assets,
  };
}

/** Avoid interpreting an empty `assetIds` filter as a request for the full library. */
export async function queryMissingAssetIds<T>(
  assetIds: readonly string[],
  query: (assetIds: readonly string[]) => Promise<T>,
): Promise<{ queried: boolean; value: T | null }> {
  const uniqueIds = [...new Set(assetIds.filter((id) => id.length > 0))];
  if (uniqueIds.length === 0) return { queried: false, value: null };
  return { queried: true, value: await query(uniqueIds) };
}

export function anonymizeMissingPreviewCards(
  cards: readonly RawMissingCard[],
  queryStatus: MissingPreviewSample["queryStatus"],
  assets: readonly MissingAssetState[],
): MissingPreviewCard[] {
  const byId = new Map(assets.map((asset) => [asset.assetId, asset] as const));
  const ordinals = new Map<string, number>();
  for (const card of cards) {
    if (card.assetId && !ordinals.has(card.assetId)) ordinals.set(card.assetId, ordinals.size + 1);
  }
  return cards.map((card) => {
    const asset = card.assetId ? byId.get(card.assetId) : undefined;
    const queryResolved = queryStatus === "ok";
    return {
      ordinal: card.assetId ? ordinals.get(card.assetId) ?? null : null,
      extension: card.extension,
      mounted: card.mounted,
      complete: card.complete,
      route: card.route,
      ...(card.firstObservedVisibleMs === undefined ? {} : { firstObservedVisibleMs: card.firstObservedVisibleMs }),
      ...(card.firstReportedImmediateMs === undefined ? {} : { firstReportedImmediateMs: card.firstReportedImmediateMs }),
      ...(card.firstReportedPrefetchMs === undefined ? {} : { firstReportedPrefetchMs: card.firstReportedPrefetchMs }),
      found: queryResolved ? asset !== undefined : null,
      thumbnailStatus: asset?.thumbnailStatus ?? null,
      hasArtifact: asset?.hasArtifact ?? null,
      previewKind: asset?.previewKind ?? null,
    };
  });
}

export async function sampleMissingPreviewCards(
  page: Page,
  libraryId: string,
  startedEpochMs: number,
): Promise<MissingPreviewSample> {
  const rawCards = await page.evaluate((): RawMissingCard[] => {
    const canvas = document.querySelector(".workspace-canvas");
    if (!canvas) return [];
    const viewport = canvas.getBoundingClientRect();
    const measured = (globalThis as typeof globalThis & {
      __browseJumpStageProbe?: {
        firstVisibleAt: Map<string, number>; lastMissingAssetIds: string[];
        firstBandReportAt: Map<string, { immediate: number | null; prefetch: number | null }>;
      };
    }).__browseJumpStageProbe;
    // A fast decode may finish between the failed image measurement and this
    // diagnostic. Keep its exact measured target IDs instead of losing them.
    const measuredIds = measured?.lastMissingAssetIds.length ? new Set(measured.lastMissingAssetIds) : null;
    return [...canvas.querySelectorAll<HTMLElement>('.asset-card[data-media-type="image"]')]
      .filter((card) => {
        if (measuredIds) return Boolean(card.dataset.assetId && measuredIds.has(card.dataset.assetId));
        const rect = card.getBoundingClientRect();
        return rect.bottom > viewport.top && rect.top < viewport.bottom
          && rect.right > viewport.left && rect.left < viewport.right;
      })
      .flatMap((card) => {
        const image = card.querySelector<HTMLImageElement>("img.asset-thumbnail");
        if (!measuredIds && image?.complete && image.naturalWidth > 0) return [];
        const extension = /\.([a-z0-9]{1,8})$/i.exec(card.dataset.assetName ?? "")?.[1]?.toLowerCase() ?? "other";
        const src = image?.getAttribute("src") ?? "";
        return [{
          assetId: card.dataset.assetId ?? null,
          extension,
          mounted: Boolean(image),
          complete: image?.complete ?? null,
          route: src.startsWith("serpent://source/") ? "source"
            : src.startsWith("serpent://preview/") ? "preview" : "other",
          firstObservedVisibleMs: card.dataset.assetId
            ? measured?.firstVisibleAt.get(card.dataset.assetId) ?? null : null,
          firstReportedImmediateMs: card.dataset.assetId
            ? measured?.firstBandReportAt.get(card.dataset.assetId)?.immediate ?? null : null,
          firstReportedPrefetchMs: card.dataset.assetId
            ? measured?.firstBandReportAt.get(card.dataset.assetId)?.prefetch ?? null : null,
        } satisfies RawMissingCard];
      });
  });
  const assetIds = [...new Set(rawCards.flatMap((card) => card.assetId ? [card.assetId] : []))];
  const query = await queryMissingAssetIds(assetIds, async (ids) => {
    try {
      return await page.evaluate(async ({ libraryId, assetIds, startedEpochMs }) => {
        const api = (globalThis as typeof globalThis & {
          serpent: { library: SerpentLibraryApi };
        }).serpent.library;
        const [assetResult, jobResult] = await Promise.all([
          api.listAssets({ libraryId, recursive: true, assetIds: [...assetIds] }).catch(() => null),
          api.listMediaJobs({ libraryId, limit: 500 }).catch(() => null),
        ]);
        const assetsOk = assetResult?.ok === true;
        const jobsOk = jobResult?.ok === true;
        const assets: MissingAssetState[] = assetsOk
          ? assetResult.value.map((asset) => ({
            assetId: asset.assetId,
            thumbnailStatus: asset.thumbnailStatus ?? null,
            hasArtifact: Boolean(asset.thumbnailArtifactId),
            previewKind: asset.previewKind ?? null,
          }))
          : [];
        const ordinalById = new Map(assetIds.map((assetId, index) => [assetId, index + 1] as const));
        const jobsByOrdinal = new Map<number, Array<{
          kind: string;
          status: string;
          attemptCount: number;
          createdJumpMs: number | null;
          updatedJumpMs: number | null;
        }>>();
        if (jobsOk) {
          for (const job of jobResult.value.jobs) {
            const ordinal = ordinalById.get(job.assetId);
            if (ordinal === undefined) continue;
            const relativeMs = (value: string): number | null => {
              const atMs = Date.parse(value);
              return Number.isFinite(atMs) ? Math.round(atMs - startedEpochMs) : null;
            };
            const jobs = jobsByOrdinal.get(ordinal) ?? [];
            jobs.push({
              kind: job.kind,
              status: job.status,
              attemptCount: job.attemptCount,
              createdJumpMs: relativeMs(job.createdAt),
              updatedJumpMs: relativeMs(job.updatedAt),
            });
            jobsByOrdinal.set(ordinal, jobs);
          }
        }
        const hasMore = jobsOk ? jobResult.value.hasMore ?? false : null;
        const targets = assetIds.map((_assetId, index) => {
          const ordinal = index + 1;
          const jobs = jobsByOrdinal.get(ordinal) ?? [];
          const matchStatus = !jobsOk ? "query-failed" as const
            : jobs.length > 0 ? "matched" as const
              : hasMore ? "unresolved-truncated" as const : "unmatched" as const;
          return { ordinal, matchStatus, jobs };
        });
        const unmatchedOrdinals = targets
          .filter((target) => target.matchStatus === "unmatched")
          .map((target) => target.ordinal);
        const truncatedOrdinals = targets
          .filter((target) => target.matchStatus === "unresolved-truncated")
          .map((target) => target.ordinal);
        const queryStatus = assetsOk && jobsOk ? "ok" as const
          : assetsOk || jobsOk ? "partial" as const : "failed" as const;
        return {
          assetsOk,
          assets,
          queueSnapshot: {
            queryStatus,
            queryOk: { assets: assetsOk, jobs: jobsOk },
            hasMore,
            targets,
            unmatchedOrdinals,
            truncatedOrdinals,
          } satisfies MissingPreviewQueueSnapshot,
        };
      }, { libraryId, assetIds: [...ids], startedEpochMs });
    } catch {
      return {
        assetsOk: false,
        assets: [] as MissingAssetState[],
        queueSnapshot: {
          queryStatus: "failed" as const,
          queryOk: { assets: false, jobs: false },
          hasMore: null,
          targets: ids.map((_id, index) => ({
            ordinal: index + 1,
            matchStatus: "query-failed" as const,
            jobs: [],
          })),
          unmatchedOrdinals: [],
          truncatedOrdinals: [],
        } satisfies MissingPreviewQueueSnapshot,
      };
    }
  });

  const queryStatus: MissingPreviewSample["queryStatus"] = !query.queried
    ? "skipped-empty"
    : query.value?.assetsOk ? "ok" : "failed";
  const states = query.value?.assetsOk ? query.value.assets : [];
  const emptyQueueSnapshot: MissingPreviewQueueSnapshot = {
    queryStatus: "skipped-empty",
    queryOk: { assets: null, jobs: null },
    hasMore: null,
    targets: [],
    unmatchedOrdinals: [],
    truncatedOrdinals: [],
  };
  return {
    assetIds,
    queryStatus,
    cards: anonymizeMissingPreviewCards(rawCards, queryStatus, states),
    queueSnapshot: query.value?.queueSnapshot ?? emptyQueueSnapshot,
  };
}
