// Serpent-5xbg: derived-artifact repair for assets that failed generation.
//
// The thumbnail/video-poster/contact-sheet/audio-proxy queues only ever enqueue
// assets with NO terminal artifact; a failed artifact (e.g. transient FFmpeg
// unavailability, a killed process, a cancelled import job) permanently blocks
// re-enqueue. This module re-opens the queue for *retryable* failures when an
// asset is loaded/browsed (startup + visible scenes): failures caused by
// missing/corrupt sources or permanent format limits stay marked failed and
// are never retried, everything else retries with a backoff so a broken file
// cannot spin the queue forever.
//
// Backoff uses the failed artifact's generated_at (set when the failure was
// recorded); retrying is implemented as invalidation so the existing
// enqueueThumbnailJobs SQL (which skips assets with a live terminal artifact)
// picks the revision up again — no new queue condition needed.

import { columnsFor } from './lenient-columns';

/** Structural surface: the real OpenLibrary.connection satisfies this. */
export interface RetryFailedConnection {
  pragma(source: string, options?: { simple?: boolean }): unknown;
  prepare(sql: string): {
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): { changes: number };
  };
}

/** Failures that retrying can never fix — the source or the format is the problem. */
export const PERMANENT_DERIVED_FAILURE_CODES: ReadonlySet<string> = new Set([
  'SOURCE_NOT_FOUND',
  'FBX_SOURCE_NOT_FOUND',
  'FILE_TOO_LARGE',
  'LIMIT_EXCEEDED',
  'MODEL_TOO_LARGE',
  'FBX_LIMIT_EXCEEDED',
  'UNSUPPORTED_FORMAT',
  'MIME_TYPE_UNSUPPORTED',
  'FBX_NOT_FBX',
  'FBX_NO_MESHES',
]);

/** Minimum delay between retry attempts of the same failed artifact. */
export const DERIVED_RETRY_BACKOFF_MS = 30 * 60 * 1000;

export interface RetryFailedOptions {
  /** Priority for the jobs that will be enqueued by the caller. */
  priority?: number;
  /** Cap on how many failures one wave may re-open (large-library safety). */
  limit?: number;
  /** Injectable clock for tests. */
  now?: Date;
}

// A failed video proxy is not an automatic repair candidate. Its existence is
// evidence only that some previous path asked for it; it does not prove that
// the source failed direct playback. The viewer owns the explicit retry after
// a real media-element error (Serpent-cljb).
// Serpent-140fe2: contact_sheet is excluded — failed sheets stay terminal and
// regenerate lazily at AI-analysis time (ensureVideoContactSheet).
const DERIVED_KINDS = "'thumbnail', 'video_poster', 'audio_proxy'";

/**
 * Invalidate retryable failed derived artifacts so the next thumbnail-queue
 * pass re-enqueues them. Returns the number of artifacts re-opened.
 *
 * A failed artifact is retryable when:
 *  - the source asset is still available on disk,
 *  - its error code is not in the permanent-failure set (missing source,
 *    over-limit files, unsupported formats, malformed FBX…),
 *  - the previous attempt is older than the backoff window, and
 *  - no active job for the same artifact is queued/running/paused.
 */
export function requeueRetryableFailedArtifacts(
  connection: RetryFailedConnection,
  options: RetryFailedOptions = {},
): number {
  // Serpent-verg.2 — lenient open (0031 §1): libraries predating the
  // artifact status columns have no failed artifacts to repair; skip instead
  // of failing to open.
  if (!columnsFor(connection, 'revision_artifacts').has('status')) return 0;
  const now = (options.now ?? new Date()).toISOString();
  const backoffCutoff = new Date(
    (options.now ?? new Date()).getTime() - DERIVED_RETRY_BACKOFF_MS,
  ).toISOString();
  const permanentCodes = [...PERMANENT_DERIVED_FAILURE_CODES]
    .map(() => '?')
    .join(',');
  const limit = options.limit === undefined
    ? undefined
    : Math.max(1, Math.min(500, Math.trunc(options.limit)));

  const rows = connection
    .prepare(
      `SELECT ra.artifact_id, ra.revision_id, ra.kind
         FROM revision_artifacts ra
         JOIN assets a ON a.current_revision_id = ra.revision_id
        WHERE ra.kind IN (${DERIVED_KINDS})
          AND ra.status = 'failed'
          AND ra.invalidated_at IS NULL
          AND ra.generated_at IS NOT NULL
          AND ra.generated_at <= ?
          AND a.deleted_at IS NULL
          AND a.availability = 'available'
          AND COALESCE(ra.error_code, '') NOT IN (${permanentCodes})
          AND NOT EXISTS (
            SELECT 1 FROM jobs active
             WHERE active.asset_id = a.asset_id
               AND active.revision_id = ra.revision_id
               AND active.kind = CASE ra.kind
                 WHEN 'contact_sheet' THEN 'generate_contact_sheet'
                 WHEN 'audio_proxy' THEN 'generate_audio_proxy'
                 ELSE 'generate_thumbnail'
               END
               AND active.status IN ('queued', 'running', 'paused')
          )
        ORDER BY ra.generated_at
        ${limit === undefined ? '' : 'LIMIT ?'}`,
    )
    .all(
      backoffCutoff,
      ...[...PERMANENT_DERIVED_FAILURE_CODES],
      ...(limit === undefined ? [] : [limit]),
    ) as Array<{
      artifact_id: string;
      revision_id: string;
      kind: string;
    }>;

  if (rows.length === 0) return 0;

  const invalidate = connection.prepare(
    `UPDATE revision_artifacts
        SET invalidated_at = ?
      WHERE artifact_id = ? AND status = 'failed' AND invalidated_at IS NULL`,
  );
  let count = 0;
  for (const row of rows) {
    count += invalidate.run(now, row.artifact_id).changes;
  }
  return count;
}
