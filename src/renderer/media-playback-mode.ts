import type { AssetSummary } from '../shared/asset-types';

export type MediaPlaybackMode = 'stop' | 'repeat-one' | 'sequential';
const STORAGE_KEY = 'serpent.media-playback-mode.v1';
const MODES: readonly MediaPlaybackMode[] = ['stop', 'repeat-one', 'sequential'];

export function nextMediaPlaybackMode(mode: MediaPlaybackMode): MediaPlaybackMode {
  return MODES[(MODES.indexOf(mode) + 1) % MODES.length]!;
}

export function loadMediaPlaybackMode(storage: Pick<Storage, 'getItem'> = localStorage): MediaPlaybackMode {
  try {
    const value = storage.getItem(STORAGE_KEY);
    return MODES.includes(value as MediaPlaybackMode) ? value as MediaPlaybackMode : 'repeat-one';
  } catch { return 'repeat-one'; }
}

export function saveMediaPlaybackMode(mode: MediaPlaybackMode, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try { storage.setItem(STORAGE_KEY, mode); } catch { /* Session mode still works if storage is unavailable. */ }
}

/** Folder identity includes the linked root and the physical parent path. */
export function isSiblingMedia(current: AssetSummary, candidate: AssetSummary): boolean {
  const parent = (asset: AssetSummary) => asset.relativeFilePath.split('/').slice(0, -1).join('/');
  return candidate.assetId !== current.assetId && candidate.availability === 'available' && !candidate.deletedAt &&
    (candidate.mediaType === 'video' || candidate.mediaType === 'audio') && !candidate.sequence &&
    current.locationKind === candidate.locationKind &&
    current.managedFolderId === candidate.managedFolderId &&
    (current.linkedFolderId ?? null) === (candidate.linkedFolderId ?? null) && parent(current) === parent(candidate);
}

/** Read the complete ordered scope in bounded batches, including unloaded pages. */
export async function findNextSiblingMedia(input: {
  current: AssetSummary;
  orderedIds: readonly string[];
  load: (ids: string[]) => Promise<AssetSummary[]>;
  isCurrent: () => boolean;
}): Promise<AssetSummary | null> {
  const index = input.orderedIds.indexOf(input.current.assetId);
  if (index < 0) return null;
  for (let offset = index + 1; offset < input.orderedIds.length && input.isCurrent(); offset += 100) {
    const ids = input.orderedIds.slice(offset, offset + 100);
    const candidates = new Map((await input.load(ids)).map(asset => [asset.assetId, asset]));
    if (!input.isCurrent()) return null;
    for (const id of ids) {
      const candidate = candidates.get(id);
      if (candidate && isSiblingMedia(input.current, candidate)) return candidate;
    }
  }
  return null;
}
