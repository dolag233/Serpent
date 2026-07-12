import type { PublicError } from './protocol/errors';
import type { RendererLibrarySummary, RendererLifecycleEvent } from './protocol/responses';

export type LibraryApiResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: PublicError };

export interface SerpentLibraryApi {
  create(input: { displayName: string }): Promise<LibraryApiResult<RendererLibrarySummary>>;
  open(): Promise<LibraryApiResult<RendererLibrarySummary>>;
  close(input: { libraryId: string }): Promise<LibraryApiResult<{ libraryId: string }>>;
  listOpen(): Promise<LibraryApiResult<RendererLibrarySummary[]>>;
  onLifecycle(listener: (event: RendererLifecycleEvent) => void): () => void;
}
