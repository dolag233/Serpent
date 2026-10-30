type NativeDragAssetSummary = {
  readonly assetId: string;
  readonly sequence?: {
    readonly frames: readonly { readonly assetId: string }[];
  } | null;
};

type NativeDragAssetResult = {
  readonly ok: boolean;
  readonly type?: string;
  readonly assets?: unknown;
  readonly items?: unknown;
  readonly asset?: unknown;
  readonly completion?: unknown;
  readonly result?: unknown;
};

const ASSET_ARRAY_RESULT_TYPES = new Set([
  "asset.list",
  "collection.assets.list",
  "asset.list-trash",
  "asset.refreshed",
  "linked-folder.assets.copied",
  "linked-folder.converted",
  "asset.restored",
  "asset.moved",
  "asset.move-undone",
  "asset.trash-undone",
  "asset.copied",
  "asset.copy-undone",
  "asset.files-renamed",
  "asset.restored-if-original-vacant",
  "asset.relink-batch.applied",
]);

const ASSET_ITEM_RESULT_TYPES = new Set([
  "asset.search.result",
  "smart-collection.executed",
  "browse.session.opened",
  "browse.session.page",
]);

const SINGLE_ASSET_RESULT_TYPES = new Set([
  "asset.sequence.created",
  "asset.file-renamed",
  "asset.text.saved",
  "asset.relinked",
  "extension.asset-saved",
]);

function isNativeDragAssetSummary(value: unknown): value is NativeDragAssetSummary {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { assetId?: unknown }).assetId === "string"
  );
}

function assetSummaryArray(value: unknown): readonly NativeDragAssetSummary[] {
  if (!Array.isArray(value)) return [];
  return value.every(isNativeDragAssetSummary)
    ? value
    : value.filter(isNativeDragAssetSummary);
}

function nestedAssetArray(value: unknown): readonly NativeDragAssetSummary[] {
  if (typeof value !== "object" || value === null) return [];
  return assetSummaryArray((value as { assets?: unknown }).assets);
}

/**
 * Return every card summary that Main can receive before native dragstart.
 * Browse sessions replaced the old search/list response for the main canvas,
 * while mutation/import responses use several other shapes. Keeping the
 * complete mapping centralized prevents any response rename or new result
 * shape from silently disabling native dragging again.
 */
export function nativeDragAssetsForResult(
  result: NativeDragAssetResult,
): readonly NativeDragAssetSummary[] {
  if (!result.ok) return [];
  const type = result.type ?? "";
  if (ASSET_ARRAY_RESULT_TYPES.has(type)) {
    return assetSummaryArray(result.assets);
  }
  if (ASSET_ITEM_RESULT_TYPES.has(type)) {
    return assetSummaryArray(result.items);
  }
  if (SINGLE_ASSET_RESULT_TYPES.has(type)) {
    return isNativeDragAssetSummary(result.asset) ? [result.asset] : [];
  }
  if (type === "asset.import.completed") {
    return nestedAssetArray(result.completion);
  }
  if (
    type === "asset.import-eagle.completed" ||
    type === "asset.import-billfish.completed" ||
    type === "asset.import-pixcall.completed"
  ) {
    return nestedAssetArray(result.result);
  }
  return [];
}

export type NativeAssetDragPrimeEntries = readonly unknown[];

export interface NativeAssetDragPrimeSchedulerOptions {
  /**
   * Resolve drag entries for one batch of asset ids. Returns `null` when the
   * Worker request failed, so the scheduler keeps the previous cache contents.
   */
  fetchEntries: (
    libraryId: string,
    assetIds: readonly string[],
  ) => Promise<NativeAssetDragPrimeEntries | null>;
  /** Store resolved entries in the native drag cache. */
  applyEntries: (
    libraryId: string,
    entries: NativeAssetDragPrimeEntries,
    mode: "replace" | "upsert",
  ) => void;
  /** Worker requests never carry more ids than this (matches the Worker batch). */
  chunkSize?: number;
  /** Scheduling gap between background chunks, in ms. */
  gapMs?: number;
  /** Per-library pending cap; excess ids hydrate on demand at first drag. */
  maxPendingPerLibrary?: number;
  /** Injectable delay so tests do not wait for real timers. */
  wait?: (delayMs: number) => Promise<void>;
}

export type NativeAssetDragPrimeSchedulerStats = {
  /** Worker requests issued for drag entries. */
  requests: number;
  /** Asset ids accepted into a queue. */
  queuedAssets: number;
  /** Asset ids rejected because the per-library pending cap was reached. */
  droppedAssets: number;
  /** Enqueues that joined an already running drain instead of starting one. */
  coalescedEnqueues: number;
  /** Largest per-library pending set observed. */
  maxPending: number;
};

type NativeAssetDragPrimeQueue = {
  pending: Set<string>;
  /** Ids already claimed by an in-flight request; never re-enqueued. */
  inFlight: Set<string>;
  generation: number;
  running: boolean;
};

const DEFAULT_DRAG_PRIME_CHUNK_SIZE = 500;
const DEFAULT_DRAG_PRIME_GAP_MS = 25;
const DEFAULT_DRAG_PRIME_MAX_PENDING = 20_000;

/**
 * Serpent-8ee170: Main used to issue one `media.get-asset-drag-infos` request
 * per finished thumbnail, so a 2,000-job wave produced 2,000 background
 * requests on top of the queue they were competing with. Every completion now
 * joins a per-library, deduplicated, chunked queue instead: the number of
 * Worker requests is bounded by `pending / chunkSize`, never by the number of
 * events, and a library switch or close drops the old generation's work.
 */
export class NativeAssetDragPrimeScheduler {
  readonly #options: Required<Omit<NativeAssetDragPrimeSchedulerOptions, "fetchEntries" | "applyEntries">> & {
    fetchEntries: NativeAssetDragPrimeSchedulerOptions["fetchEntries"];
    applyEntries: NativeAssetDragPrimeSchedulerOptions["applyEntries"];
  };
  readonly #queues = new Map<string, NativeAssetDragPrimeQueue>();
  readonly #stats: NativeAssetDragPrimeSchedulerStats = {
    requests: 0,
    queuedAssets: 0,
    droppedAssets: 0,
    coalescedEnqueues: 0,
    maxPending: 0,
  };

  constructor(options: NativeAssetDragPrimeSchedulerOptions) {
    this.#options = {
      fetchEntries: options.fetchEntries,
      applyEntries: options.applyEntries,
      chunkSize: Math.max(1, Math.trunc(options.chunkSize ?? DEFAULT_DRAG_PRIME_CHUNK_SIZE)),
      gapMs: Math.max(0, Math.trunc(options.gapMs ?? DEFAULT_DRAG_PRIME_GAP_MS)),
      maxPendingPerLibrary: Math.max(
        1,
        Math.trunc(options.maxPendingPerLibrary ?? DEFAULT_DRAG_PRIME_MAX_PENDING),
      ),
      wait: options.wait ?? ((delayMs: number) => new Promise<void>((resolve) => {
        setTimeout(resolve, delayMs);
      })),
    };
  }

  /**
   * Queue ids for background hydration. Cheap enough to call once per media
   * event: duplicates collapse and a running drain is reused.
   */
  enqueue(libraryId: string, assetIds: readonly string[]): void {
    if (assetIds.length === 0) return;
    const queue = this.#queueFor(libraryId);
    for (const assetId of assetIds) {
      if (queue.pending.has(assetId) || queue.inFlight.has(assetId)) continue;
      if (queue.pending.size + queue.inFlight.size >= this.#options.maxPendingPerLibrary) {
        this.#stats.droppedAssets += 1;
        continue;
      }
      queue.pending.add(assetId);
      this.#stats.queuedAssets += 1;
    }
    this.#stats.maxPending = Math.max(this.#stats.maxPending, queue.pending.size);
    if (queue.running) {
      this.#stats.coalescedEnqueues += 1;
      return;
    }
    queue.running = true;
    void this.#drain(libraryId, queue);
  }

  /**
   * Resolve a bounded set synchronously, for assets that must be ready before a
   * response reaches the renderer (the visible first screen of a browse page).
   */
  async primeImmediately(
    libraryId: string,
    assetIds: readonly string[],
    mode: "replace" | "upsert" = "replace",
  ): Promise<void> {
    const unique = [...new Set(assetIds)];
    if (unique.length === 0) {
      if (mode === "replace") this.#options.applyEntries(libraryId, [], mode);
      return;
    }
    this.#stats.requests += 1;
    const entries = await this.#options.fetchEntries(libraryId, unique);
    if (entries === null) return;
    this.#options.applyEntries(libraryId, entries, mode);
  }

  /** Library closed or switched: drop queued work and ignore in-flight results. */
  invalidate(libraryId: string): void {
    const queue = this.#queues.get(libraryId);
    if (!queue) return;
    queue.generation += 1;
    queue.pending.clear();
    if (!queue.running) this.#queues.delete(libraryId);
  }

  /** Window teardown: drop every library's queued work. */
  clear(): void {
    for (const libraryId of [...this.#queues.keys()]) this.invalidate(libraryId);
  }

  stats(): NativeAssetDragPrimeSchedulerStats {
    return { ...this.#stats };
  }

  #queueFor(libraryId: string): NativeAssetDragPrimeQueue {
    const existing = this.#queues.get(libraryId);
    if (existing) return existing;
    const created: NativeAssetDragPrimeQueue = {
      pending: new Set(),
      inFlight: new Set(),
      generation: 0,
      running: false,
    };
    this.#queues.set(libraryId, created);
    return created;
  }

  async #drain(libraryId: string, queue: NativeAssetDragPrimeQueue): Promise<void> {
    const generation = queue.generation;
    try {
      while (queue.generation === generation && queue.pending.size > 0) {
        const chunk = [...queue.pending].slice(0, this.#options.chunkSize);
        for (const assetId of chunk) {
          queue.pending.delete(assetId);
          queue.inFlight.add(assetId);
        }
        this.#stats.requests += 1;
        let entries: NativeAssetDragPrimeEntries | null = null;
        try {
          entries = await this.#options.fetchEntries(libraryId, chunk);
        } finally {
          for (const assetId of chunk) queue.inFlight.delete(assetId);
        }
        if (queue.generation !== generation) return;
        if (entries !== null) this.#options.applyEntries(libraryId, entries, "upsert");
        // Leave a real scheduling gap: viewer, search and thumbnail requests
        // must be able to enter the Worker queue between background waves.
        await this.#options.wait(this.#options.gapMs);
      }
    } finally {
      queue.running = false;
      if (this.#queues.get(libraryId) === queue) {
        if (queue.pending.size === 0) {
          this.#queues.delete(libraryId);
        } else {
          // A new request arrived while the queue was cancelled or replaced;
          // continue with the current generation instead of dropping it.
          queue.running = true;
          void this.#drain(libraryId, queue);
        }
      }
    }
  }
}
