import type { ImportProgressEvent } from "../shared/protocol/responses";

const TERMINAL_IMPORT_PROGRESS_PHASES = new Set<ImportProgressEvent["phase"]>([
  "complete",
  "cancelled",
  "failed",
]);

export function isTerminalImportProgressPhase(
  phase: ImportProgressEvent["phase"],
): boolean {
  return TERMINAL_IMPORT_PROGRESS_PHASES.has(phase);
}

export function isActiveImportProgress(
  progress: ImportProgressEvent | null,
): progress is ImportProgressEvent {
  return Boolean(progress && !isTerminalImportProgressPhase(progress.phase));
}

export type ImportProgressApplySession = {
  /** False once the renderer import command has returned. */
  readonly rpcInFlight?: boolean;
  readonly current?: ImportProgressEvent | null;
  /**
   * ImportIds whose renderer session already ended. Late events for these ids
   * are dropped, including terminal phases — a late `complete` from import A
   * must not clear import B.
   */
  readonly retiredImportIds?: ReadonlySet<string> | readonly string[];
  /** ImportId owned by the in-flight RPC once the first progress event arrives. */
  readonly activeImportId?: string | null;
};

export type ImportOverlaySession = {
  readonly rpcInFlight?: boolean;
  readonly overlayDismissed?: boolean;
};

const RETIRED_IMPORT_ID_LIMIT = 32;

export function addRetiredImportId(
  retired: Set<string>,
  importId: string | null | undefined,
  limit = RETIRED_IMPORT_ID_LIMIT,
): void {
  if (!importId) return;
  retired.delete(importId);
  retired.add(importId);
  while (retired.size > limit) {
    const oldest = retired.values().next().value;
    if (oldest === undefined) break;
    retired.delete(oldest);
  }
}

function isRetiredImportId(
  importId: string,
  dismissedImportId?: string | null,
  retiredImportIds?: ReadonlySet<string> | readonly string[],
): boolean {
  if (!importId) return false;
  if (dismissedImportId && dismissedImportId === importId) return true;
  if (!retiredImportIds) return false;
  if ("has" in retiredImportIds) return retiredImportIds.has(importId);
  return retiredImportIds.includes(importId);
}

/**
 * Overlay lifetime is the in-flight import RPC. Progress events only update
 * numbers while that RPC is live; they cannot reopen a closed session.
 *
 * Empty `importId` is the library-open synthetic spinner, not an asset import.
 */
export function shouldApplyImportProgressEvent(
  progress: ImportProgressEvent,
  awaitingUserDecision: boolean,
  dismissedImportId?: string | null,
  session: ImportProgressApplySession = {},
): boolean {
  if (isRetiredImportId(progress.importId, dismissedImportId, session.retiredImportIds)) {
    return false;
  }
  if (
    session.activeImportId &&
    progress.importId.length > 0 &&
    progress.importId !== session.activeImportId
  ) {
    return false;
  }
  if (isTerminalImportProgressPhase(progress.phase)) return true;
  if (awaitingUserDecision) return false;
  if (
    session.rpcInFlight === false &&
    progress.importId.length > 0
  ) {
    return false;
  }
  const current = session.current;
  if (
    typeof progress.sequence === "number" &&
    current &&
    current.importId === progress.importId &&
    typeof current.sequence === "number" &&
    progress.sequence <= current.sequence
  ) {
    return false;
  }
  return true;
}

export function isBlockingImportOverlayVisible(
  _uiState: string,
  progress: ImportProgressEvent | null,
  awaitingUserDecision = false,
  session: ImportOverlaySession = {},
): boolean {
  if (awaitingUserDecision || session.overlayDismissed) return false;
  if (!isActiveImportProgress(progress)) return false;
  if (progress.importId.length === 0) return true;
  if (session.rpcInFlight === false) return false;
  return true;
}

export type ImportRpcGate = {
  begin: () => void;
  end: () => void;
};

/**
 * Owns overlay session depth for one renderer import command. Callers must
 * wrap only the Worker RPC, not follow-up browse/reveal work.
 */
export async function runImportRpc<T>(
  gate: ImportRpcGate,
  work: () => Promise<T>,
): Promise<T> {
  gate.begin();
  try {
    return await work();
  } finally {
    gate.end();
  }
}
