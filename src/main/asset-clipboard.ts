import type { WorkerCommand } from '../shared/protocol/requests';

export type FileClipboardSnapshot = { paths: string[]; operation: 'copy' | 'cut'; sequence?: number; unavailable?: boolean };

/** Asset identity stays in Main; an OS clipboard change invalidates it. */
export class AssetClipboard {
  private value: { libraryId: string; assetIds: string[]; folderIds: string[]; snapshot: FileClipboardSnapshot; operation: 'copy' | 'cut' } | null = null;

  remember(libraryId: string, assetIds: string[], snapshot: FileClipboardSnapshot, operation: 'copy' | 'cut', folderIds: string[] = []): void {
    this.value = { libraryId, assetIds: [...assetIds], folderIds: [...folderIds], snapshot, operation };
  }

  read(snapshot: FileClipboardSnapshot) {
    if (snapshot.unavailable) return this.value;
    const value = this.value;
    if (!value || JSON.stringify(value.snapshot) !== JSON.stringify(snapshot)) {
      this.value = null;
      return null;
    }
    return value;
  }

  readSequence(sequence: number) {
    if (this.value?.snapshot.sequence !== sequence) this.value = null;
    return this.value;
  }

  consumeSelection(assetIds: readonly string[], folderIds: readonly string[]): void {
    if (!this.value) return;
    const assets = new Set(assetIds);
    const folders = new Set(folderIds);
    this.value.assetIds = this.value.assetIds.filter(id => !assets.has(id));
    this.value.folderIds = this.value.folderIds.filter(id => !folders.has(id));
    if (this.value.assetIds.length === 0 && this.value.folderIds.length === 0) this.value = null;
  }

  completed(command: WorkerCommand): void {
    if (command.type !== 'asset.move' || !this.value) return;
    const moved = new Set(command.assetIds);
    this.value.assetIds = this.value.assetIds.filter(id => !moved.has(id));
    if (this.value.assetIds.length === 0 && this.value.folderIds.length === 0) this.value = null;
  }
}

export const assetClipboard = new AssetClipboard();

/** Update only the clipboard this import started from; preserve newly copied data. */
export function completeFileClipboardMove(snapshot: FileClipboardSnapshot, deps: {
  read: () => FileClipboardSnapshot;
  exists: (file: string) => boolean;
  write: (paths: string[]) => boolean;
  clear: () => void;
}): void {
  if (JSON.stringify(deps.read()) !== JSON.stringify(snapshot)) return;
  const remaining = snapshot.paths.filter(deps.exists);
  if (remaining.length === snapshot.paths.length) return;
  if (remaining.length === 0) deps.clear();
  else deps.write(remaining);
}

// Conflicts can complete in a later RPC. Bound retained clipboard snapshots.
export const pendingClipboardMoves = new Map<string, FileClipboardSnapshot>();
export function rememberClipboardMove(importId: string, snapshot: FileClipboardSnapshot): void {
  pendingClipboardMoves.set(importId, snapshot);
  if (pendingClipboardMoves.size > 100) pendingClipboardMoves.delete(pendingClipboardMoves.keys().next().value!);
}

export function completeInternalClipboardMove(snapshot: FileClipboardSnapshot, assetIds: readonly string[], folderIds: readonly string[], deps: {
  read: () => FileClipboardSnapshot; clear: () => void;
}): void {
  const actual = deps.read();
  const entry = assetClipboard.read(actual);
  if (!entry || JSON.stringify(entry.snapshot) !== JSON.stringify(snapshot)) return;
  assetClipboard.consumeSelection(assetIds, folderIds);
  if (!actual.unavailable && !assetClipboard.read(actual)) deps.clear();
}
