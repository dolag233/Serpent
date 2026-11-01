/** All image inputs are literal filenames, including ancestors containing #. */
export const OIIO_LITERAL_PATHS_MARK = 'literal-paths-v1';

export function literalOiioArgs(args: readonly string[]): string[] {
  return ['--wildcardoff', ...args];
}

export function oiioFailureCode(stderr: string): 'OIIO_COLOR_TRANSFORM_FAILED' | 'OIIO_GENERATION_FAILED' {
  // An input error may contain a color-related word in its filename. Only
  // classify transform errors after ruling out the known input diagnostics.
  if (/No filenames found matching pattern|Could not open|Unable to open|does not exist/iu.test(stderr)) {
    return 'OIIO_GENERATION_FAILED';
  }
  return /\bOCIO\b|\bOpenColorIO\b|--ociodisplay|--colorconfig|color(?:space| transform)/iu.test(stderr)
    ? 'OIIO_COLOR_TRANSFORM_FAILED'
    : 'OIIO_GENERATION_FAILED';
}

interface RepairConnection {
  prepare(sql: string): {
    all(...parameters: unknown[]): unknown[];
    run(...parameters: unknown[]): { changes: number };
  };
  transaction<T>(operation: () => T): () => T;
}

/** Reopen only old current-revision failures affected by literal # paths. */
export function requeueLegacyOiioPathFailures(
  connection: RepairConnection,
  options: { libraryPath: string; assetIds: readonly string[]; limit?: number },
): number {
  const limit = Math.max(0, Math.min(500, options.limit ?? 50));
  if (limit === 0) return 0;
  const rows = connection.prepare(`
    SELECT ra.artifact_id
      FROM revision_artifacts ra
      JOIN assets a ON a.current_revision_id = ra.revision_id
      LEFT JOIN linked_folders lf ON lf.folder_id = a.linked_folder_id
     WHERE ra.kind = 'thumbnail' AND ra.status = 'failed'
       AND ra.invalidated_at IS NULL
       AND ra.generator_version LIKE 'oiio@%'
       AND ra.generator_version NOT LIKE '%${OIIO_LITERAL_PATHS_MARK}%'
       AND ra.error_code IN ('OIIO_COLOR_TRANSFORM_FAILED', 'OIIO_GENERATION_FAILED')
       AND a.deleted_at IS NULL AND a.availability = 'available'
       AND (a.location_kind <> 'linked' OR lf.status = 'available')
       AND (instr(a.relative_file_path, '#') > 0
         OR instr(CASE WHEN a.location_kind = 'linked' THEN lf.absolute_root_path ELSE ? END, '#') > 0)
       ${options.assetIds.length ? `AND a.asset_id IN (${options.assetIds.map(() => '?').join(',')})` : ''}
       AND NOT EXISTS (
         SELECT 1 FROM revision_artifacts ready
          WHERE ready.revision_id = ra.revision_id AND ready.kind = 'thumbnail'
            AND ready.status = 'ready' AND ready.invalidated_at IS NULL
       )
       AND NOT EXISTS (
         SELECT 1 FROM jobs active
          WHERE active.asset_id = a.asset_id AND active.revision_id = ra.revision_id
            AND active.kind = 'generate_thumbnail'
            AND active.status IN ('queued', 'running', 'paused')
       )
     ORDER BY ra.generated_at, ra.artifact_id LIMIT ?
  `).all(options.libraryPath, ...options.assetIds, limit) as Array<{ artifact_id: string }>;
  if (rows.length === 0) return 0;
  const invalidate = connection.prepare(`
    UPDATE revision_artifacts SET invalidated_at = ?
     WHERE artifact_id = ? AND invalidated_at IS NULL AND status = 'failed'
  `);
  const now = new Date().toISOString();
  return connection.transaction(() => rows.reduce(
    (count, row) => count + invalidate.run(now, row.artifact_id).changes, 0,
  ))();
}
