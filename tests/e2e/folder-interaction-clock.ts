export type LocalInteractionMode = "create" | "folder" | "all-assets";

export type LocalInteractionTarget = {
  folderName?: string;
  folderId?: string;
};

/** Renderer-local times; paint is a two-frame stable-target checkpoint. */
export type LocalInteractionMeasurement = {
  eventSeen: boolean;
  timedOut: boolean;
  inputToDomMs: number | null;
  inputToPaintMs: number | null;
  clickToActiveDomMs: number | null;
  clickToActivePaintMs: number | null;
  clickToDomMs: number | null;
  clickToPaintMs: number | null;
  clickToFirstDecodedMs: number | null;
  clickToNinetyPercentDecodedMs: number | null;
};

export type LocalInteractionClock = {
  arm(mode: LocalInteractionMode, target: LocalInteractionTarget): number;
  read(token: number): Promise<LocalInteractionMeasurement>;
  cancel(token: number): void;
  dispose(): void;
};
/**
 * Installs one page-side clock. DOM timestamps are the first frame that sees
 * the state (one scheduled-rAF sampling interval of uncertainty). Paint values
 * require the target state to remain true for two checker frames; they are not
 * compositor presentation timestamps.
 */
export function installLocalInteractionClock(): void {
  type Mode = LocalInteractionMode;
  type Target = LocalInteractionTarget;
  type Measurement = LocalInteractionMeasurement;
  type Session = {
    token: number;
    mode: Mode;
    target: Target;
    startedAt: number | null;
    frameNumber: number;
    activeDomAt: number | null;
    activePaintAt: number | null;
    activePaintDueFrame: number | null;
    domAt: number | null;
    paintAt: number | null;
    paintDueFrame: number | null;
    firstDecodedAt: number | null;
    ninetyPercentDecodedAt: number | null;
    frameIds: Set<number>;
    checkFrameId: number | null;
    dirty: boolean;
    navRoot: HTMLElement | null;
    canvasRoot: HTMLElement | null;
    observer: MutationObserver | null;
    timeoutId: number;
    completion: Promise<Measurement>;
    resolve: (measurement: Measurement) => void;
    cleaned: boolean;
    cleanup: (() => void) | null;
  };
  type Clock = LocalInteractionClock;

  const host = window as Window & { __folderInteractionClock?: Clock };
  host.__folderInteractionClock?.dispose();
  let sequence = 0;
  let active: Session | null = null;
  const sessions = new Map<number, Session>();

  const isVisible = (element: Element | null): boolean => {
    if (!element) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      rect.width > 0 &&
      rect.height > 0
    );
  };

  const activeRow = (session: Session): HTMLElement | null => {
    if (session.mode === "folder") {
      return document.querySelector<HTMLElement>(
        `.navigation-pane button.nav-row.is-active[data-nav-folder-id="${CSS.escape(session.target.folderId ?? "")}"]`,
      );
    }
    if (session.mode === "all-assets") {
      return (
        [
          ...document.querySelectorAll<HTMLElement>(
            ".navigation-pane button.nav-row.is-active",
          ),
        ].find(
          (row) =>
            row.querySelector(".nav-row-label")?.textContent?.trim() ===
            "所有资产",
        ) ?? null
      );
    }
    return null;
  };

  const folderCanvasIsEmpty = (): boolean =>
    isVisible(document.querySelector(".workspace-canvas .empty-library")) &&
    document.querySelectorAll(".workspace-canvas [data-asset-id]").length === 0;

  const folderLabel = (session: Session): HTMLElement | null =>
    [
      ...document.querySelectorAll<HTMLElement>(
        '.navigation-pane button.nav-row[data-nav-folder-kind="managed"] .nav-row-label',
      ),
    ].find(
      (label) => label.textContent?.trim() === session.target.folderName,
    ) ?? null;

  const allAssetsIsActive = (session: Session): boolean =>
    activeRow(session)?.querySelector(".nav-row-label")?.textContent?.trim() ===
    "所有资产";

  const visibleImageState = (): {
    imageCards: number;
    decodedImages: number;
    coverage: number;
  } => {
    const canvas = document.querySelector<HTMLElement>(".workspace-canvas");
    if (!canvas) return { imageCards: 0, decodedImages: 0, coverage: 0 };
    const canvasRect = canvas.getBoundingClientRect();
    const visibleCards = [
      ...document.querySelectorAll<HTMLElement>(
        ".asset-card:not(.is-layout-preview)",
      ),
    ].filter((card) => {
      const rect = card.getBoundingClientRect();
      return (
        rect.bottom > canvasRect.top &&
        rect.top < canvasRect.bottom &&
        rect.right > canvasRect.left &&
        rect.left < canvasRect.right
      );
    });
    const imageCards = visibleCards.filter(
      (card) => card.dataset.mediaType === "image",
    );
    const decodedImages = imageCards.filter((card) => {
      const image = card.querySelector<HTMLImageElement>("img.asset-thumbnail");
      return (
        image?.complete === true &&
        image.naturalWidth > 0 &&
        image.naturalHeight > 0
      );
    }).length;
    return {
      imageCards: imageCards.length,
      decodedImages,
      coverage: imageCards.length === 0 ? 1 : decodedImages / imageCards.length,
    };
  };

  const conditions = (
    session: Session,
  ): { active: boolean; primary: boolean } => {
    if (session.mode === "create") {
      const visible = isVisible(folderLabel(session));
      return { active: false, primary: visible };
    }
    if (session.mode === "folder") {
      const rowIsActive = activeRow(session) !== null;
      return {
        active: rowIsActive,
        primary: rowIsActive && folderCanvasIsEmpty(),
      };
    }
    const rootIsActive = allAssetsIsActive(session);
    return { active: rootIsActive, primary: rootIsActive };
  };

  const elapsed = (
    startedAt: number | null,
    at: number | null,
  ): number | null => {
    if (startedAt === null || at === null) return null;
    return Number((at - startedAt).toFixed(2));
  };

  const measurement = (session: Session, timedOut: boolean): Measurement => ({
    eventSeen: session.startedAt !== null,
    timedOut,
    inputToDomMs:
      session.mode === "create"
        ? elapsed(session.startedAt, session.domAt)
        : null,
    inputToPaintMs:
      session.mode === "create"
        ? elapsed(session.startedAt, session.paintAt)
        : null,
    clickToActiveDomMs:
      session.mode === "create"
        ? null
        : elapsed(session.startedAt, session.activeDomAt),
    clickToActivePaintMs:
      session.mode === "create"
        ? null
        : elapsed(session.startedAt, session.activePaintAt),
    clickToDomMs:
      session.mode === "create"
        ? null
        : elapsed(session.startedAt, session.domAt),
    clickToPaintMs:
      session.mode === "create"
        ? null
        : elapsed(session.startedAt, session.paintAt),
    clickToFirstDecodedMs:
      session.mode === "all-assets"
        ? elapsed(session.startedAt, session.firstDecodedAt)
        : null,
    clickToNinetyPercentDecodedMs:
      session.mode === "all-assets"
        ? elapsed(session.startedAt, session.ninetyPercentDecodedAt)
        : null,
  });

  const clock: Clock = {
    arm(mode, target) {
      if (active) cancelSession(active);
      const token = ++sequence;
      let resolve!: (value: Measurement) => void;
      const completion = new Promise<Measurement>((done) => {
        resolve = done;
      });
      const session: Session = {
        token,
        mode,
        target,
        startedAt: null,
        frameNumber: 0,
        activeDomAt: null,
        activePaintAt: null,
        activePaintDueFrame: null,
        domAt: null,
        paintAt: null,
        paintDueFrame: null,
        firstDecodedAt: null,
        ninetyPercentDecodedAt: null,
        frameIds: new Set(),
        checkFrameId: null,
        dirty: false,
        navRoot: null,
        canvasRoot: null,
        observer: null,
        timeoutId: 0,
        completion,
        resolve,
        cleaned: false,
        cleanup: null,
      };
      sessions.set(token, session);
      active = session;

      const cleanup = () => {
        if (session.cleaned) return;
        session.cleaned = true;
        if (session.mode === "create")
          document.removeEventListener("keydown", onKeyDown, true);
        else document.removeEventListener("click", onClick, true);
        session.observer?.disconnect();
        session.observer = null;
        for (const frameId of session.frameIds) cancelAnimationFrame(frameId);
        session.frameIds.clear();
        session.checkFrameId = null;
        clearTimeout(session.timeoutId);
      };
      session.cleanup = cleanup;

      const finish = (timedOut: boolean) => {
        if (session.cleaned) return;
        const result = measurement(session, timedOut);
        cleanup();
        if (active === session) active = null;
        session.resolve(result);
      };

      const scheduleFrame = (callback: (frameTime: number) => void): number => {
        let frameId = 0;
        frameId = requestAnimationFrame((frameTime) => {
          session.frameIds.delete(frameId);
          if (active === session && !session.cleaned) callback(frameTime);
        });
        session.frameIds.add(frameId);
        return frameId;
      };

      const scheduleCheck = () => {
        if (
          session.checkFrameId !== null ||
          active !== session ||
          session.cleaned
        )
          return;
        session.checkFrameId = scheduleFrame(() => {
          session.checkFrameId = null;
          if (
            session.dirty ||
            session.mode === "all-assets" ||
            session.activePaintDueFrame !== null ||
            session.paintDueFrame !== null
          ) {
            session.dirty = false;
            check();
          }
        });
      };

      function maybeFinish(): void {
        if (session.mode === "create") {
          if (session.domAt !== null && session.paintAt !== null) finish(false);
          return;
        }
        if (session.mode === "folder") {
          if (session.domAt !== null && session.paintAt !== null) finish(false);
          return;
        }
        if (
          session.domAt !== null &&
          session.paintAt !== null &&
          session.firstDecodedAt !== null &&
          session.ninetyPercentDecodedAt !== null
        )
          finish(false);
      }

      function check(): void {
        if (active !== session || session.cleaned || session.startedAt === null)
          return;
        session.frameNumber += 1;
        const now = performance.now();
        const current = conditions(session);
        updateCheckpoint("active", current.active, now);
        updateCheckpoint("primary", current.primary, now);
        if (session.mode === "all-assets") {
          const imageState = visibleImageState();
          if (imageState.decodedImages > 0) session.firstDecodedAt ??= now;
          if (imageState.imageCards > 0 && imageState.coverage >= 0.9) {
            session.ninetyPercentDecodedAt ??= now;
          }
        }
        maybeFinish();
        if (
          session.mode === "all-assets" &&
          (session.firstDecodedAt === null ||
            session.ninetyPercentDecodedAt === null)
        ) {
          scheduleCheck();
        }
        if (
          session.activePaintDueFrame !== null ||
          session.paintDueFrame !== null
        ) {
          scheduleCheck();
        }
      }

      function updateCheckpoint(
        kind: "active" | "primary",
        isTrue: boolean,
        now: number,
      ): void {
        const paintAt =
          kind === "active" ? session.activePaintAt : session.paintAt;
        let dueFrame =
          kind === "active"
            ? session.activePaintDueFrame
            : session.paintDueFrame;
        if (!isTrue) {
          if (paintAt === null) dueFrame = null;
        } else if (kind === "active") {
          session.activeDomAt ??= now;
        } else {
          session.domAt ??= now;
        }

        if (isTrue && paintAt === null) {
          if (dueFrame === null) dueFrame = session.frameNumber + 2;
          else if (session.frameNumber >= dueFrame) {
            if (kind === "active") session.activePaintAt = now;
            else session.paintAt = now;
            dueFrame = null;
            if (kind === "primary" && session.mode === "all-assets") {
              session.activePaintAt ??= now;
              session.activePaintDueFrame = null;
            }
            if (kind === "primary") {
              session.observer?.disconnect();
              session.observer = null;
            }
          }
        }

        if (kind === "active") session.activePaintDueFrame = dueFrame;
        else session.paintDueFrame = dueFrame;
      }

      const start = () => {
        if (active !== session || session.startedAt !== null) return;
        session.startedAt = performance.now();
        session.navRoot =
          document.querySelector<HTMLElement>(".navigation-pane");
        session.canvasRoot =
          document.querySelector<HTMLElement>(".workspace-canvas");
        session.observer = new MutationObserver((records) => {
          let relevant = false;
          for (const record of records) {
            relevant ||=
              session.navRoot?.contains(record.target) === true ||
              session.canvasRoot?.contains(record.target) === true;
          }
          if (relevant) {
            session.dirty = true;
            scheduleCheck();
          }
        });
        if (session.navRoot) {
          session.observer.observe(session.navRoot, {
            subtree: true,
            childList: true,
            attributes: true,
            characterData: true,
          });
        }
        if (session.canvasRoot) {
          session.observer.observe(session.canvasRoot, {
            subtree: true,
            childList: true,
            attributes: true,
            characterData: true,
          });
        }
        session.dirty = true;
        scheduleCheck();
      };

      const onKeyDown = (event: KeyboardEvent) => {
        const element = event.target instanceof Element ? event.target : null;
        if (event.key === "Enter" && element?.matches(".nav-inline-edit input"))
          start();
      };
      const onClick = (event: MouseEvent) => {
        const element = event.target instanceof Element ? event.target : null;
        const row = element?.closest<HTMLElement>("button.nav-row");
        if (!row) return;
        if (mode === "folder" && row.dataset.navFolderId === target.folderId)
          start();
        if (
          mode === "all-assets" &&
          row.querySelector(".nav-row-label")?.textContent?.trim() ===
            "所有资产"
        )
          start();
      };

      if (mode === "create")
        document.addEventListener("keydown", onKeyDown, true);
      else document.addEventListener("click", onClick, true);
      session.timeoutId = window.setTimeout(() => finish(true), 125_000);
      return token;
    },
    async read(token) {
      const session = sessions.get(token);
      if (!session)
        throw new Error("The renderer interaction marker is unavailable.");
      const result = await session.completion;
      sessions.delete(token);
      return result;
    },
    cancel(token) {
      const session = sessions.get(token);
      if (session) cancelSession(session);
    },
    dispose() {
      if (active) cancelSession(active);
      sessions.clear();
    },
  };

  function cancelSession(session: Session): void {
    if (session.cleaned) return;
    const result = measurement(session, true);
    session.cleanup?.();
    if (active === session) active = null;
    sessions.delete(session.token);
    session.resolve(result);
  }

  host.__folderInteractionClock = clock;
}
