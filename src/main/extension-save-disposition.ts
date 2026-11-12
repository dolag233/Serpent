import type { WorkerResult } from "../shared/protocol/responses";

/** Convert a typed Worker rejection into the HTTP-facing save result. */
export function mapWorkerSaveFailure(
  result: Extract<WorkerResult, { ok: false }>,
): {
  accepted: false;
  status: number;
  reason: string;
  failureKind?: "source-invalid";
} {
  return {
    accepted: false,
    status: result.error.code === "LIBRARY_NOT_OPEN" ? 503 : 422,
    reason: result.error.reason ?? result.error.code,
    ...(result.errorCode === "SEGMENTED_SOURCE_VALIDATION"
      ? { failureKind: "source-invalid" as const }
      : {}),
  };
}
