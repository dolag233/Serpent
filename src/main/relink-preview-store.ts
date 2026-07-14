import { randomUUID } from 'node:crypto';

interface PendingRelinkPreview {
  previewId: string;
  rootPath: string;
}

export class RelinkPreviewStore {
  readonly #pending = new Map<string, PendingRelinkPreview>();

  constructor(private readonly createId: () => string = randomUUID) {}

  create(libraryId: string, rootPath: string): string {
    const previewId = this.createId();
    this.#pending.set(libraryId, { previewId, rootPath });
    return previewId;
  }

  consume(libraryId: string, previewId: string): string | undefined {
    const pending = this.#pending.get(libraryId);
    if (!pending || pending.previewId !== previewId) return undefined;
    this.#pending.delete(libraryId);
    return pending.rootPath;
  }

  cancel(libraryId: string, previewId: string): boolean {
    const pending = this.#pending.get(libraryId);
    if (!pending || pending.previewId !== previewId) return false;
    this.#pending.delete(libraryId);
    return true;
  }

  clearLibrary(libraryId: string): void {
    this.#pending.delete(libraryId);
  }
}
