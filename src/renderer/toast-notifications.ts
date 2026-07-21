/**
 * Toast notification state machine for the bottom-right shell toast, plus a
 * blocking fatal channel (Serpent-99lv).
 *
 * Severities: info(notice) < warning < error < fatal.
 * - Toast channels (`notice` / `warning` / `error`): `activeMessage` always
 *   picks the highest non-empty channel, so lower severity cannot cover higher.
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
}

export interface ToastSnapshot {
  error: string | null;
  warning: string | null;
  notice: string | null;
  /** Blocking modal body; null when no fatal alert is open. */
  fatal: string | null;
  rendered: ToastMessage | null;
  closing: boolean;
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
  setNotice(text: string | null): void;
  setFatal(text: string | null): void;
  /** Clear only the currently visible toast channel (not fatal). */
  dismissVisible(): void;
  finishExit(): void;
  dispose(): void;
}

export function createToastNotifications(): ToastNotifications {
  let error: string | null = null;
  let warning: string | null = null;
  let notice: string | null = null;
  let fatal: string | null = null;
  let rendered: ToastMessage | null = null;
  let closing = false;
  let snapshot: ToastSnapshot = {
    error,
    warning,
    notice,
    fatal,
    rendered,
    closing,
  };
  const listeners = new Set<() => void>();
  let errorTimer: TimerId | null = null;
  let warningTimer: TimerId | null = null;
  let noticeTimer: TimerId | null = null;
  let exitTimer: TimerId | null = null;

  function commit(): void {
    const next: ToastSnapshot = {
      error,
      warning,
      notice,
      fatal,
      rendered,
      closing,
    };
    if (
      next.error === snapshot.error &&
      next.warning === snapshot.warning &&
      next.notice === snapshot.notice &&
      next.fatal === snapshot.fatal &&
      next.rendered === snapshot.rendered &&
      next.closing === snapshot.closing
    ) {
      return;
    }
    snapshot = next;
    for (const listener of listeners) listener();
  }

  function clearExitTimer(): void {
    if (exitTimer !== null) {
      clearTimeout(exitTimer);
      exitTimer = null;
    }
  }

  function activeMessage(): ToastMessage | null {
    if (error) return { kind: "error", text: error };
    if (warning) return { kind: "warning", text: warning };
    if (notice) return { kind: "notice", text: notice };
    return null;
  }

  function reconcile(): void {
    const active = activeMessage();
    if (active) {
      clearExitTimer();
      if (
        !rendered ||
        rendered.kind !== active.kind ||
        rendered.text !== active.text
      ) {
        rendered = active;
      }
      closing = false;
      return;
    }
    if (rendered && !closing) {
      closing = true;
      exitTimer = setTimeout(
        finishExit,
        TOAST_EXIT_DURATION_MS + EXIT_FALLBACK_MARGIN_MS,
      );
    }
  }

  function setError(text: string | null): void {
    if (errorTimer !== null) {
      clearTimeout(errorTimer);
      errorTimer = null;
    }
    error = text;
    if (text) {
      errorTimer = setTimeout(() => setError(null), TOAST_ERROR_DURATION_MS);
    }
    reconcile();
    commit();
  }

  function setWarning(text: string | null): void {
    if (warningTimer !== null) {
      clearTimeout(warningTimer);
      warningTimer = null;
    }
    warning = text;
    if (text) {
      warningTimer = setTimeout(
        () => setWarning(null),
        TOAST_WARNING_DURATION_MS,
      );
    }
    reconcile();
    commit();
  }

  function setNotice(text: string | null): void {
    if (noticeTimer !== null) {
      clearTimeout(noticeTimer);
      noticeTimer = null;
    }
    // Serpent-99lv: while warning/error is visible, still store the notice for
    // later resurfacing, but do not let a fresh info toast reset higher severity.
    notice = text;
    if (text) {
      noticeTimer = setTimeout(() => setNotice(null), TOAST_NOTICE_DURATION_MS);
    }
    reconcile();
    commit();
  }

  function setFatal(text: string | null): void {
    // Fatal never auto-dismisses; lower toast channels cannot clear it.
    fatal = text;
    commit();
  }

  function dismissVisible(): void {
    if (error) {
      setError(null);
      return;
    }
    if (warning) {
      setWarning(null);
      return;
    }
    if (notice) {
      setNotice(null);
    }
  }

  function finishExit(): void {
    if (!closing) return;
    clearExitTimer();
    rendered = null;
    closing = false;
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
    finishExit,
    dispose() {
      if (errorTimer !== null) clearTimeout(errorTimer);
      if (warningTimer !== null) clearTimeout(warningTimer);
      if (noticeTimer !== null) clearTimeout(noticeTimer);
      clearExitTimer();
      listeners.clear();
    },
  };
}
