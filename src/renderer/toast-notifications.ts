/**
 * Toast notification state machine for the bottom-right shell toast.
 *
 * Notices auto-dismiss after 5s, errors after 10s. Dismissal (timer or
 * manual close) is a two-step lifecycle: the toast enters `closing`, which
 * plays the CSS exit transition, and unmounts only when the transition ends
 * (`finishExit`, driven by onTransitionEnd) or a fallback timer fires —
 * whichever comes first (REQ-SHELL-010).
 *
 * Pure controller with no React dependency; the renderer binds it through
 * `useToastNotifications`. Timers default to the global setTimeout so unit
 * tests drive the lifecycle with vi.useFakeTimers().
 */

export type ToastKind = "error" | "notice";

export interface ToastMessage {
  kind: ToastKind;
  text: string;
}

export interface ToastSnapshot {
  /** Committed channel values (mirrors the former useState pair). */
  error: string | null;
  notice: string | null;
  /** Message kept in the DOM — stays mounted while `closing` fades out. */
  rendered: ToastMessage | null;
  /** True while the exit transition is playing. */
  closing: boolean;
}

export const TOAST_NOTICE_DURATION_MS = 5_000;
export const TOAST_ERROR_DURATION_MS = 10_000;
/** Matches the .toast exit transition duration in styles.css. */
export const TOAST_EXIT_DURATION_MS = 180;
/** Grace on top of the exit duration before the fallback unmount fires. */
const EXIT_FALLBACK_MARGIN_MS = 50;

type TimerId = ReturnType<typeof setTimeout>;

export interface ToastNotifications {
  getSnapshot(): ToastSnapshot;
  subscribe(listener: () => void): () => void;
  setError(text: string | null): void;
  setNotice(text: string | null): void;
  /** Idempotent: ends the closing phase and unmounts the toast. */
  finishExit(): void;
  dispose(): void;
}

export function createToastNotifications(): ToastNotifications {
  let error: string | null = null;
  let notice: string | null = null;
  let rendered: ToastMessage | null = null;
  let closing = false;
  let snapshot: ToastSnapshot = { error, notice, rendered, closing };
  const listeners = new Set<() => void>();
  let errorTimer: TimerId | null = null;
  let noticeTimer: TimerId | null = null;
  let exitTimer: TimerId | null = null;

  function commit(): void {
    const next: ToastSnapshot = { error, notice, rendered, closing };
    if (
      next.error === snapshot.error &&
      next.notice === snapshot.notice &&
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

  /** The message that wins the toast surface: errors cover notices. */
  function activeMessage(): ToastMessage | null {
    if (error) return { kind: "error", text: error };
    if (notice) return { kind: "notice", text: notice };
    return null;
  }

  /**
   * Reconcile the DOM-side state with the committed channels: a live message
   * renders immediately (cancelling any exit in flight); once no channel is
   * committed the rendered toast enters the closing phase with a fallback
   * unmount timer in case transitionend never arrives.
   */
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

  function setNotice(text: string | null): void {
    if (noticeTimer !== null) {
      clearTimeout(noticeTimer);
      noticeTimer = null;
    }
    notice = text;
    if (text) {
      noticeTimer = setTimeout(() => setNotice(null), TOAST_NOTICE_DURATION_MS);
    }
    reconcile();
    commit();
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
    setNotice,
    finishExit,
    dispose() {
      if (errorTimer !== null) clearTimeout(errorTimer);
      if (noticeTimer !== null) clearTimeout(noticeTimer);
      clearExitTimer();
      listeners.clear();
    },
  };
}
