import { copyFile, mkdir, readdir, rename, rm, stat, unlink, utimes } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

export interface PreviewCacheEvent {
  kind: 'hit' | 'store' | 'evicted' | 'error';
  libraryId: string;
  artifactId: string;
  detail?: string;
}

export interface PreviewCacheOptions {
  rootDir: string;
  /** Total mirrored-bytes budget across all libraries; LRU-evicted beyond this. */
  budgetBytes: number;
  /** Run eviction after this many stored bytes since the previous sweep. */
  evictAfterBytes?: number;
  onEvent?: (event: PreviewCacheEvent) => void;
}

/**
 * Serpent-1e3d4f: Chromium does not persist custom-protocol responses in its
 * disk cache (verified 2026-08-22: two sessions sharing one userData
 * re-fetched every preview byte), so remote-library browsing re-pays network
 * or cold-disk costs on every launch. This cache mirrors served preview
 * artifacts into the user-data directory — Eagle's library-caches model:
 * first view copies from the origin in the background, later sessions stream
 * from local disk.
 *
 * Coherence: artifact ids are minted per generation, so an id never maps to
 * different content; stale rows can only be orphaned, never wrong. Eviction
 * is LRU by file mtime against the byte budget. All operations are
 * best-effort: any failure degrades to serving straight from the origin.
 */
export class PreviewCache {
  private readonly rootDir: string;
  private readonly budgetBytes: number;
  private readonly evictAfterBytes: number;
  private readonly onEvent?: (event: PreviewCacheEvent) => void;
  private unflushedStoredBytes = 0;
  private evicting = false;

  constructor(options: PreviewCacheOptions) {
    this.rootDir = options.rootDir;
    this.budgetBytes = Math.max(0, options.budgetBytes);
    this.evictAfterBytes = Math.max(1, options.evictAfterBytes ?? 64 * 1024 * 1024);
    this.onEvent = options.onEvent;
  }

  /** Cached mirror path for an artifact, or null when not mirrored yet. */
  locateSync(libraryId: string, artifactId: string, extension: string): string | null {
    if (!this.isValidSegment(libraryId) || !this.isValidSegment(artifactId)) return null;
    const absolutePath = this.mirrorPath(libraryId, artifactId, extension);
    if (!existsSync(absolutePath)) return null;
    // Fire-and-forget touch so LRU reflects reads, not just writes.
    void utimes(absolutePath, new Date(), new Date()).catch(() => undefined);
    this.onEvent?.({ kind: 'hit', libraryId, artifactId });
    return absolutePath;
  }

  /**
   * Mirror an origin artifact into the cache. Resolves regardless of success:
   * the cache is an accelerator, never a correctness dependency.
   */
  async store(
    libraryId: string,
    artifactId: string,
    originAbsolutePath: string,
    extension: string,
  ): Promise<void> {
    if (!this.isValidSegment(libraryId) || !this.isValidSegment(artifactId)) return;
    if (!extension.startsWith('.') || extension.length <= 1) return;
    const directory = path.join(this.rootDir, libraryId);
    const finalPath = this.mirrorPath(libraryId, artifactId, extension);
    const tempPath = `${finalPath}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      await mkdir(directory, { recursive: true });
      await copyFile(originAbsolutePath, tempPath);
      await rename(tempPath, finalPath);
      const stored = await stat(finalPath);
      this.unflushedStoredBytes += stored.size;
      this.onEvent?.({ kind: 'store', libraryId, artifactId });
      if (this.unflushedStoredBytes >= this.evictAfterBytes && !this.evicting) {
        this.unflushedStoredBytes = 0;
        void this.evictToBudget();
      }
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined);
      this.onEvent?.({
        kind: 'error',
        libraryId,
        artifactId,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Drop oldest-accessed mirrors until total usage fits the budget. */
  async evictToBudget(): Promise<void> {
    if (this.evicting) return;
    this.evicting = true;
    try {
      let entries: Array<{ path: string; size: number; mtimeMs: number }>;
      try {
        entries = await this.collectEntries();
      } catch {
        return;
      }
      let total = entries.reduce((sum, entry) => sum + entry.size, 0);
      if (total <= this.budgetBytes) return;
      entries.sort((left, right) => left.mtimeMs - right.mtimeMs);
      for (const entry of entries) {
        if (total <= this.budgetBytes) break;
        try {
          await unlink(entry.path);
          total -= entry.size;
          this.onEvent?.({
            kind: 'evicted',
            libraryId: path.basename(path.dirname(entry.path)),
            artifactId: path.basename(entry.path),
          });
        } catch {
          // Likely still being streamed on Windows; leave it for the next sweep.
        }
      }
    } finally {
      this.evicting = false;
    }
  }

  /** Remove every mirror for one library (used when the library is deleted). */
  async purgeLibrary(libraryId: string): Promise<void> {
    if (!this.isValidSegment(libraryId)) return;
    await rm(path.join(this.rootDir, libraryId), { recursive: true, force: true }).catch(
      () => undefined,
    );
  }

  /** Introspection for tests: current mirrored byte total. */
  async totalBytes(): Promise<number> {
    const entries = await this.collectEntries();
    return entries.reduce((sum, entry) => sum + entry.size, 0);
  }

  /** Introspection for tests: number of mirrored files. */
  async countFiles(): Promise<number> {
    const entries = await this.collectEntries();
    return entries.length;
  }

  private mirrorPath(libraryId: string, artifactId: string, extension: string): string {
    return path.join(this.rootDir, libraryId, `${artifactId}${extension}`);
  }

  private isValidSegment(segment: string): boolean {
    return segment.length > 0 && !segment.includes('/') && !segment.includes('\\')
      && !segment.includes('..') && segment !== '.';
  }

  private async collectEntries(): Promise<Array<{ path: string; size: number; mtimeMs: number }>> {
    const result: Array<{ path: string; size: number; mtimeMs: number }> = [];
    const libraryDirs = await readdir(this.rootDir, { withFileTypes: true }).catch(
      () => [],
    );
    for (const libraryDir of libraryDirs) {
      if (!libraryDir.isDirectory()) continue;
      const libraryPath = path.join(this.rootDir, libraryDir.name);
      const files = await readdir(libraryPath, { withFileTypes: true });
      for (const file of files) {
        if (!file.isFile()) continue;
        const filePath = path.join(libraryPath, file.name);
        const info = await stat(filePath);
        result.push({ path: filePath, size: info.size, mtimeMs: info.mtimeMs });
      }
    }
    return result;
  }
}
