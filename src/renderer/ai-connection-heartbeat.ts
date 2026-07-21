/**
 * AI connection heartbeat (Serpent-rsbt).
 *
 * Reuses the existing `testAiConnection` / probe path on a ~60s cadence and
 * keeps one global connection state for the config title indicator and the
 * asset context-menu disconnect glyph.
 */

export const AI_CONNECTION_HEARTBEAT_MS = 60_000;

export type AiHeartbeatConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

/** Whether the context-menu AI analyze affordance should show link-off. */
export function aiAnalyzeShowsDisconnectGlyph(
  hasKey: boolean,
  connectionState: AiHeartbeatConnectionState,
): boolean {
  if (!hasKey) return true;
  return (
    connectionState === "disconnected" ||
    connectionState === "error" ||
    connectionState === "idle"
  );
}

/** Analyze is runnable only when a stored key exists and the last probe succeeded. */
export function aiAnalyzeConnectionReady(
  hasKey: boolean,
  connectionState: AiHeartbeatConnectionState,
): boolean {
  return hasKey && connectionState === "connected";
}

/**
 * Heartbeat should run whenever a stored key exists. Dialog draft edits do not
 * stop the stored-config probe; manual dialog tests still write the same state.
 */
export function shouldRunAiConnectionHeartbeat(hasKey: boolean): boolean {
  return hasKey;
}
