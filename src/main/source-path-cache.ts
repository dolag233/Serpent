/**
 * Main-process cache for source paths used by the `serpent://source` protocol.
 *
 * A document viewer can issue several range requests for one revision before
 * the first page/video frame is visible. Coalescing those requests keeps the
 * Worker lookup at one round trip and, after the first request, removes it from
 * the hot path entirely. Paths stay in Main; the Renderer only sees the opaque
 * protocol URL.
 */
export type SourcePathResolution = {
  libraryId: string;
  assetId: string;
  revisionId: string;
  absolutePath: string;
  mimeType: string;
};

export class SourcePathCache {
  readonly #resolved = new Map<string, SourcePathResolution>();
  readonly #inFlight = new Map<string, Promise<SourcePathResolution>>();

  static key(libraryId: string, assetId: string, revisionId: string): string {
    return `${libraryId}\u0000${assetId}\u0000${revisionId}`;
  }

  has(libraryId: string, assetId: string, revisionId: string): boolean {
    return this.#resolved.has(SourcePathCache.key(libraryId, assetId, revisionId));
  }

  async getOrResolve(
    input: SourcePathResolution,
    resolve: () => Promise<SourcePathResolution>,
  ): Promise<SourcePathResolution> {
    const key = SourcePathCache.key(input.libraryId, input.assetId, input.revisionId);
    const cached = this.#resolved.get(key);
    if (cached !== undefined) return cached;
    const existing = this.#inFlight.get(key);
    if (existing !== undefined) return existing;

    const pending = resolve().then((resolved) => {
      // A library close/change can invalidate this request while the Worker
      // is still resolving it. Do not repopulate a cache for that old handle.
      if (this.#inFlight.get(key) === pending) this.#resolved.set(key, resolved);
      return resolved;
    }).finally(() => {
      if (this.#inFlight.get(key) === pending) this.#inFlight.delete(key);
    });
    this.#inFlight.set(key, pending);
    return pending;
  }

  delete(libraryId: string, assetId: string, revisionId: string): void {
    this.#resolved.delete(SourcePathCache.key(libraryId, assetId, revisionId));
  }

  clearLibrary(libraryId: string): void {
    const prefix = `${libraryId}\u0000`;
    for (const key of this.#resolved.keys()) {
      if (key.startsWith(prefix)) this.#resolved.delete(key);
    }
    for (const key of this.#inFlight.keys()) {
      if (key.startsWith(prefix)) this.#inFlight.delete(key);
    }
  }

  clear(): void {
    this.#resolved.clear();
    this.#inFlight.clear();
  }
}
