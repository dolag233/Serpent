/**
 * Model-asset preview resolution and companion-texture mapping (slice A,
 * Serpent-fu2i).
 *
 * This module owns every `model` pipeline decision the Worker makes:
 * - preview resolution: a model always resolves to its original source via
 *   `serpent://source/<libraryId>/<assetId>?revision=...` (Main builds the URL
 *   from playbackMode/sourceRevisionId, same path as direct-play video);
 * - companion mapping: the relative-path → assetId index for the model's
 *   directory (recursive), used by slice C to rewrite OBJ+MTL / FBX external
 *   texture references. Read-only; absolute paths never leave the Worker.
 *
 * Later slices extend this file (B: FBX→GLB conversion URL, E: offscreen
 * thumbnail capture); library-service.ts only wires it.
 *
 * The query reuses the directory-listing pattern from
 * `createDetectedImageSequences` (LIKE with ESCAPE on relative_file_path) —
 * no new raw-SQL surface beyond that proven shape.
 */

import path from 'node:path';

import type { ModelCompanionAsset } from '../shared/model-companions';
import {
  isSupportedModelExtension,
  modelMimeForExtension,
} from '../shared/media-formats';

/**
 * Structural subset of the Worker's SQLite connection. Kept minimal so this
 * module stays free of library-service imports (no circular dependency) and
 * testable with any better-sqlite3-like handle.
 */
export interface ModelCompanionQueryConnection {
  prepare(source: string): {
    all(...parameters: unknown[]): unknown[];
  };
}


/**
 * Companion set cap. A model directory may hold arbitrarily many assets; the
 * payload travels over IPC, so huge directories are truncated deterministically
 * (path order). Slice C degrades gracefully when a texture reference is not in
 * the returned set (spec 3D-12: material falls back instead of crashing).
 */
export const MODEL_COMPANION_MAX_ASSETS = 1_000;

export interface ModelPreviewResolution {
  mediaType: 'model';
  status: 'ready';
  kind: 'thumbnail';
  mimeType: string;
  playbackMode: 'source';
  sourceRevisionId: string;
  sourceMimeType: string;
}

/**
 * Preview resolution for a model asset, or null when the file is not a
 * registered model extension / has no revision. The source file itself is the
 * preview surface (three.js loads it in the renderer); there is no proxy.
 */
export function resolveModelPreviewResolution(
  relativeFilePath: string,
  currentRevisionId: string | null,
): ModelPreviewResolution | null {
  if (!isSupportedModelExtension(relativeFilePath)) return null;
  if (!currentRevisionId) return null;
  const extension = path.posix.extname(relativeFilePath).toLowerCase();
  const mimeType = modelMimeForExtension(extension) ?? 'application/octet-stream';
  return {
    mediaType: 'model',
    status: 'ready',
    kind: 'thumbnail',
    mimeType,
    playbackMode: 'source',
    sourceRevisionId: currentRevisionId,
    sourceMimeType: mimeType,
  };
}

/**
 * List every extension-bearing library asset inside the model's own directory
 * (recursive), excluding the model itself. OBJ/MTL and FBX external textures
 * are resolved by the renderer against this index using relative paths — the
 * same directory the DCC wrote them into. Extensionless files cannot be
 * resolved as texture/material resources and are intentionally omitted because
 * the thumbnail wire contract requires a non-empty extension. No absolute
 * paths, ignored/trashed rows (deleted_at IS NULL), or out-of-directory
 * entries (the LIKE prefix guarantees containment) leave this function.
 */
export function queryModelCompanionAssets(
  connection: ModelCompanionQueryConnection,
  modelRelativePath: string,
): ModelCompanionAsset[] {
  const directory = path.posix.dirname(modelRelativePath);
  const rows =
    directory === '.'
      ? connection.prepare(
          `SELECT asset_id, relative_file_path, current_revision_id
             FROM assets
            WHERE deleted_at IS NULL
              AND instr(relative_file_path, '/') = 0
            ORDER BY relative_file_path
            LIMIT ?`,
        ).all(MODEL_COMPANION_MAX_ASSETS)
      : connection.prepare(
          `SELECT asset_id, relative_file_path, current_revision_id
             FROM assets
            WHERE deleted_at IS NULL
              AND relative_file_path LIKE ? ESCAPE '\\'
            ORDER BY relative_file_path
            LIMIT ?`,
        ).all(
          `${directory.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}/%`,
          MODEL_COMPANION_MAX_ASSETS,
        );

  const companions: ModelCompanionAsset[] = [];
  for (const row of rows as Array<{
    asset_id: string;
    relative_file_path: string;
    current_revision_id: string | null;
  }>) {
    if (row.relative_file_path === modelRelativePath) continue;
    if (!row.current_revision_id) continue;
    const extension = path.posix.extname(row.relative_file_path).toLowerCase();
    if (!extension) continue;
    companions.push({
      relativeFilePath: row.relative_file_path,
      assetId: row.asset_id,
      revisionId: row.current_revision_id,
      extension,
    });
  }
  return companions;
}
