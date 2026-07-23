import { useCallback, useEffect, useReducer, useRef } from "react";

import type { SerpentLibraryApi } from "../shared/library-api";
import type { AiJob } from "../shared/protocol/responses";
import {
  INITIAL_CONNECTION_FAILURE_GATE,
  listConnectionFailedJobIds,
  listFailedJobIds,
  reduceConnectionFailureGate,
  type ConnectionFailureGateState,
} from "./ai-connection-failure";

export interface UseAiConnectionFailureParams {
  api: SerpentLibraryApi | null;
  libraryId: string | null | undefined;
  /** Latest AI job counters (progress events); used to detect failed growth. */
  failedCount: number;
  queuedCount: number;
  runningCount: number;
  /** True while a user-started analyze batch is in flight. */
  aiAnalyzing: boolean;
  /**
   * Retry failed AI jobs (jobIds) or cancel remaining when jobIds omitted.
   * Matches App `controlAiJobs`.
   */
  controlAiJobs: (
    action: "cancel" | "retry",
    jobIds?: string[],
  ) => Promise<void>;
}

export interface UseAiConnectionFailureResult {
  gate: ConnectionFailureGateState;
  /** Call when the user enqueues a new analyze batch. */
  notifyBatchStarted: (jobs: ReadonlyArray<AiJob>) => void;
  onRetry: () => Promise<void>;
  onAbort: () => void;
}

/**
 * Surfaces one connection-lost dialog after terminal AI network/auth failures
 * (Serpent-kdnm). Fetches job details when the failed counter grows.
 */
export function useAiConnectionFailure({
  api,
  libraryId,
  failedCount,
  queuedCount,
  runningCount,
  aiAnalyzing,
  controlAiJobs,
}: UseAiConnectionFailureParams): UseAiConnectionFailureResult {
  const [gate, dispatch] = useReducer(
    reduceConnectionFailureGate,
    INITIAL_CONNECTION_FAILURE_GATE,
  );
  const gateRef = useRef(gate);
  gateRef.current = gate;
  const busyRef = useRef(false);

  const notifyBatchStarted = useCallback((jobs: ReadonlyArray<AiJob>) => {
    dispatch({
      type: "batch_started",
      baselineFailedJobIds: listFailedJobIds(jobs),
    });
  }, []);

  const refreshSnapshot = useCallback(async () => {
    if (!api || !libraryId) return;
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const result = await api.getAiJobStatus({ libraryId });
      if (!result.ok) return;
      dispatch({
        type: "jobs_snapshot",
        connectionFailedJobIds: listConnectionFailedJobIds(result.value.jobs),
      });
    } finally {
      busyRef.current = false;
    }
  }, [api, libraryId]);

  useEffect(() => {
    if (!api || !libraryId) return;
    const gateNow = gateRef.current;
    const active =
      gateNow.armed ||
      gateNow.open ||
      aiAnalyzing ||
      queuedCount + runningCount > 0;
    if (!active) return;
    if (
      gateNow.suppressedUntilNextBatch &&
      !gateNow.open &&
      !aiAnalyzing &&
      queuedCount + runningCount === 0
    ) {
      return;
    }
    void refreshSnapshot();
  }, [
    api,
    libraryId,
    failedCount,
    queuedCount,
    runningCount,
    aiAnalyzing,
    refreshSnapshot,
  ]);

  const onRetry = useCallback(async () => {
    const jobIds = gateRef.current.failedJobIds;
    dispatch({ type: "resolved", decision: "retry" });
    if (jobIds.length === 0) return;
    await controlAiJobs("retry", jobIds);
  }, [controlAiJobs]);

  const onAbort = useCallback(() => {
    dispatch({ type: "resolved", decision: "abort" });
    void controlAiJobs("cancel");
  }, [controlAiJobs]);

  return {
    gate,
    notifyBatchStarted,
    onRetry,
    onAbort,
  };
}
