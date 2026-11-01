export const NAVIGATION_REFLOW_START = "serpent:navigation-reflow-start";
export const NAVIGATION_REFLOW_END = "serpent:navigation-reflow-end";

/** Stage destination geometry before React publishes navigation and canvas width
 * together. A separate state commit here would render the whole library twice. */
export function stageNavigationToggle(shell: HTMLElement): boolean {
  return !shell.classList.toggle("left-collapsed");
}

/** Browser-owned snapshots keep navigation and card movement on the compositor.
 * React/virtual geometry only need to calculate the destination layout once. */
export class NavigationReflowTransition {
  private active: ViewTransition | null = null;
  private release: (() => void) | null = null;
  private disposed = false;

  async run(
    shell: HTMLElement,
    prepare: () => void,
    update: () => void,
    settle: () => Promise<void>,
    onCaptured?: (cards: readonly { card: HTMLElement; rect: DOMRect }[], viewport: DOMRect | undefined) => void,
  ): Promise<void> {
    this.disposed = false;
    const previous = this.active;
    if (previous) {
      previous.skipTransition();
      // Skipping playback does not cancel the DOM update. Wait for it before
      // measuring the next direction, so rapid clicks preserve reading context.
      await previous.updateCallbackDone.catch(() => undefined);
    }
    if (this.disposed) return;
    this.release?.();
    prepare();

    const saved = new Map<HTMLElement, string>();
    const savedClasses = new Map<HTMLElement, string>();
    const named = new Map<string, string>();
    const before = new Map<string, DOMRect>();
    const motionStyles = document.createElement("style");
    motionStyles.dataset.navMotion = "true";
    const html = document.documentElement;
    html.dataset.navTransition = "true";
    window.dispatchEvent(new Event(NAVIGATION_REFLOW_START));
    const name = (element: HTMLElement | null, value: string) => {
      if (!element) return;
      if (!saved.has(element)) saved.set(element, element.style.viewTransitionName || "");
      element.style.viewTransitionName = value;
      if (value.startsWith("nav-card-")) {
        if (!savedClasses.has(element)) savedClasses.set(element, element.style.getPropertyValue("view-transition-class"));
        element.style.setProperty("view-transition-class", "nav-card");
      }
    };
    const pane = shell.querySelector<HTMLElement>(".navigation-pane");
    const workspace = shell.querySelector<HTMLElement>(".workspace");
    // Named card snapshots escape the canvas's normal stacking/overflow.
    // Keep both toolbar layers above them, including partially scrolled cards.
    const chrome = [
      { element: shell.querySelector<HTMLElement>(".app-toolbar"), value: "nav-toolbar" },
      { element: shell.querySelector<HTMLElement>(".workspace-toolstrip"), value: "nav-toolstrip" },
    ];
    for (const { element, value } of chrome) {
      if (element) before.set(value, element.getBoundingClientRect());
      name(element, value);
    }
    if (workspace) before.set("nav-workspace", workspace.getBoundingClientRect());
    // Capture only the full-sized visible pane. A zero-width destination would
    // resize its snapshot group instead of producing a horizontal slide.
    if (!shell.classList.contains("left-collapsed")) name(pane, "nav-panel");
    name(workspace, "nav-workspace");
    const canvas = shell.querySelector<HTMLElement>(".workspace-canvas");
    const viewport = canvas?.getBoundingClientRect();
    // A card's independent snapshot otherwise escapes the scroller's clip and
    // can show through transparent title-bar areas far above the canvas.
    const nestedCanvas = Boolean(canvas && viewport && CSS.supports("view-transition-group", "contain"));
    if (nestedCanvas) name(canvas, "nav-canvas");
    const cards = () => [...shell.querySelectorAll<HTMLElement>(".asset-card[data-asset-id], .folder-card[data-folder-id]")];
    const key = (card: HTMLElement) => card.dataset.assetId ? `asset:${card.dataset.assetId}` : `folder:${card.dataset.folderId}`;
    // Read every rect before writing transition names. Alternating these reads
    // and style writes forces repeated style resolution in a dense canvas.
    const visible = cards().flatMap((card) => {
      const rect = card.getBoundingClientRect();
      if (!viewport || rect.bottom <= viewport.top || rect.top >= viewport.bottom ||
          rect.right <= viewport.left || rect.left >= viewport.right) return [];
      return [{ card, rect }];
    });
    onCaptured?.(visible, viewport);
    for (const { card, rect } of visible) {
      const value = `nav-card-${named.size}`;
      named.set(key(card), value);
      before.set(value, rect);
      name(card, value);
    }
    let released = false;
    const cleanup = () => {
      if (released) return;
      released = true;
      motionStyles.remove();
      for (const [element, value] of saved) element.style.viewTransitionName = value;
      for (const [element, value] of savedClasses) {
        if (value) element.style.setProperty("view-transition-class", value);
        else element.style.removeProperty("view-transition-class");
      }
      delete html.dataset.navTransition;
      window.dispatchEvent(new Event(NAVIGATION_REFLOW_END));
    };
    this.release = cleanup;
    let transition: ViewTransition;
    try {
      transition = document.startViewTransition(async () => {
        update();
        await settle();
        if (!this.disposed) {
          if (pane) {
            if (shell.classList.contains("left-collapsed")) {
              pane.style.viewTransitionName = saved.get(pane) ?? "";
            } else {
              name(pane, "nav-panel");
            }
          }
          // Masonry/justified may move a card into a different virtual parent.
          // Clear old identities first, then name the new mounted elements.
          for (const [element, value] of saved) {
            if (element.matches(".asset-card, .folder-card")) element.style.viewTransitionName = value;
          }
          const destinations = cards().flatMap((card) => {
            const value = named.get(key(card));
            return value ? [{ card, value, rect: card.getBoundingClientRect() }] : [];
          });
          const rules: string[] = [];
          const destinationViewport = nestedCanvas ? canvas?.getBoundingClientRect() : undefined;
          if (viewport && destinationViewport) {
            rules.push(snapshotViewportRule(viewport, destinationViewport));
          }
          if (workspace) {
            const from = before.get("nav-workspace");
            const rect = workspace.getBoundingClientRect();
            if (from) rules.push(snapshotTransformRule("nav-workspace", from, rect));
          }
          for (const { element, value } of chrome) {
            const from = before.get(value);
            if (element && from) rules.push(snapshotTransformRule(value, from, element.getBoundingClientRect()));
          }
          for (const { card, value, rect } of destinations) {
            name(card, value);
            const from = before.get(value);
            if (from && from.width > 0 && from.height > 0 && rect.width > 0 && rect.height > 0) {
              // Keep snapshot bounds fixed at the destination. Animate only a
              // compositor transform, not width/height on every playback frame.
              rules.push(snapshotTransformRule(value,
                viewport && destinationViewport ? relativeRect(from, viewport) : from,
                destinationViewport ? relativeRect(rect, destinationViewport) : rect));
            }
          }
          motionStyles.textContent = rules.join("\n");
          document.head.append(motionStyles);
        }
      });
    } catch (error) {
      cleanup();
      this.release = null;
      throw error;
    }
    this.active = transition;
    // A skipped/reduced transition may reject ready; its DOM update still runs.
    void transition.ready.catch(() => undefined);
    try {
      await transition.finished;
    } finally {
      if (this.active === transition) {
        this.active = null;
        cleanup();
        this.release = null;
      }
    }
  }

  cancel(): void {
    this.disposed = true;
    this.active?.skipTransition();
    this.release?.();
    this.release = null;
  }
}

/** Start a mouse action on press, while retaining click activation for touch and
 * keyboards. Consume its following mouse click so one gesture toggles once. */
export class NavigationPressAction {
  private handledPress = false;

  pointerDown(event: Pick<PointerEvent, "pointerType" | "button">, activate: () => void): void {
    this.handledPress = event.pointerType === "mouse" && event.button === 0;
    if (this.handledPress) activate();
  }

  click(event: Pick<MouseEvent, "detail">, activate: () => void): void {
    const consumed = this.handledPress && event.detail > 0;
    this.handledPress = false;
    if (!consumed) activate();
  }

  cancel(): void { this.handledPress = false; }
}

function snapshotTransformRule(value: string, from: DOMRect, to: DOMRect): string {
  if (from.width <= 0 || from.height <= 0 || to.width <= 0 || to.height <= 0) return "";
  return `
:root[data-nav-transition]::view-transition-group(${value}) {
  width: ${to.width}px; height: ${to.height}px;
  transform-origin: 0 0;
  animation-name: ${value}-move;
}
@keyframes ${value}-move {
  from { transform: matrix(${from.width / to.width}, 0, 0, ${from.height / to.height}, ${from.left}, ${from.top}); }
  to { transform: matrix(1, 0, 0, 1, ${to.left}, ${to.top}); }
}`;
}

function relativeRect(rect: DOMRect, parent: DOMRect): DOMRect {
  return new DOMRect(rect.left - parent.left, rect.top - parent.top, rect.width, rect.height);
}

/** Keep snapshot geometry fixed throughout playback. Animating viewport width
 * would relayout its nested snapshot tree every frame; interpolate the clip
 * instead, while the cards retain their independent translation/scale paths. */
function snapshotViewportRule(from: DOMRect, to: DOMRect): string {
  const width = Math.max(from.width, to.width);
  const height = Math.max(from.height, to.height);
  return `
:root[data-nav-transition]::view-transition-group(nav-canvas) {
  width: ${width}px; height: ${height}px;
  animation-name: nav-canvas-viewport;
}
:root[data-nav-transition]::view-transition-new(nav-canvas) {
  width: ${to.width}px; height: ${to.height}px;
}
@keyframes nav-canvas-viewport {
  from { clip-path: inset(0 ${width - from.width}px ${height - from.height}px 0); transform: translate(${from.left}px, ${from.top}px); }
  to { clip-path: inset(0 ${width - to.width}px ${height - to.height}px 0); transform: translate(${to.left}px, ${to.top}px); }
}`;
}
