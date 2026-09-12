/**
 * WebDAV 交换格式的资产元数据 sidecar（GitHub #39 / Serpent-b20a7f / Serpent-4ffae8）。
 *
 * 文件内容仍走 assets/；人标签、描述、评分、收藏与 AI 标签/简介/评分
 * 走 metadata/entries/<syncId>.json。不上传 SQLite。合集成员不在本通道。
 *
 * 旧 sidecar 没有 `ai` 键：哈希与人手字段兼容，应用时不改 AI 层。
 * 有 `ai` 对象时整层替换（写入 ai_asset_tags / ai_content，不写人手表）。
 */

import { createHash } from 'node:crypto';

export interface SyncAiLayer {
  tags: string[];
  description: string | null;
  rating: number | null;
  modelId: string;
  modelVersion: string;
}

export interface SyncAssetMetadata {
  tags: string[];
  description: string | null;
  rating: number;
  favorite: boolean;
  /** 缺省表示旧 sidecar / 本地无 AI 数据，应用时不碰 AI 层。 */
  ai?: SyncAiLayer;
}

export function emptySyncAssetMetadata(): SyncAssetMetadata {
  return { tags: [], description: null, rating: 0, favorite: false };
}

export function hasSyncAiLayer(ai: SyncAiLayer | undefined): boolean {
  if (!ai) return false;
  return ai.tags.length > 0
    || Boolean(ai.description?.trim())
    || (ai.rating != null && ai.rating >= 1);
}

function canonicalizeAiLayer(ai: SyncAiLayer): SyncAiLayer {
  const tags = [...new Set(ai.tags.map((tag) => tag.trim()).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  );
  const description = ai.description?.trim() ? ai.description.trim() : null;
  const rating = typeof ai.rating === 'number' && Number.isInteger(ai.rating) && ai.rating >= 1 && ai.rating <= 5
    ? ai.rating
    : null;
  return {
    tags,
    description,
    rating,
    modelId: ai.modelId.trim() || 'sync',
    modelVersion: ai.modelVersion.trim() || '1',
  };
}

export function canonicalizeSyncAssetMetadata(metadata: SyncAssetMetadata): string {
  const tags = [...new Set(metadata.tags.map((tag) => tag.trim()).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  );
  const description = metadata.description?.trim() ? metadata.description.trim() : null;
  const rating = Number.isInteger(metadata.rating) ? Math.min(5, Math.max(0, metadata.rating)) : 0;
  const body: {
    tags: string[];
    description: string | null;
    rating: number;
    favorite: boolean;
    ai?: SyncAiLayer;
  } = {
    tags,
    description,
    rating,
    favorite: metadata.favorite === true,
  };
  if (hasSyncAiLayer(metadata.ai) && metadata.ai) {
    body.ai = canonicalizeAiLayer(metadata.ai);
  }
  return JSON.stringify(body);
}

export function metadataContentHash(metadata: SyncAssetMetadata): string {
  return createHash('sha256').update(canonicalizeSyncAssetMetadata(metadata)).digest('hex');
}

function parseAiLayer(raw: unknown): SyncAiLayer | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const parsed = raw as {
    tags?: unknown;
    description?: unknown;
    rating?: unknown;
    modelId?: unknown;
    modelVersion?: unknown;
  };
  const tags = Array.isArray(parsed.tags)
    ? parsed.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
    : [];
  const rating = typeof parsed.rating === 'number' && Number.isInteger(parsed.rating) && parsed.rating >= 1 && parsed.rating <= 5
    ? parsed.rating
    : null;
  const layer: SyncAiLayer = {
    tags,
    description: typeof parsed.description === 'string' && parsed.description.trim()
      ? parsed.description.trim()
      : null,
    rating,
    modelId: typeof parsed.modelId === 'string' && parsed.modelId.trim() ? parsed.modelId.trim() : 'sync',
    modelVersion: typeof parsed.modelVersion === 'string' && parsed.modelVersion.trim()
      ? parsed.modelVersion.trim()
      : '1',
  };
  return hasSyncAiLayer(layer) ? layer : undefined;
}

export function parseSyncAssetMetadata(raw: string): SyncAssetMetadata {
  const parsed = JSON.parse(raw) as {
    tags?: unknown;
    description?: unknown;
    rating?: unknown;
    favorite?: unknown;
    ai?: unknown;
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
  const ai = parseAiLayer(parsed.ai);
  return {
    tags,
    description: typeof parsed.description === 'string' && parsed.description.trim()
      ? parsed.description.trim()
      : null,
    rating,
    favorite: parsed.favorite === true,
    ...(ai === undefined ? {} : { ai }),
  };
}

export function serializeSyncAssetMetadata(metadata: SyncAssetMetadata): string {
  return canonicalizeSyncAssetMetadata(metadata);
}
