/**
 * Toast notification state machine for the workspace notice stack, plus a
 * blocking fatal channel (Serpent-99lv).
 *
 * Severities: info(notice) < warning < error < fatal.
 * - Toast channels (`notice` / `warning` / `error`) retain each message until
 *   it expires or is dismissed. The renderer presents the retained entries as
 *   a vertical stack, so a new notice cannot cover an older one.
 * - Fatal is a blocking modal (not a dismissable toast). Lower toast setters
 *   never clear or hide an active fatal; only `setFatal(null)` dismisses it.
 *
 * Notices auto-dismiss after 5s, warnings/errors after 10s. Dismissal (timer or
 * manual close) is a two-step lifecycle: the toast enters `closing`, which
 * plays the CSS exit transition, and unmounts only when the transition ends
 * (`finishExit`, driven by onTransitionEnd) or a fallback timer fires —
 * whichever comes first (REQ-SHELL-010).
 *
 * Pure controller with no React dependency; the renderer binds it through
 * `useToastNotifications`.
 */

export type ToastKind = "notice" | "warning" | "error";

/** Full severity ladder including the blocking fatal modal channel. */
export type ToastSeverity = "info" | "warning" | "error" | "fatal";

export const TOAST_SEVERITY_RANK: Record<ToastSeverity, number> = {
  info: 1,
  warning: 2,
  error: 3,
  fatal: 4,
};

export interface ToastMessage {
  kind: ToastKind;
  text: string;
  /**
   * The reversible operation that produced this notice, when there is one.
   * Keeping the id on the notice makes the inline Undo action race-safe: it
   * must never guess from a possibly stale history snapshot.
   */
  historyEntryId?: string;
}

export interface ToastStackMessage extends ToastMessage {
  id: number;
  closing: boolean;
}

export interface ToastSnapshot {
  error: string | null;
  warning: string | null;
  notice: string | null;
  /** Blocking modal body; null when no fatal alert is open. */
  fatal: string | null;
  /** Highest-severity non-closing message, kept for legacy controller callers. */
  rendered: ToastMessage | null;
  /** All notice entries, including entries currently fading out. */
  renderedStack: readonly ToastStackMessage[];
  closing: boolean;
  closingIds: readonly number[];
}

export const TOAST_NOTICE_DURATION_MS = 5_000;
export const TOAST_WARNING_DURATION_MS = 10_000;
export const TOAST_ERROR_DURATION_MS = 10_000;
export const TOAST_EXIT_DURATION_MS = 180;
const EXIT_FALLBACK_MARGIN_MS = 50;

type TimerId = ReturnType<typeof setTimeout>;

export interface ToastNotifications {
  getSnapshot(): ToastSnapshot;
  subscribe(listener: () => void): () => void;
  setError(text: string | null): void;
  setWarning(text: string | null): void;
  setNotice(text: string | null, historyEntryId?: string): void;
  setFatal(text: string | null): void;
  /** Start closing the highest-severity visible toast. */
  dismissVisible(): void;
  /** Start closing one stack entry without affecting its siblings. */
  dismissToast(id: number): void;
  finishExit(id?: number): void;
  dispose(): void;
}

export function createToastNotifications(): ToastNotifications {
  let fatal: string | null = null;
  let entries: ToastStackMessage[] = [];
  let nextId = 1;
  let snapshot: ToastSnapshot = {
    error: null,
    warning: null,
    notice: null,
    fatal,
    rendered: null,
    renderedStack: entries,
    closing: false,
    closingIds: [],
  };
  const listeners = new Set<() => void>();
  const dismissTimers = new Map<number, TimerId>();
  const exitTimers = new Map<number, TimerId>();

  function highestMessage(
    candidates: readonly ToastStackMessage[],
  ): ToastStackMessage | null {
    let result: ToastStackMessage | null = null;
    for (const candidate of candidates) {
      if (
        result === null ||
        TOAST_SEVERITY_RANK[
          candidate.kind === "notice" ? "info" : candidate.kind
        ] >
          TOAST_SEVERITY_RANK[
            result.kind === "notice" ? "info" : result.kind
          ]
      ) {
        result = candidate;
      }
    }
    return result;
  }

  function channelText(kind: ToastKind): string | null {
    return entries.find((entry) => entry.kind === kind && !entry.closing)?.text ?? null;
  }

  function legacyRenderedMessage(): ToastMessage | null {
    const visible = entries.filter((entry) => !entry.closing);
    const candidate = highestMessage(visible.length > 0 ? visible : entries);
    return candidate
      ? {
          kind: candidate.kind,
          text: candidate.text,
          ...(candidate.historyEntryId
            ? { historyEntryId: candidate.historyEntryId }
            : {}),
        }
      : null;
  }

  function commit(): void {
    const closingIds = entries
      .filter((entry) => entry.closing)
      .map((entry) => entry.id);
    const next: ToastSnapshot = {
      error: channelText("error"),
      warning: channelText("warning"),
      notice: channelText("notice"),
      fatal,
      rendered: legacyRenderedMessage(),
      renderedStack: entries,
      closing: closingIds.length > 0,
      closingIds,
    };
    if (
      next.error === snapshot.error &&
      next.warning === snapshot.warning &&
      next.notice === snapshot.notice &&
      next.fatal === snapshot.fatal &&
      next.rendered?.kind === snapshot.rendered?.kind &&
      next.rendered?.text === snapshot.rendered?.text &&
      next.renderedStack === snapshot.renderedStack &&
      next.closing === snapshot.closing &&
      next.closingIds.length === snapshot.closingIds.length &&
      next.closingIds.every((id, index) => id === snapshot.closingIds[index])
    ) {
      return;
    }
    snapshot = next;
    for (const listener of listeners) listener();
  }

  function clearTimer(timerMap: Map<number, TimerId>, id: number): void {
    const timer = timerMap.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timerMap.delete(id);
    }
  }

  function startClosing(id: number): void {
    const entry = entries.find((candidate) => candidate.id === id);
    if (!entry || entry.closing) return;
    clearTimer(dismissTimers, id);
    entries = entries.map((candidate) =>
      candidate.id === id ? { ...candidate, closing: true } : candidate,
    );
    exitTimers.set(
      id,
      setTimeout(() => finishExit(id), TOAST_EXIT_DURATION_MS + EXIT_FALLBACK_MARGIN_MS),
    );
    commit();
  }

  function startClosingKind(kind: ToastKind): void {
    for (const entry of entries) {
      if (entry.kind === kind) startClosing(entry.id);
    }
  }

  function setToast(
    kind: ToastKind,
    text: string | null,
    historyEntryId?: string,
  ): void {
    if (text === null) {
      // Preserve the existing channel-reset contract: null closes every
      // pending entry of this severity, while dismissToast(id) closes one.
      startClosingKind(kind);
      commit();
      return;
    }
    const id = nextId++;
    const duration =
      kind === "notice"
        ? TOAST_NOTICE_DURATION_MS
        : kind === "warning"
          ? TOAST_WARNING_DURATION_MS
          : TOAST_ERROR_DURATION_MS;
    entries = [
      {
        id,
        kind,
        text,
        closing: false,
        ...(historyEntryId ? { historyEntryId } : {}),
      },
      ...entries,
    ];
    dismissTimers.set(id, setTimeout(() => startClosing(id), duration));
    commit();
  }

  const setError = (text: string | null) => setToast("error", text);
  const setWarning = (text: string | null) => setToast("warning", text);
  const setNotice = (text: string | null, historyEntryId?: string) =>
    setToast("notice", text, historyEntryId);

  function setFatal(text: string | null): void {
    // Fatal never auto-dismisses; lower toast channels cannot clear it.
    fatal = text;
    commit();
  }

  function dismissVisible(): void {
    const visible = entries.filter((entry) => !entry.closing);
    const candidate = highestMessage(visible);
    if (candidate) startClosing(candidate.id);
  }

  function dismissToast(id: number): void {
    startClosing(id);
  }

  function finishExit(id?: number): void {
    const ids = id === undefined
      ? entries.filter((entry) => entry.closing).map((entry) => entry.id)
      : [id];
    if (ids.length === 0) return;
    for (const entryId of ids) {
      clearTimer(dismissTimers, entryId);
      clearTimer(exitTimers, entryId);
    }
    entries = entries.filter((entry) => !ids.includes(entry.id));
    commit();
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setError,
    setWarning,
    setNotice,
    setFatal,
    dismissVisible,
    dismissToast,
    finishExit,
    dispose() {
      for (const id of dismissTimers.keys()) clearTimer(dismissTimers, id);
      for (const id of exitTimers.keys()) clearTimer(exitTimers, id);
      listeners.clear();
    },
  };
}
