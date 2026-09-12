/**
 * Card-corner sync status (Serpent-871f34).
 *
 * Derived from local SQLite + last-sync manifest cache. Never poll WebDAV
 * per card. Synced assets return null so the canvas stays quiet.
 */

export const SYNC_CARD_STATUSES = ['pending', 'syncing', 'conflict'] as const;

export type SyncCardStatus = (typeof SYNC_CARD_STATUSES)[number];

/** Statuses the Worker can prove without a live sync session. */
export type SyncCardPersistedStatus = 'pending' | 'conflict';

export function isLocalSyncPending(input: {
  hasCacheEntry: boolean;
  localPath: string;
  cachePath?: string;
  localSize: number;
  cacheSize?: number;
  localMetadataHash: string;
  cacheMetadataHash?: string;
  emptyMetadataHash: string;
}): boolean {
  if (!input.hasCacheEntry) return true;
  const localPath = input.localPath.replaceAll('\\', '/');
  const cachePath = input.cachePath?.replaceAll('\\', '/');
  if (cachePath !== localPath) return true;
  if (input.cacheSize !== input.localSize) return true;
  if (input.cacheMetadataHash === undefined) {
    return input.localMetadataHash !== input.emptyMetadataHash;
  }
  return input.cacheMetadataHash !== input.localMetadataHash;
}

export function deriveSyncCardStatus(input: {
  eligible: boolean;
  pending: boolean;
  syncing: boolean;
  conflict: boolean;
}): SyncCardStatus | null {
  if (!input.eligible) return null;
  if (input.conflict) return 'conflict';
  if (input.syncing) return 'syncing';
  if (input.pending) return 'pending';
  return null;
}

export function overlaySyncCardStatus(
  persisted: SyncCardPersistedStatus | undefined,
  syncing: boolean,
): SyncCardStatus | null {
  if (persisted === 'conflict') return 'conflict';
  if (persisted === 'pending') return syncing ? 'syncing' : 'pending';
  return null;
}
