/**
 * Owns the lifetime of one viewer asset session.
 *
 * Viewer work has several independent async producers (preview resolution,
 * proxy fallback, PDF range reads, and page rendering). React unmount cleanup
 * alone is not enough: a response that was started before a fast navigation
 * can still resolve after the new surface is mounted. This controller gives
 * every producer the same session fence and a latest-wins request fence.
 *
 * It deliberately does not pretend that an IPC Promise can be interrupted
 * from the Renderer. The AbortSignal is used by fetch/pdf/media tasks that
 * support cancellation; request tokens still fence late IPC responses before
 * they can update the current surface.
 */

export type ViewerSessionIdentity = Readonly<{
  libraryId: string;
  assetId: string;
  revisionId: string;
}>;

export type ViewerSession = ViewerSessionIdentity & Readonly<{
  viewerSessionId: string;
  signal: AbortSignal;
}>;

export type ViewerRequestToken = Readonly<{
  viewerSessionId: string;
  requestGeneration: number;
  signal: AbortSignal;
  isCurrent(): boolean;
}>;

export type ViewerTaskToken = Readonly<{
  viewerSessionId: string;
  taskKey: string;
  taskGeneration: number;
  signal: AbortSignal;
  isCurrent(): boolean;
}>;

type InternalSession = ViewerSession & {
  readonly abortController: AbortController;
  initialRequestClaimed: boolean;
};

type InternalTask = {
  readonly sessionId: string;
  readonly taskKey: string;
  readonly taskGeneration: number;
  readonly abortController: AbortController;
  readonly onSessionAbort: () => void;
};

function sameIdentity(left: ViewerSessionIdentity, right: ViewerSessionIdentity): boolean {
  return (
    left.libraryId === right.libraryId &&
    left.assetId === right.assetId &&
    left.revisionId === right.revisionId
  );
}

/**
 * Session/cancellation owner for image, document, video and complex-media
 * viewer surfaces.
 */
export class ViewerSessionController {
  #nextSessionNumber = 0;
  #requestGeneration = 0;
  #taskGeneration = 0;
  #session: InternalSession | null = null;
  #tasks = new Map<string, InternalTask>();
  #timers = new Set<ReturnType<typeof setTimeout>>();
  #destroyed = false;

  start(identity: ViewerSessionIdentity): ViewerSession {
    if (this.#destroyed) {
      throw new Error("ViewerSessionController cannot be restarted after destroy().");
    }
    if (this.#session && sameIdentity(this.#session, identity)) {
      return this.#session;
    }

    this.invalidate();
    const abortController = new AbortController();
    const session: InternalSession = {
      ...identity,
      viewerSessionId: `viewer-${++this.#nextSessionNumber}`,
      signal: abortController.signal,
      abortController,
      initialRequestClaimed: false,
    };
    this.#session = session;
    this.#requestGeneration = 0;
    return session;
  }

  current(identity?: ViewerSessionIdentity): ViewerSession | null {
    const session = this.#session;
    if (!session || session.signal.aborted) return null;
    if (identity && !sameIdentity(session, identity)) return null;
    return session;
  }

  isCurrent(session: ViewerSession): boolean {
    return this.#session?.viewerSessionId === session.viewerSessionId
      && !session.signal.aborted;
  }

  /** Claim the one initial resolve for a session, including StrictMode remounts. */
  claimInitialRequest(session: ViewerSession): boolean {
    const current = this.#internalSession(session);
    if (!current || current.initialRequestClaimed) return false;
    current.initialRequestClaimed = true;
    return true;
  }

  /** Start a latest-wins request without aborting an underlying IPC Promise. */
  beginRequest(session: ViewerSession): ViewerRequestToken | null {
    if (!this.isCurrent(session)) return null;
    const requestGeneration = ++this.#requestGeneration;
    return {
      viewerSessionId: session.viewerSessionId,
      requestGeneration,
      signal: session.signal,
      isCurrent: () => (
        this.isCurrent(session) &&
        this.#requestGeneration === requestGeneration
      ),
    };
  }

  /**
   * Start one keyed auxiliary task (for example proxy fallback). Starting a
   * newer task with the same key cancels the older task and its fetches.
   */
  beginTask(session: ViewerSession, taskKey: string): ViewerTaskToken | null {
    if (!this.isCurrent(session)) return null;
    this.cancelTask(taskKey);
    const abortController = new AbortController();
    const taskGeneration = ++this.#taskGeneration;
    const onSessionAbort = () => abortController.abort();
    session.signal.addEventListener("abort", onSessionAbort, { once: true });
    const task: InternalTask = {
      sessionId: session.viewerSessionId,
      taskKey,
      taskGeneration,
      abortController,
      onSessionAbort,
    };
    this.#tasks.set(taskKey, task);
    return {
      viewerSessionId: session.viewerSessionId,
      taskKey,
      taskGeneration,
      signal: abortController.signal,
      isCurrent: () => {
        const current = this.#tasks.get(taskKey);
        return this.isCurrent(session)
          && current?.taskGeneration === taskGeneration
          && !abortController.signal.aborted;
      },
    };
  }

  cancelTask(taskKey: string): void {
    const task = this.#tasks.get(taskKey);
    if (!task) return;
    this.#tasks.delete(taskKey);
    task.abortController.abort();
    this.#session?.signal.removeEventListener("abort", task.onSessionAbort);
  }

  /** Schedule work only while this exact session remains current. */
  schedule(
    session: ViewerSession,
    callback: () => void,
    delayMs: number,
  ): ReturnType<typeof setTimeout> | null {
    if (!this.isCurrent(session)) return null;
    const timer = setTimeout(() => {
      this.#timers.delete(timer);
      if (this.isCurrent(session)) callback();
    }, Math.max(0, delayMs));
    this.#timers.add(timer);
    return timer;
  }

  cancelScheduled(timer: ReturnType<typeof setTimeout> | null): void {
    if (timer === null) return;
    clearTimeout(timer);
    this.#timers.delete(timer);
  }

  /** Abort all work owned by the current session and drop its fence. */
  invalidate(): void {
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers.clear();
    for (const task of this.#tasks.values()) {
      task.abortController.abort();
      this.#session?.signal.removeEventListener("abort", task.onSessionAbort);
    }
    this.#tasks.clear();
    this.#session?.abortController.abort();
    this.#session = null;
    this.#requestGeneration += 1;
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.invalidate();
  }

  #internalSession(session: ViewerSession): InternalSession | null {
    return this.#session?.viewerSessionId === session.viewerSessionId
      && !session.signal.aborted
      ? this.#session
      : null;
  }
}
