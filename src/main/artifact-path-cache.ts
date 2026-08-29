/**
 * Main-owned LRU for authorized artifact paths.
 *
 * Paths never cross into the Renderer. The cache only avoids repeating a
 * Worker authorization lookup for the same library generation. A generation
 * change fences every old entry and every in-flight completion, so a path
 * resolved before close/reopen cannot repopulate the new library handle.
 */

export type ArtifactPathUsage = "preview" | "proxy" | string;

type CacheEntry = {
  readonly libraryId: string;
  readonly artifactId: string;
  readonly usage: ArtifactPathUsage;
  readonly generation: number;
  readonly absolutePath: string;
};

export class ArtifactPathCache {
  readonly #limit: number;
  readonly #entries = new Map<string, CacheEntry>();
  readonly #generationByLibrary = new Map<string, number>();

  constructor(limit = 4_096) {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new Error("ArtifactPathCache limit must be a positive integer.");
    }
    this.#limit = limit;
  }

  generation(libraryId: string): number {
    return this.#generationByLibrary.get(libraryId) ?? 0;
  }

  /** Advance a library handle generation and evict only that library's entries. */
  clearLibrary(libraryId: string): number {
    const nextGeneration = this.generation(libraryId) + 1;
    this.#generationByLibrary.set(libraryId, nextGeneration);
    const prefix = `${libraryId}\u0000`;
    for (const key of this.#entries.keys()) {
      if (key.startsWith(prefix)) this.#entries.delete(key);
    }
    return nextGeneration;
  }

  clear(): void {
    this.#entries.clear();
    this.#generationByLibrary.clear();
  }

  get(
    libraryId: string,
    artifactId: string,
    usage: ArtifactPathUsage,
    generation = this.generation(libraryId),
  ): string | undefined {
    const key = ArtifactPathCache.key(libraryId, artifactId, usage);
    const entry = this.#entries.get(key);
    if (!entry || entry.generation !== generation) {
      if (entry) this.#entries.delete(key);
      return undefined;
    }
    // A read is an LRU use, not just a lookup.
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry.absolutePath;
  }

  set(
    libraryId: string,
    artifactId: string,
    usage: ArtifactPathUsage,
    absolutePath: string,
    generation = this.generation(libraryId),
  ): boolean {
    if (this.generation(libraryId) !== generation) return false;
    const key = ArtifactPathCache.key(libraryId, artifactId, usage);
    this.#entries.delete(key);
    this.#entries.set(key, {
      libraryId,
      artifactId,
      usage,
      generation,
      absolutePath,
    });
    while (this.#entries.size > this.#limit) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
    return true;
  }

  invalidateArtifact(
    libraryId: string,
    artifactId: string,
    usage?: ArtifactPathUsage,
  ): void {
    if (usage !== undefined) {
      this.#entries.delete(ArtifactPathCache.key(libraryId, artifactId, usage));
      return;
    }
    const prefix = `${libraryId}\u0000`;
    const artifactToken = `\u0000${artifactId}`;
    for (const [key, entry] of this.#entries) {
      if (key.startsWith(prefix) && entry.artifactId === artifactId && key.endsWith(artifactToken)) {
        this.#entries.delete(key);
      }
    }
  }

  get size(): number {
    return this.#entries.size;
  }

  static key(libraryId: string, artifactId: string, usage: ArtifactPathUsage): string {
    return `${libraryId}\u0000${usage}\u0000${artifactId}`;
  }
}
