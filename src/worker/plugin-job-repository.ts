import { randomUUID } from 'node:crypto';

import {
  PLUGIN_BACKGROUND_JOB_KIND,
  applyPluginJobProgress,
  assertPluginJobControlAllowed,
  parsePluginJobPayload,
  pluginJobOwnerCanRetry,
  pluginJobOwnerMatches,
  serializePluginJobPayload,
  type PluginJobCheckpoint,
  type PluginJobHandlerCapabilities,
  type PluginJobItemResult,
  type PluginJobProgressInput,
  type PluginJobRecord,
  type PluginJobRecoveryStrategy,
  type PluginJobStatus,
  type PluginJobOwnerFields,
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

const PLUGIN_JOB_STATE_KEY = '__serpent_plugin_job_state_v1';

type PersistedPluginJobState = {
  applicationSessionId?: string;
  ownerPluginInstanceId?: string;
  ownerScope?: 'library' | 'global';
  ownerLibraryId?: string | null;
  executionAvailability?: 'ready' | 'blocked';
  completed?: number;
  total?: number;
  phase?: string;
  message?: string;
  itemResults?: PluginJobItemResult[];
  failedAssetIds?: string[];
  retryInput?: Record<string, unknown>;
  checkpoint?: PluginJobCheckpoint;
  cancellation?: { requested: boolean; reason?: string };
};

function parseStoredJobPayload(raw: string | null): {
  payload: Record<string, unknown>;
  state: PersistedPluginJobState;
} {
  const parsed = parsePluginJobPayload(raw);
  const envelope = parsed[PLUGIN_JOB_STATE_KEY];
  if (typeof envelope !== 'object' || envelope === null || Array.isArray(envelope)) {
    return { payload: parsed, state: {} };
  }
  const value = envelope as { payload?: unknown; state?: unknown };
  const payload = typeof value.payload === 'object' && value.payload !== null && !Array.isArray(value.payload)
    ? value.payload as Record<string, unknown>
    : {};
  const state = typeof value.state === 'object' && value.state !== null && !Array.isArray(value.state)
    ? value.state as PersistedPluginJobState
    : {};
  return { payload, state };
}

function serializeStoredJobPayload(payload: Record<string, unknown>, state: PersistedPluginJobState): string {
  return serializePluginJobPayload({ [PLUGIN_JOB_STATE_KEY]: { payload, state } });
}

function mapRow(row: JobRow): PluginJobRecord {
  const stored = parseStoredJobPayload(row.payload_json);
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
    ...(stored.state.ownerPluginInstanceId === undefined ? {} : { ownerPluginInstanceId: stored.state.ownerPluginInstanceId }),
    ...(stored.state.ownerScope === undefined ? {} : { ownerScope: stored.state.ownerScope }),
    ...(stored.state.ownerLibraryId === undefined ? {} : { ownerLibraryId: stored.state.ownerLibraryId }),
    ...(stored.state.executionAvailability === undefined ? {} : { executionAvailability: stored.state.executionAvailability }),
    pluginHandlerId: row.plugin_handler_id,
    payload: stored.payload,
    recoveryStrategy: row.recovery_strategy,
    ...(stored.state.completed === undefined ? {} : { completed: stored.state.completed }),
    ...(stored.state.total === undefined ? {} : { total: stored.state.total }),
    ...(stored.state.phase === undefined ? {} : { phase: stored.state.phase }),
    ...(stored.state.message === undefined ? {} : { message: stored.state.message }),
    ...(stored.state.itemResults === undefined ? {} : { itemResults: stored.state.itemResults }),
    ...(stored.state.failedAssetIds === undefined ? {} : { failedAssetIds: stored.state.failedAssetIds }),
    ...(stored.state.retryInput === undefined ? {} : { retryInput: stored.state.retryInput }),
    ...(stored.state.checkpoint === undefined ? {} : { checkpoint: stored.state.checkpoint }),
    ...(stored.state.cancellation === undefined ? {} : { cancellation: stored.state.cancellation }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_PLUGIN_JOB = `
  SELECT job_id, library_id, status, progress, attempt_count, error_code, error_detail,
         owner_plugin_id, owner_package_hash, plugin_handler_id, payload_json,
         recovery_strategy, created_at, updated_at
    FROM jobs`;

function readPluginJob(connection: SqlConnection, jobId: string): PluginJobRecord | null {
  const row = connection.prepare(`${SELECT_PLUGIN_JOB} WHERE job_id = ? AND kind = ?`).get(
    jobId,
    PLUGIN_BACKGROUND_JOB_KIND,
  ) as JobRow | undefined;
  return row === undefined ? null : mapRow(row);
}

function stateFromRecord(job: PluginJobRecord): PersistedPluginJobState {
  return {
    ...(job.ownerPluginInstanceId === undefined ? {} : { ownerPluginInstanceId: job.ownerPluginInstanceId }),
    ...(job.ownerScope === undefined ? {} : { ownerScope: job.ownerScope }),
    ...(job.ownerLibraryId === undefined ? {} : { ownerLibraryId: job.ownerLibraryId }),
    ...(job.executionAvailability === undefined ? {} : { executionAvailability: job.executionAvailability }),
    ...(job.completed === undefined ? {} : { completed: job.completed }),
    ...(job.total === undefined ? {} : { total: job.total }),
    ...(job.phase === undefined ? {} : { phase: job.phase }),
    ...(job.message === undefined ? {} : { message: job.message }),
    ...(job.itemResults === undefined ? {} : { itemResults: job.itemResults }),
    ...(job.failedAssetIds === undefined ? {} : { failedAssetIds: job.failedAssetIds }),
    ...(job.retryInput === undefined ? {} : { retryInput: job.retryInput }),
    ...(job.checkpoint === undefined ? {} : { checkpoint: job.checkpoint }),
    ...(job.cancellation === undefined ? {} : { cancellation: job.cancellation }),
  };
}

function resetPluginJobExecutionState(state: PersistedPluginJobState): PersistedPluginJobState {
  return {
    // Runtime instance IDs are process-local. Clearing the old value marks an
    // retried job as eligible for one-time rebinding to the instance that
    // claims it after the host restarts.
    ...(state.ownerScope === undefined ? {} : { ownerScope: state.ownerScope }),
    ...(state.ownerLibraryId === undefined ? {} : { ownerLibraryId: state.ownerLibraryId }),
    executionAvailability: 'ready',
    completed: 0,
    phase: 'queued',
    message: '',
    ...(state.retryInput === undefined ? {} : { retryInput: state.retryInput }),
    cancellation: { requested: false },
  };
}

function pluginJobExecutionMatches(
  job: Pick<PluginJobRecord, 'ownerPluginId' | 'ownerPackageHash' | 'ownerScope' | 'ownerLibraryId' | 'libraryId'>,
  owner: Pick<PluginJobOwnerFields, 'pluginId' | 'packageHash' | 'scope' | 'libraryId'>,
): boolean {
  return job.ownerPluginId === owner.pluginId
    && job.ownerPackageHash === owner.packageHash
    && job.ownerScope === owner.scope
    && job.ownerLibraryId === owner.libraryId
    && job.libraryId === owner.libraryId;
}

export function enqueuePluginJobRecord(
  connection: SqlConnection,
  input: {
    libraryId: string;
    ownerPluginId: string;
    ownerPackageHash: string;
    ownerPluginInstanceId?: string;
    ownerScope?: 'library' | 'global';
    ownerLibraryId?: string | null;
    applicationSessionId?: string;
    pluginHandlerId: string;
    payload?: Record<string, unknown>;
    recoveryStrategy: PluginJobRecoveryStrategy;
    priority?: number;
  },
): PluginJobRecord {
  const now = new Date().toISOString();
  const jobId = randomUUID();
  const state: PersistedPluginJobState = {
    ...(input.applicationSessionId === undefined ? {} : { applicationSessionId: input.applicationSessionId }),
    ownerPluginInstanceId: input.ownerPluginInstanceId ?? input.ownerPluginId,
    ownerScope: input.ownerScope ?? 'library',
    ownerLibraryId: input.ownerLibraryId === undefined ? input.libraryId : input.ownerLibraryId,
    executionAvailability: 'ready',
    completed: 0,
    total: 0,
    phase: 'queued',
    message: '',
  };
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
    serializeStoredJobPayload(input.payload ?? {}, state),
    input.recoveryStrategy,
  );
  const row = connection.prepare(`${SELECT_PLUGIN_JOB} WHERE job_id = ?`).get(jobId) as JobRow;
  return mapRow(row);
}

export function listPluginJobRecords(
  connection: SqlConnection,
  libraryId: string,
): PluginJobRecord[] {
  const rows = connection.prepare(
    `${SELECT_PLUGIN_JOB}
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
    ownerPluginInstanceId?: string;
    ownerScope?: 'library' | 'global';
    ownerLibraryId?: string;
  },
): PluginJobRecord | null {
  const now = new Date().toISOString();
  const candidates = connection.prepare(
    `${SELECT_PLUGIN_JOB}
      WHERE library_id = ?
        AND kind = ?
        AND status = 'queued'
        AND owner_plugin_id = ?
        AND owner_package_hash = ?
      ORDER BY priority DESC, created_at ASC, job_id ASC
      LIMIT 500`,
  ).all(
    input.libraryId,
    PLUGIN_BACKGROUND_JOB_KIND,
    input.ownerPluginId,
    input.ownerPackageHash,
  ) as JobRow[];
  const candidate = candidates
    .map(mapRow)
    .find((job) => input.ownerPluginInstanceId === undefined
      || (job.ownerPluginInstanceId === input.ownerPluginInstanceId
        && job.ownerScope === input.ownerScope
        && job.ownerLibraryId === input.ownerLibraryId
        && job.libraryId === input.libraryId)
      || (job.ownerPluginInstanceId === undefined
        && job.recoveryStrategy === 'idempotent'
        && input.ownerScope !== undefined
        && pluginJobExecutionMatches(job, {
          pluginId: input.ownerPluginId,
          packageHash: input.ownerPackageHash,
          scope: input.ownerScope,
          libraryId: input.ownerLibraryId ?? input.libraryId,
        })));
  if (candidate === undefined) return null;

  const updated = connection.prepare(
    `UPDATE jobs
        SET status = 'running',
            attempt_count = attempt_count + 1,
            updated_at = ?,
            error_code = NULL,
            error_detail = NULL
      WHERE job_id = ? AND status = 'queued'
        AND owner_plugin_id = ? AND owner_package_hash = ?`,
  ).run(now, candidate.jobId, input.ownerPluginId, input.ownerPackageHash);
  if (updated.changes !== 1) return null;

  const row = connection.prepare(`${SELECT_PLUGIN_JOB} WHERE job_id = ?`).get(candidate.jobId) as JobRow | undefined;
  if (row === undefined) return null;
  const stored = parseStoredJobPayload(row.payload_json);
  connection.prepare(`UPDATE jobs SET payload_json = ? WHERE job_id = ?`).run(
    serializeStoredJobPayload(stored.payload, {
      ...stored.state,
      ...(input.ownerPluginInstanceId === undefined ? {} : { ownerPluginInstanceId: input.ownerPluginInstanceId }),
      ...(input.ownerScope === undefined ? {} : { ownerScope: input.ownerScope }),
      ...(input.ownerLibraryId === undefined ? {} : { ownerLibraryId: input.ownerLibraryId }),
      phase: 'running',
    }),
    candidate.jobId,
  );
  return readPluginJob(connection, candidate.jobId);
}

export function completePluginJobRecord(
  connection: SqlConnection,
  input: {
    jobId: string;
    owner: PluginJobOwnerFields;
    status: 'succeeded' | 'failed' | 'cancelled';
    errorCode?: string;
    errorDetail?: string;
    progress?: number;
    completed?: number;
    total?: number;
    phase?: string;
    message?: string;
    itemResults?: PluginJobItemResult[];
    failedAssetIds?: string[];
    retryInput?: Record<string, unknown>;
    checkpoint?: PluginJobCheckpoint;
  },
): PluginJobRecord | null {
  const current = readPluginJob(connection, input.jobId);
  if (current === null || current.status !== 'running' || !pluginJobOwnerMatches(current, input.owner)) return null;
  const currentProgress = {
    completed: current.completed ?? 0,
    total: current.total ?? 0,
    phase: current.phase ?? '',
    message: current.message ?? '',
    progress: current.progress,
  };
  const progress = input.completed === undefined || input.total === undefined
    ? {
      ...currentProgress,
      progress: input.progress ?? (input.status === 'succeeded' ? 1 : current.progress),
      phase: input.phase ?? currentProgress.phase,
      message: input.message ?? currentProgress.message,
    }
    : applyPluginJobProgress(currentProgress, {
      completed: input.completed,
      total: input.total,
      phase: input.phase ?? currentProgress.phase,
      message: input.message ?? currentProgress.message,
      progress: input.progress,
    });
  const stored = { state: stateFromRecord(current) };
  const state: PersistedPluginJobState = {
    ...stored.state,
    completed: progress.completed,
    total: progress.total,
    phase: progress.phase,
    message: progress.message,
    ...(input.itemResults === undefined ? {} : { itemResults: input.itemResults }),
    ...(input.failedAssetIds === undefined ? {} : { failedAssetIds: input.failedAssetIds }),
    ...(input.retryInput === undefined ? {} : { retryInput: input.retryInput }),
    ...(input.checkpoint === undefined ? {} : { checkpoint: input.checkpoint }),
  };
  const now = new Date().toISOString();
  const updated = connection.prepare(
    `UPDATE jobs
        SET status = ?,
            progress = ?,
            error_code = ?,
            error_detail = ?,
            updated_at = ?,
            payload_json = ?
      WHERE job_id = ? AND kind = ? AND status = 'running'
        AND owner_plugin_id = ? AND owner_package_hash = ?`,
  ).run(
    input.status,
    progress.progress,
    input.errorCode ?? null,
    input.errorDetail ?? null,
    now,
    serializeStoredJobPayload(current.payload, state),
    input.jobId,
    PLUGIN_BACKGROUND_JOB_KIND,
    input.owner.pluginId,
    input.owner.packageHash,
  );
  if (updated.changes !== 1) return null;
  return readPluginJob(connection, input.jobId);
}

export function reportPluginJobProgress(
  connection: SqlConnection,
  input: {
    jobId: string;
    ownerPluginId: string;
    ownerPackageHash: string;
    ownerPluginInstanceId: string;
    ownerScope: 'library' | 'global';
    ownerLibraryId: string;
    progress: PluginJobProgressInput;
  },
): PluginJobRecord | null {
  const current = readPluginJob(connection, input.jobId);
  if (
    current === null
    || current.status !== 'running'
    || current.ownerPluginId !== input.ownerPluginId
    || current.ownerPackageHash !== input.ownerPackageHash
    || current.ownerPluginInstanceId !== input.ownerPluginInstanceId
    || current.ownerScope !== input.ownerScope
    || current.ownerLibraryId !== input.ownerLibraryId
    || current.libraryId !== input.ownerLibraryId
  ) return null;
  const next = applyPluginJobProgress({
    completed: current.completed ?? 0,
    total: current.total ?? 0,
    phase: current.phase ?? '',
    message: current.message ?? '',
    progress: current.progress,
  }, input.progress);
  const stored = { state: stateFromRecord(current) };
  const now = new Date().toISOString();
  const updated = connection.prepare(
    `UPDATE jobs SET progress = ?, payload_json = ?, updated_at = ?
      WHERE job_id = ? AND kind = ? AND status = 'running'
        AND owner_plugin_id = ? AND owner_package_hash = ?`,
  ).run(
    next.progress,
    serializeStoredJobPayload(current.payload, {
      ...stored.state,
      completed: next.completed,
      total: next.total,
      phase: next.phase,
      message: next.message,
    }),
    now,
    input.jobId,
    PLUGIN_BACKGROUND_JOB_KIND,
    input.ownerPluginId,
    input.ownerPackageHash,
  );
  return updated.changes === 1 ? readPluginJob(connection, input.jobId) : null;
}

export function cancelPluginJobRecord(
  connection: SqlConnection,
  input: { jobId: string; owner: PluginJobOwnerFields; reason?: string },
): PluginJobRecord | null {
  const current = readPluginJob(connection, input.jobId);
  if (current === null || !pluginJobOwnerMatches(current, input.owner)
    || ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(current.status)) return null;
  const now = new Date().toISOString();
  const updated = connection.prepare(
    `UPDATE jobs SET status = 'cancelled', error_code = 'PLUGIN_JOB_CANCELLED',
       error_detail = ?, updated_at = ?
       WHERE job_id = ? AND kind = ? AND status IN ('queued', 'running', 'paused')
         AND owner_plugin_id = ? AND owner_package_hash = ?`,
  ).run(input.reason ?? 'The plugin job was cancelled.', now, input.jobId, PLUGIN_BACKGROUND_JOB_KIND,
    input.owner.pluginId, input.owner.packageHash);
  if (updated.changes !== 1) return null;
  connection.prepare(`UPDATE jobs SET payload_json = ? WHERE job_id = ?`).run(
    serializeStoredJobPayload(current.payload, {
      ...stateFromRecord(current),
      cancellation: { requested: true, ...(input.reason === undefined ? {} : { reason: input.reason }) },
    }),
    input.jobId,
  );
  return readPluginJob(connection, input.jobId);
}

export function pausePluginJobRecord(
  connection: SqlConnection,
  input: { jobId: string; owner: PluginJobOwnerFields; capabilities: PluginJobHandlerCapabilities; checkpoint: PluginJobCheckpoint },
): PluginJobRecord | null {
  const current = readPluginJob(connection, input.jobId);
  if (current === null || !pluginJobOwnerMatches(current, input.owner)
    || !['queued', 'running'].includes(current.status)) return null;
  assertPluginJobControlAllowed('pause', input.capabilities, input.checkpoint);
  const now = new Date().toISOString();
  const updated = connection.prepare(
    `UPDATE jobs SET status = 'paused', updated_at = ?
       WHERE job_id = ? AND kind = ? AND status IN ('queued', 'running')
         AND owner_plugin_id = ? AND owner_package_hash = ?`,
  ).run(now, input.jobId, PLUGIN_BACKGROUND_JOB_KIND, input.owner.pluginId, input.owner.packageHash);
  if (updated.changes !== 1) return null;
  connection.prepare(`UPDATE jobs SET payload_json = ? WHERE job_id = ?`).run(
    serializeStoredJobPayload(current.payload, {
      ...stateFromRecord(current),
      checkpoint: input.checkpoint,
      executionAvailability: 'ready',
    }),
    input.jobId,
  );
  return readPluginJob(connection, input.jobId);
}

export function resumePluginJobRecord(
  connection: SqlConnection,
  input: { jobId: string; owner: PluginJobOwnerFields; capabilities: PluginJobHandlerCapabilities },
): PluginJobRecord | null {
  const current = readPluginJob(connection, input.jobId);
  if (current === null || !pluginJobOwnerMatches(current, input.owner) || current.status !== 'paused') return null;
  assertPluginJobControlAllowed('resume', input.capabilities, current.checkpoint);
  const now = new Date().toISOString();
  const updated = connection.prepare(
    `UPDATE jobs SET status = 'queued', error_code = NULL, error_detail = NULL, updated_at = ?
       WHERE job_id = ? AND kind = ? AND status = 'paused'
         AND owner_plugin_id = ? AND owner_package_hash = ?`,
  ).run(now, input.jobId, PLUGIN_BACKGROUND_JOB_KIND, input.owner.pluginId, input.owner.packageHash);
  if (updated.changes !== 1) return null;
  connection.prepare(`UPDATE jobs SET payload_json = ? WHERE job_id = ?`).run(
    serializeStoredJobPayload(current.payload, {
      ...stateFromRecord(current),
      executionAvailability: 'ready',
      cancellation: { requested: false },
    }),
    input.jobId,
  );
  return readPluginJob(connection, input.jobId);
}

export function retryPluginJobRecord(
  connection: SqlConnection,
  input: {
    jobId: string;
    owner: PluginJobOwnerFields;
    retryInput?: Record<string, unknown>;
    applicationSessionId?: string;
  },
): PluginJobRecord | null {
  const current = readPluginJob(connection, input.jobId);
  if (current === null || !pluginJobOwnerCanRetry(current, input.owner)
    || !['failed', 'cancelled', 'paused', 'interrupted'].includes(current.status)) return null;
  const currentRow = connection.prepare(`${SELECT_PLUGIN_JOB} WHERE job_id = ? AND kind = ?`).get(
    input.jobId,
    PLUGIN_BACKGROUND_JOB_KIND,
  ) as JobRow | undefined;
  if (currentRow === undefined) return null;
  const currentState = parseStoredJobPayload(currentRow.payload_json).state;
  const now = new Date().toISOString();
  const updated = connection.prepare(
    `UPDATE jobs SET status = 'queued', progress = 0, error_code = NULL, error_detail = NULL, updated_at = ?
       WHERE job_id = ? AND kind = ? AND status IN ('failed', 'cancelled', 'paused', 'interrupted')
         AND owner_plugin_id = ? AND owner_package_hash = ?`,
  ).run(now, input.jobId, PLUGIN_BACKGROUND_JOB_KIND, input.owner.pluginId, input.owner.packageHash);
  if (updated.changes !== 1) return null;
  const retryState = current.status === 'interrupted'
    ? {
      ...resetPluginJobExecutionState(currentState),
      ...(input.applicationSessionId === undefined ? {} : { applicationSessionId: input.applicationSessionId }),
    }
    : currentState;
  connection.prepare(`UPDATE jobs SET payload_json = ? WHERE job_id = ?`).run(
    serializeStoredJobPayload(current.payload, {
      ...retryState,
      executionAvailability: 'ready',
      completed: 0,
      phase: 'queued',
      message: '',
      ...(input.retryInput === undefined ? {} : { retryInput: input.retryInput }),
      cancellation: { requested: false },
    }),
    input.jobId,
  );
  return readPluginJob(connection, input.jobId);
}

export function blockPluginJobRecord(
  connection: SqlConnection,
  input: { jobId: string; errorCode: string; errorDetail: string },
): PluginJobRecord | null {
  const current = readPluginJob(connection, input.jobId);
  if (current === null || ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(current.status)) return null;
  const now = new Date().toISOString();
  const updated = connection.prepare(
    `UPDATE jobs SET status = 'paused', error_code = ?, error_detail = ?, updated_at = ?
       WHERE job_id = ? AND kind = ? AND status IN ('queued', 'running', 'paused')`,
  ).run(input.errorCode, input.errorDetail, now, input.jobId, PLUGIN_BACKGROUND_JOB_KIND);
  if (updated.changes !== 1) return null;
  connection.prepare(`UPDATE jobs SET payload_json = ? WHERE job_id = ?`).run(
    serializeStoredJobPayload(current.payload, { ...stateFromRecord(current), executionAvailability: 'blocked' }),
    input.jobId,
  );
  return readPluginJob(connection, input.jobId);
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

/**
 * Mark plugin work left by a previous host session as terminally interrupted.
 *
 * This deliberately does not requeue idempotent jobs. A new application
 * session must never execute work that the user did not explicitly start in
 * that session; retry is an opt-in action handled by retryPluginJobRecord.
 */
export function interruptUnfinishedPluginJobs(
  connection: SqlConnection,
  libraryId: string,
  applicationSessionId?: string,
): number {
  const unfinished = connection.prepare(
    `${SELECT_PLUGIN_JOB}
      WHERE library_id = ?
        AND kind = ?
        AND (
          status IN ('queued', 'running')
          OR (
            status = 'paused'
            AND error_code = 'PLUGIN_INSTANCE_INACTIVE'
          )
        )`,
  ).all(libraryId, PLUGIN_BACKGROUND_JOB_KIND) as JobRow[];
  if (unfinished.length === 0) return 0;

  const now = new Date().toISOString();
  const update = connection.prepare(
    `UPDATE jobs
        SET status = 'interrupted',
            error_code = 'PLUGIN_JOB_INTERRUPTED',
            error_detail = ?,
            updated_at = ?,
            payload_json = ?
      WHERE job_id = ?
        AND library_id = ?
        AND kind = ?
        AND status = ?`,
  );
  let marked = 0;
  for (const row of unfinished) {
    const stored = parseStoredJobPayload(row.payload_json);
    if (applicationSessionId !== undefined && stored.state.applicationSessionId === applicationSessionId) continue;
    const result = update.run(
      'The plugin job was interrupted when the previous application session ended. Retry it explicitly to run it again.',
      now,
      serializeStoredJobPayload(stored.payload, {
        ...stored.state,
        executionAvailability: 'blocked',
      }),
      row.job_id,
      libraryId,
      PLUGIN_BACKGROUND_JOB_KIND,
      row.status,
    );
    marked += result.changes;
  }

  return marked;
}
