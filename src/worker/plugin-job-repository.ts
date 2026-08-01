import { randomUUID } from 'node:crypto';

import {
  PLUGIN_BACKGROUND_JOB_KIND,
  parsePluginJobPayload,
  serializePluginJobPayload,
  type PluginJobRecord,
  type PluginJobRecoveryStrategy,
  type PluginJobStatus,
} from '../plugins/plugin-jobs';

type SqlConnection = {
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
};

type JobRow = {
  job_id: string;
  library_id: string;
  status: PluginJobStatus;
  progress: number;
  attempt_count: number;
  error_code: string | null;
  error_detail: string | null;
  owner_plugin_id: string;
  owner_package_hash: string;
  plugin_handler_id: string;
  payload_json: string | null;
  recovery_strategy: PluginJobRecoveryStrategy;
  created_at: string;
  updated_at: string;
};

function mapRow(row: JobRow): PluginJobRecord {
  return {
    jobId: row.job_id,
    libraryId: row.library_id,
    kind: PLUGIN_BACKGROUND_JOB_KIND,
    status: row.status,
    progress: row.progress,
    attemptCount: row.attempt_count,
    errorCode: row.error_code,
    errorDetail: row.error_detail,
    ownerPluginId: row.owner_plugin_id,
    ownerPackageHash: row.owner_package_hash,
    pluginHandlerId: row.plugin_handler_id,
    payload: parsePluginJobPayload(row.payload_json),
    recoveryStrategy: row.recovery_strategy,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function enqueuePluginJobRecord(
  connection: SqlConnection,
  input: {
    libraryId: string;
    ownerPluginId: string;
    ownerPackageHash: string;
    pluginHandlerId: string;
    payload?: Record<string, unknown>;
    recoveryStrategy: PluginJobRecoveryStrategy;
    priority?: number;
  },
): PluginJobRecord {
  const now = new Date().toISOString();
  const jobId = randomUUID();
  connection.prepare(
    `INSERT INTO jobs (
       job_id, library_id, asset_id, revision_id, kind, status, priority, progress,
       attempt_count, error_code, error_detail, created_at, updated_at,
       owner_plugin_id, owner_package_hash, plugin_handler_id, payload_json, recovery_strategy
     ) VALUES (?, ?, NULL, NULL, ?, 'queued', ?, 0, 0, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    jobId,
    input.libraryId,
    PLUGIN_BACKGROUND_JOB_KIND,
    input.priority ?? 0,
    now,
    now,
    input.ownerPluginId,
    input.ownerPackageHash,
    input.pluginHandlerId,
    serializePluginJobPayload(input.payload ?? {}),
    input.recoveryStrategy,
  );
  const row = connection.prepare(
    `SELECT job_id, library_id, status, progress, attempt_count, error_code, error_detail,
            owner_plugin_id, owner_package_hash, plugin_handler_id, payload_json,
            recovery_strategy, created_at, updated_at
       FROM jobs WHERE job_id = ?`,
  ).get(jobId) as JobRow;
  return mapRow(row);
}

export function listPluginJobRecords(
  connection: SqlConnection,
  libraryId: string,
): PluginJobRecord[] {
  const rows = connection.prepare(
    `SELECT job_id, library_id, status, progress, attempt_count, error_code, error_detail,
            owner_plugin_id, owner_package_hash, plugin_handler_id, payload_json,
            recovery_strategy, created_at, updated_at
       FROM jobs
      WHERE library_id = ? AND kind = ?
      ORDER BY created_at DESC, job_id DESC
      LIMIT 500`,
  ).all(libraryId, PLUGIN_BACKGROUND_JOB_KIND) as JobRow[];
  return rows.map(mapRow);
}

export function claimNextPluginJobRecord(
  connection: SqlConnection,
  input: {
    libraryId: string;
    ownerPluginId: string;
    ownerPackageHash: string;
  },
): PluginJobRecord | null {
  const now = new Date().toISOString();
  const candidate = connection.prepare(
    `SELECT job_id FROM jobs
      WHERE library_id = ?
        AND kind = ?
        AND status = 'queued'
        AND owner_plugin_id = ?
        AND owner_package_hash = ?
      ORDER BY priority DESC, created_at ASC, job_id ASC
      LIMIT 1`,
  ).get(
    input.libraryId,
    PLUGIN_BACKGROUND_JOB_KIND,
    input.ownerPluginId,
    input.ownerPackageHash,
  ) as { job_id: string } | undefined;
  if (candidate === undefined) return null;

  const updated = connection.prepare(
    `UPDATE jobs
        SET status = 'running',
            attempt_count = attempt_count + 1,
            updated_at = ?,
            error_code = NULL,
            error_detail = NULL
      WHERE job_id = ? AND status = 'queued'`,
  ).run(now, candidate.job_id);
  if (updated.changes !== 1) return null;

  const row = connection.prepare(
    `SELECT job_id, library_id, status, progress, attempt_count, error_code, error_detail,
            owner_plugin_id, owner_package_hash, plugin_handler_id, payload_json,
            recovery_strategy, created_at, updated_at
       FROM jobs WHERE job_id = ?`,
  ).get(candidate.job_id) as JobRow;
  return mapRow(row);
}

export function completePluginJobRecord(
  connection: SqlConnection,
  input: {
    jobId: string;
    status: 'succeeded' | 'failed' | 'cancelled';
    errorCode?: string;
    errorDetail?: string;
    progress?: number;
  },
): PluginJobRecord | null {
  const now = new Date().toISOString();
  const updated = connection.prepare(
    `UPDATE jobs
        SET status = ?,
            progress = COALESCE(?, progress),
            error_code = ?,
            error_detail = ?,
            updated_at = ?
      WHERE job_id = ? AND kind = ? AND status = 'running'`,
  ).run(
    input.status,
    input.progress ?? (input.status === 'succeeded' ? 1 : null),
    input.errorCode ?? null,
    input.errorDetail ?? null,
    now,
    input.jobId,
    PLUGIN_BACKGROUND_JOB_KIND,
  );
  if (updated.changes !== 1) return null;
  const row = connection.prepare(
    `SELECT job_id, library_id, status, progress, attempt_count, error_code, error_detail,
            owner_plugin_id, owner_package_hash, plugin_handler_id, payload_json,
            recovery_strategy, created_at, updated_at
       FROM jobs WHERE job_id = ?`,
  ).get(input.jobId) as JobRow | undefined;
  return row === undefined ? null : mapRow(row);
}

export function pausePluginJobsForOwners(
  connection: SqlConnection,
  input: {
    libraryId: string;
    owners: ReadonlyArray<{ pluginId: string; packageHash?: string }>;
    errorCode: string;
    errorDetail: string;
  },
): number {
  if (input.owners.length === 0) return 0;
  const now = new Date().toISOString();
  let paused = 0;
  for (const owner of input.owners) {
    const result = owner.packageHash === undefined
      ? connection.prepare(
        `UPDATE jobs
            SET status = 'paused', error_code = ?, error_detail = ?, updated_at = ?
          WHERE library_id = ?
            AND kind = ?
            AND owner_plugin_id = ?
            AND status IN ('queued', 'running')`,
      ).run(
        input.errorCode,
        input.errorDetail,
        now,
        input.libraryId,
        PLUGIN_BACKGROUND_JOB_KIND,
        owner.pluginId,
      )
      : connection.prepare(
        `UPDATE jobs
            SET status = 'paused', error_code = ?, error_detail = ?, updated_at = ?
          WHERE library_id = ?
            AND kind = ?
            AND owner_plugin_id = ?
            AND owner_package_hash = ?
            AND status IN ('queued', 'running')`,
      ).run(
        input.errorCode,
        input.errorDetail,
        now,
        input.libraryId,
        PLUGIN_BACKGROUND_JOB_KIND,
        owner.pluginId,
        owner.packageHash,
      );
    paused += result.changes;
  }
  return paused;
}

export function recoverInterruptedPluginJobs(
  connection: SqlConnection,
  libraryId: string,
): number {
  const now = new Date().toISOString();
  const result = connection.prepare(
    `UPDATE jobs
        SET status = CASE
              WHEN recovery_strategy = 'idempotent' THEN 'queued'
              ELSE 'paused'
            END,
            error_code = CASE
              WHEN recovery_strategy = 'idempotent' THEN NULL
              ELSE 'PLUGIN_JOB_INTERRUPTED'
            END,
            error_detail = CASE
              WHEN recovery_strategy = 'idempotent' THEN NULL
              ELSE 'The plugin job was interrupted and needs an explicit retry.'
            END,
            updated_at = ?
      WHERE library_id = ?
        AND kind = ?
        AND status = 'running'`,
  ).run(now, libraryId, PLUGIN_BACKGROUND_JOB_KIND);
  return result.changes;
}
