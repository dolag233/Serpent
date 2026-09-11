/**
 * WebDAV 交换格式的资产元数据 sidecar（GitHub #39 / Serpent-b20a7f）。
 *
 * 文件内容仍走 assets/；标签、描述、评分、收藏走 metadata/entries/<syncId>.json。
 * 不上传 SQLite。合集成员与 AI 标签不在首期范围。
 */

import { createHash } from 'node:crypto';

export interface SyncAssetMetadata {
  tags: string[];
  description: string | null;
  rating: number;
  favorite: boolean;
}

export function emptySyncAssetMetadata(): SyncAssetMetadata {
  return { tags: [], description: null, rating: 0, favorite: false };
}

export function canonicalizeSyncAssetMetadata(metadata: SyncAssetMetadata): string {
  const tags = [...new Set(metadata.tags.map((tag) => tag.trim()).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  );
  const description = metadata.description?.trim() ? metadata.description.trim() : null;
  const rating = Number.isInteger(metadata.rating) ? Math.min(5, Math.max(0, metadata.rating)) : 0;
  return JSON.stringify({
    tags,
    description,
    rating,
    favorite: metadata.favorite === true,
  });
}

export function metadataContentHash(metadata: SyncAssetMetadata): string {
  return createHash('sha256').update(canonicalizeSyncAssetMetadata(metadata)).digest('hex');
}

export function parseSyncAssetMetadata(raw: string): SyncAssetMetadata {
  const parsed = JSON.parse(raw) as {
    tags?: unknown;
    description?: unknown;
    rating?: unknown;
    favorite?: unknown;
  };
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Malformed sync metadata sidecar.');
  }
  const tags = Array.isArray(parsed.tags)
    ? parsed.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
    : [];
  const rating = typeof parsed.rating === 'number' && Number.isInteger(parsed.rating)
    ? Math.min(5, Math.max(0, parsed.rating))
    : 0;
  return {
    tags,
    description: typeof parsed.description === 'string' && parsed.description.trim()
      ? parsed.description.trim()
      : null,
    rating,
    favorite: parsed.favorite === true,
  };
}

export function serializeSyncAssetMetadata(metadata: SyncAssetMetadata): string {
  return canonicalizeSyncAssetMetadata(metadata);
}
