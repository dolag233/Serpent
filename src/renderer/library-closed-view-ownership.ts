import type { RendererLifecycleEvent } from "../shared/protocol/responses";
import {
  isCurrentLibraryViewSession,
  type LibraryViewSession,
  type LibraryViewSessionToken,
} from "./library-view-session";

export type ClosedLibraryUiPorts = {
  snapshot(): { libraryId: string | null; view: LibraryViewSession };
  pendingCloseGenerations(libraryId: string): ReadonlySet<number> | undefined;
  queue(task: () => Promise<void>): Promise<void>;
  closePreview(): Promise<void>;
  applyClosedUi(): void;
  refreshRecentLibraries(): Promise<void>;
  setClosing(): void;
  setIdle(): void;
  reportFailure(error: unknown): void;
};

export function createLibraryClosedHandler(ports: ClosedLibraryUiPorts) {
  return (event: Extract<RendererLifecycleEvent, { type: "library.closed" }>): void => {
    const received = ports.snapshot();
    if (received.libraryId !== event.libraryId || received.view.libraryId !== event.libraryId) return;
    const pending = ports.pendingCloseGenerations(event.libraryId);
    if (event.source !== "mcp" && pending !== undefined
      && !pending.has(received.view.generation)) return;
    const owner: LibraryViewSessionToken = {
      libraryId: event.libraryId,
      generation: received.view.generation,
    };
    const isCurrent = (): boolean => {
      const current = ports.snapshot();
      return current.libraryId === owner.libraryId && isCurrentLibraryViewSession(current.view, owner);
    };

    void ports.queue(async () => {
      if (!isCurrent()) return;
      ports.setClosing();
      try {
        await ports.closePreview();
        if (!isCurrent()) return;
        ports.applyClosedUi();
        await ports.refreshRecentLibraries();
      } catch (error) {
        if (isCurrent()) ports.reportFailure(error);
      } finally {
        if (ports.snapshot().libraryId === null) ports.setIdle();
      }
    });
  };
}
