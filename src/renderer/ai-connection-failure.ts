/**
 * AI connection-class failure gate (Serpent-kdnm).
 *
 * Worker already requeues network/timeout/rate_limit up to 3 attempts.
 * After jobs become terminal `failed` with connection-class codes, the
 * Renderer shows one Retry/Abort dialog per wave — not per asset.
 *
 * AI_INVALID_RESPONSE is intentionally excluded (model/content failure,
 * not a lost connection).
 */

/** Error codes that mean the provider link is unhealthy. */
export const AI_CONNECTION_FAILURE_CODES = new Set([
  "AI_NETWORK",
  "AI_TIMEOUT",
  "AI_RATE_LIMIT",
  "AI_AUTH",
]);

export function isAiConnectionFailureCode(
  code: string | null | undefined,
): boolean {
  return typeof code === "string" && AI_CONNECTION_FAILURE_CODES.has(code);
}

export interface AiJobFailureRef {
  jobId: string;
  status: string;
  errorCode: string | null;
}

/** Terminal connection failures (status=failed + connection-class code). */
export function listConnectionFailedJobIds(
  jobs: ReadonlyArray<AiJobFailureRef>,
): string[] {
  const ids: string[] = [];
  for (const job of jobs) {
    if (job.status !== "failed") continue;
    if (!isAiConnectionFailureCode(job.errorCode)) continue;
    ids.push(job.jobId);
  }
  return ids;
}

export function listFailedJobIds(
  jobs: ReadonlyArray<Pick<AiJobFailureRef, "jobId" | "status">>,
): string[] {
  return jobs.filter((job) => job.status === "failed").map((job) => job.jobId);
}

export type ConnectionFailureDecision = "retry" | "abort";

export interface ConnectionFailureGateState {
  open: boolean;
  /** True after the user starts an analyze batch; false until then / after Abort. */
  armed: boolean;
  /** After Abort, do not re-open until the next user-started batch. */
  suppressedUntilNextBatch: boolean;
  /** Failed job IDs already present when the batch started (ignored). */
  baselineFailedJobIds: ReadonlySet<string>;
  /** Connection failures already offered in a dialog this wave. */
  promptedJobIds: ReadonlySet<string>;
  /** Job IDs currently offered for Retry. */
  failedJobIds: string[];
}

export const INITIAL_CONNECTION_FAILURE_GATE: ConnectionFailureGateState = {
  open: false,
  armed: false,
  suppressedUntilNextBatch: false,
  baselineFailedJobIds: new Set(),
  promptedJobIds: new Set(),
  failedJobIds: [],
};

export type ConnectionFailureGateEvent =
  | {
      type: "batch_started";
      baselineFailedJobIds: readonly string[];
    }
  | {
      type: "jobs_snapshot";
      /** All current terminal connection-failed job IDs. */
      connectionFailedJobIds: readonly string[];
    }
  | {
      type: "resolved";
      decision: ConnectionFailureDecision;
    };

function newSet(ids: Iterable<string>): Set<string> {
  return new Set(ids);
}

/**
 * Pure gate reducer: open at most once per failure wave until Retry/Abort.
 * Retry clears the prompt set so a later wave can open again; Abort
 * suppresses until the next `batch_started`.
 */
export function reduceConnectionFailureGate(
  state: ConnectionFailureGateState,
  event: ConnectionFailureGateEvent,
): ConnectionFailureGateState {
  switch (event.type) {
    case "batch_started":
      return {
        open: false,
        armed: true,
        suppressedUntilNextBatch: false,
        baselineFailedJobIds: newSet(event.baselineFailedJobIds),
        promptedJobIds: new Set(),
        failedJobIds: [],
      };
    case "jobs_snapshot": {
      if (!state.armed && !state.open) return state;
      const fresh = event.connectionFailedJobIds.filter(
        (id) =>
          !state.baselineFailedJobIds.has(id) &&
          !state.promptedJobIds.has(id),
      );
      const offered = event.connectionFailedJobIds.filter(
        (id) => !state.baselineFailedJobIds.has(id),
      );
      if (state.open) {
        if (
          offered.length === state.failedJobIds.length &&
          offered.every((id, index) => id === state.failedJobIds[index])
        ) {
          return state;
        }
        return { ...state, failedJobIds: offered };
      }
      if (state.suppressedUntilNextBatch || fresh.length === 0) {
        return state;
      }
      return {
        ...state,
        open: true,
        failedJobIds: offered,
        promptedJobIds: newSet([...state.promptedJobIds, ...fresh]),
      };
    }
    case "resolved":
      if (event.decision === "abort") {
        return {
          ...state,
          open: false,
          armed: false,
          suppressedUntilNextBatch: true,
          failedJobIds: [],
        };
      }
      return {
        ...state,
        open: false,
        promptedJobIds: new Set(),
        failedJobIds: [],
      };
  }
}
