/**
 * Bounded Worker-side cache for the small descriptor row that points at a
 * derived artifact. The database remains authoritative: every entry carries
 * the library change sequence observed with the row, so any artifact insert,
 * update, invalidation or delete makes the entry miss without a global flush.
 */

export interface ArtifactDescriptorCacheMetrics {
  hits: number;
  misses: number;
  stores: number;
  evictions: number;
  invalidations: number;
}

type Entry<T> = {
  readonly key: string;
  readonly changeSequence: number;
  readonly value: T;
};

export class ArtifactDescriptorCache<T> {
  readonly #limit: number;
  readonly #entries = new Map<string, Entry<T>>();
  readonly #metrics: ArtifactDescriptorCacheMetrics = {
    hits: 0,
    misses: 0,
    stores: 0,
    evictions: 0,
    invalidations: 0,
  };

  constructor(limit = 2_048) {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new Error('ArtifactDescriptorCache limit must be a positive integer.');
    }
    this.#limit = limit;
  }

  get(key: string, changeSequence: number): T | undefined {
    const entry = this.#entries.get(key);
    if (!entry || entry.changeSequence !== changeSequence) {
      if (entry) {
        this.#entries.delete(key);
        this.#metrics.invalidations += 1;
      }
      this.#metrics.misses += 1;
      return undefined;
    }
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    this.#metrics.hits += 1;
    return entry.value;
  }

  set(key: string, value: T, changeSequence: number): void {
    this.#entries.delete(key);
    this.#entries.set(key, { key, value, changeSequence });
    this.#metrics.stores += 1;
    while (this.#entries.size > this.#limit) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
      this.#metrics.evictions += 1;
    }
  }

  /** Remove all descriptors for a library without disturbing other libraries. */
  invalidateLibrary(libraryId: string): void {
    const prefix = `${libraryId}\u0000`;
    for (const key of this.#entries.keys()) {
      if (!key.startsWith(prefix)) continue;
      this.#entries.delete(key);
      this.#metrics.invalidations += 1;
    }
  }

  clear(): void {
    this.#metrics.invalidations += this.#entries.size;
    this.#entries.clear();
  }

  metrics(): ArtifactDescriptorCacheMetrics {
    return { ...this.#metrics };
  }

  resetMetrics(): void {
    for (const key of Object.keys(this.#metrics) as Array<keyof ArtifactDescriptorCacheMetrics>) {
      this.#metrics[key] = 0;
    }
  }

  get size(): number {
    return this.#entries.size;
  }

  static key(
    libraryId: string,
    assetId: string,
    revisionId: string,
    kind: string,
    expectedGeneratorVersion?: string,
  ): string {
    return [
      libraryId,
      assetId,
      revisionId,
      kind,
      expectedGeneratorVersion ?? '*',
    ].join('\u0000');
  }
}
