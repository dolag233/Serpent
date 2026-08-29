import type { WorkerResult } from '../shared/protocol/responses';

/**
 * Worker-local lifecycle fence. A generation advances only after the
 * corresponding lifecycle result is ready to be sent back to Main, so queued
 * work from the previous open cannot enter a newly opened SQLite handle.
 */
export class LibraryGenerationRegistry {
  #generationByLibrary = new Map<string, number>();

  current(libraryId: string): number | undefined {
    return this.#generationByLibrary.get(libraryId);
  }

  isCurrent(libraryId: string, generation: number): boolean {
    return this.#generationByLibrary.get(libraryId) === generation;
  }

  observeResult(result: WorkerResult): void {
    if (!result.ok) return;
    switch (result.type) {
      case 'library.opened':
        this.advance(result.library.libraryId);
        return;
      case 'library.closed':
      case 'library.deleted':
        this.advance(result.libraryId);
        return;
      default:
        return;
    }
  }

  reset(): void {
    this.#generationByLibrary.clear();
  }

  private advance(libraryId: string): void {
    this.#generationByLibrary.set(libraryId, (this.#generationByLibrary.get(libraryId) ?? 0) + 1);
  }
}
