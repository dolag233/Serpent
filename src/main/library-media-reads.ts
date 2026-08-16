/**
 * Track and abort Main-process reads of library files (`serpent://` streams).
 *
 * Chromium keeps those streams open while thumbnails/previews are on screen.
 * Windows then refuses to delete the library root (EPERM / ENOTEMPTY) even
 * after the Worker has closed SQLite. Blocking new reads and aborting the
 * live AbortControllers lets createReadStream drop the handles before rm.
 */

const blockedLibraryIds = new Set<string>();
const abortByLibraryId = new Map<string, AbortController>();

export function isLibraryMediaReadBlocked(libraryId: string): boolean {
  return blockedLibraryIds.has(libraryId);
}

export function blockLibraryMediaReads(libraryId: string): void {
  blockedLibraryIds.add(libraryId);
  const current = abortByLibraryId.get(libraryId);
  if (!current) return;
  current.abort();
  abortByLibraryId.delete(libraryId);
}

export function unblockLibraryMediaReads(libraryId: string): void {
  blockedLibraryIds.delete(libraryId);
}

export function bindLibraryMediaReadSignal(
  libraryId: string,
  requestSignal?: AbortSignal | null,
): AbortSignal {
  if (blockedLibraryIds.has(libraryId)) {
    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    return requestSignal
      ? AbortSignal.any([requestSignal, alreadyAborted.signal])
      : alreadyAborted.signal;
  }

  let controller = abortByLibraryId.get(libraryId);
  if (!controller || controller.signal.aborted) {
    controller = new AbortController();
    abortByLibraryId.set(libraryId, controller);
  }
  return requestSignal
    ? AbortSignal.any([requestSignal, controller.signal])
    : controller.signal;
}
