// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { NavigationReflowTransition, NavigationPressAction, stageNavigationToggle } from "../../src/renderer/navigation-reflow-transition";
import { CANVAS_LAYOUT_MEASURE, settleCanvasLayout } from "../../src/renderer/canvas-layout-measure";

describe("navigation snapshot reflow", () => {
  let shell: HTMLElement;
  let latest: ViewTransition;
  let endPlayback: () => void;
  beforeEach(() => {
    document.body.innerHTML = '<main><aside class="navigation-pane"></aside><section class="workspace"><div class="workspace-canvas"><button class="asset-card" data-asset-id="a"></button></div></section></main>';
    shell = document.querySelector("main")!;
    shell.querySelector<HTMLElement>(".workspace-canvas")!.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
    shell.querySelector<HTMLElement>(".asset-card")!.getBoundingClientRect = () => new DOMRect(20, 20, 200, 200);
    Object.defineProperty(document, "startViewTransition", { configurable: true, value: vi.fn((update: () => Promise<void>) => {
      const playback = new Promise<void>((resolve) => { endPlayback = resolve; });
      const updated = Promise.resolve().then(update);
      latest = { ready: updated, updateCallbackDone: updated, finished: updated.then(() => playback), skipTransition: vi.fn(() => endPlayback()) } as unknown as ViewTransition;
      return latest;
    }) });
  });
  afterEach(() => {
    document.body.replaceChildren();
    delete document.documentElement.dataset.navTransition;
    Reflect.deleteProperty(document, "startViewTransition");
    vi.restoreAllMocks();
  });

  it("settles the final DOM once before playback, then restores all names", async () => {
    const motion = new NavigationReflowTransition();
    const order: string[] = [];
    const card = shell.querySelector<HTMLElement>(".asset-card")!;
    card.style.viewTransitionName = "prior-name";
    const task = motion.run(shell, () => { order.push("prepare"); }, () => { order.push("update"); }, async () => { order.push("settle"); });
    await latest.updateCallbackDone;
    expect(order).toEqual(["prepare", "update", "settle"]);
    expect(card.style.viewTransitionName).toBe("nav-card-0");
    expect(shell.querySelector<HTMLElement>(".workspace")!.style.viewTransitionName).toBe("nav-workspace");
    expect(document.documentElement.dataset.navTransition).toBe("true");
    endPlayback();
    await task;
    expect(card.style.viewTransitionName).toBe("prior-name");
    expect(shell.querySelector<HTMLElement>(".workspace")!.style.viewTransitionName).toBe("");
    expect(document.documentElement.dataset.navTransition).toBeUndefined();
  });

  it("matches a virtual remount by asset identity instead of DOM position", async () => {
    const motion = new NavigationReflowTransition();
    const old = shell.querySelector<HTMLElement>(".asset-card")!;
    const replacement = document.createElement("button");
    replacement.className = "asset-card";
    replacement.dataset.assetId = "a";
    const task = motion.run(shell, () => {}, () => old.replaceWith(replacement), async () => {});
    await latest.updateCallbackDone;
    expect(old.style.viewTransitionName).toBe("");
    expect(replacement.style.viewTransitionName).toBe("nav-card-0");
    endPlayback();
    await task;
    expect(replacement.style.viewTransitionName).toBe("");
  });

  it.each([false, true])("keeps toolbar snapshots separate from cards when initially collapsed=%s", async (collapsed) => {
    shell.classList.toggle("left-collapsed", collapsed);
    const toolbar = document.createElement("header");
    toolbar.className = "app-toolbar";
    toolbar.style.viewTransitionName = "original-toolbar";
    toolbar.getBoundingClientRect = () => new DOMRect(0, 0, 1280, 48);
    shell.prepend(toolbar);
    const toolstrip = document.createElement("div");
    toolstrip.className = "workspace-toolstrip";
    toolstrip.getBoundingClientRect = () => shell.classList.contains("left-collapsed")
      ? new DOMRect(0, 48, 1000, 80) : new DOMRect(224, 48, 776, 80);
    shell.querySelector(".workspace")!.prepend(toolstrip);
    const motion = new NavigationReflowTransition();
    const task = motion.run(shell, () => {}, () => { stageNavigationToggle(shell); }, async () => {});
    expect(toolbar.style.viewTransitionName).toBe("nav-toolbar");
    expect(toolstrip.style.viewTransitionName).toBe("nav-toolstrip");
    await latest.updateCallbackDone;
    const rules = document.querySelector("style[data-nav-motion]")!.textContent;
    expect(rules).toContain("animation-name: nav-toolbar-move");
    expect(rules).toContain("animation-name: nav-toolstrip-move");
    endPlayback();
    await task;
    expect(toolbar.style.viewTransitionName).toBe("original-toolbar");
    expect(toolstrip.style.viewTransitionName).toBe("");
  });

  it("captures only the full-sized old pane when closing", async () => {
    const motion = new NavigationReflowTransition();
    const pane = shell.querySelector<HTMLElement>(".navigation-pane")!;
    const task = motion.run(shell, () => {}, () => shell.classList.add("left-collapsed"), async () => {});
    expect(pane.style.viewTransitionName).toBe("nav-panel");
    await latest.updateCallbackDone;
    expect(pane.style.viewTransitionName).toBe("");
    expect(shell.querySelector<HTMLElement>(".workspace")!.style.viewTransitionName).toBe("nav-workspace");
    endPlayback(); await task;
  });

  it("captures only the full-sized new pane when opening", async () => {
    shell.classList.add("left-collapsed");
    const motion = new NavigationReflowTransition();
    const pane = shell.querySelector<HTMLElement>(".navigation-pane")!;
    const task = motion.run(shell, () => {}, () => shell.classList.remove("left-collapsed"), async () => {});
    expect(pane.style.viewTransitionName || "").toBe("");
    await latest.updateCallbackDone;
    expect(pane.style.viewTransitionName).toBe("nav-panel");
    expect(shell.querySelector<HTMLElement>(".asset-card")!.style.viewTransitionName).toBe("nav-card-0");
    endPlayback(); await task;
    expect(pane.style.viewTransitionName).toBe("");
  });

  it("skips old playback but preserves both updates on a rapid reverse", async () => {
    const motion = new NavigationReflowTransition();
    let updates = 0;
    const first = motion.run(shell, () => {}, () => { updates++; }, async () => {});
    await latest.updateCallbackDone;
    const previous = latest;
    const second = motion.run(shell, () => {}, () => { updates++; }, async () => {});
    await first;
    await latest.updateCallbackDone;
    expect(previous.skipTransition).toHaveBeenCalledOnce();
    expect(updates).toBe(2);
    expect(document.documentElement.dataset.navTransition).toBe("true");
    endPlayback();
    await second;
    expect(document.documentElement.dataset.navTransition).toBeUndefined();
  });

  it("cleans snapshot styles when destination layout fails", async () => {
    const motion = new NavigationReflowTransition();
    const task = motion.run(shell, () => {}, () => {}, async () => { throw new Error("layout failed"); });
    await expect(task).rejects.toThrow("layout failed");
    expect(document.documentElement.dataset.navTransition).toBeUndefined();
    expect(shell.querySelector<HTMLElement>(".asset-card")!.style.viewTransitionName).toBe("");
  });

  it("keeps destination dimensions fixed and animates only translation and scale", async () => {
    const motion = new NavigationReflowTransition();
    const card = shell.querySelector<HTMLElement>(".asset-card")!;
    let changed = false;
    card.getBoundingClientRect = () => changed ? new DOMRect(240, 60, 100, 150) : new DOMRect(20, 20, 200, 200);
    const task = motion.run(shell, () => {}, () => { changed = true; }, async () => {});
    await latest.updateCallbackDone;
    const style = document.querySelector<HTMLStyleElement>("style[data-nav-motion]")!;
    expect(style.textContent).toContain("width: 100px; height: 150px");
    expect(style.textContent).toContain("animation-name: nav-card-0-move");
    expect(style.textContent).toContain("matrix(2, 0, 0, 1.3333333333333333, 20, 20)");
    expect(style.textContent).toContain("matrix(1, 0, 0, 1, 240, 60)");
    endPlayback(); await task;
    expect(document.querySelector("style[data-nav-motion]")).toBeNull();
  });

  it("batches old geometry reads before assigning any card transition names", async () => {
    const first = shell.querySelector<HTMLElement>(".asset-card")!;
    const second = first.cloneNode() as HTMLElement;
    second.dataset.assetId = "b";
    first.after(second);
    let updated = false;
    second.getBoundingClientRect = () => {
      if (!updated) expect(first.style.viewTransitionName || "").toBe("");
      return new DOMRect(240, 20, 200, 200);
    };
    const motion = new NavigationReflowTransition();
    const task = motion.run(shell, () => {}, () => { updated = true; }, async () => {});
    await latest.updateCallbackDone;
    expect(second.style.viewTransitionName).toBe("nav-card-1");
    endPlayback(); await task;
  });

  it("shares the captured geometry with scroll anchoring before updating layout", async () => {
    const capture = vi.fn();
    const motion = new NavigationReflowTransition();
    const task = motion.run(shell, () => {}, () => {
      expect(capture).toHaveBeenCalledOnce();
    }, async () => {}, capture);
    expect(capture.mock.calls[0]![0]).toHaveLength(1);
    expect(capture.mock.calls[0]![0][0].rect.left).toBe(20);
    await latest.updateCallbackDone;
    endPlayback(); await task;
  });

  it("nests scrolled card motion inside a moving canvas clip without scaling its parent", async () => {
    vi.spyOn(CSS, "supports").mockReturnValue(true);
    const canvas = shell.querySelector<HTMLElement>(".workspace-canvas")!;
    const card = shell.querySelector<HTMLElement>(".asset-card")!;
    let changed = false;
    canvas.getBoundingClientRect = () => changed
      ? new DOMRect(0, 128, 1024, 600) : new DOMRect(224, 128, 800, 600);
    card.getBoundingClientRect = () => changed
      ? new DOMRect(30, -120, 240, 360) : new DOMRect(244, -92, 200, 300);
    const motion = new NavigationReflowTransition();
    const task = motion.run(shell, () => {}, () => { changed = true; }, async () => {});
    expect(canvas.style.viewTransitionName).toBe("nav-canvas");
    await latest.updateCallbackDone;
    const rules = document.querySelector("style[data-nav-motion]")!.textContent;
    expect(rules).toContain("animation-name: nav-canvas-viewport");
    expect(rules).toContain("width: 1024px; height: 600px;");
    expect(rules).toContain("clip-path: inset(0 224px 0px 0); transform: translate(224px, 128px)");
    expect(rules).toContain("clip-path: inset(0 0px 0px 0); transform: translate(0px, 128px)");
    const viewportKeyframes = rules.split("@keyframes nav-canvas-viewport")[1]?.split("\n}")[0];
    expect(viewportKeyframes).not.toMatch(/width:|height:|scale\(/);
    expect(rules).toContain("matrix(0.8333333333333334, 0, 0, 0.8333333333333334, 20, -220)");
    expect(rules).toContain("matrix(1, 0, 0, 1, 30, -248)");
    endPlayback();
    await task;
    expect(canvas.style.viewTransitionName).toBe("");
  });

  it("commits navigation and measured destination width together, including rapid reversal", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const commits: { open: boolean; width: number }[] = [];
    let publishOpen!: (open: boolean) => void;
    function Library() {
      const [open, setOpen] = useState(true);
      const [width, setWidth] = useState(800);
      publishOpen = setOpen;
      useLayoutEffect(() => {
        commits.push({ open, width });
      });
      useLayoutEffect(() => {
        const canvas = host.querySelector<HTMLElement>(".workspace-canvas")!;
        const measure = () => setWidth(host.firstElementChild!.classList.contains("left-collapsed") ? 1024 : 800);
        canvas.addEventListener(CANVAS_LAYOUT_MEASURE, measure);
        return () => canvas.removeEventListener(CANVAS_LAYOUT_MEASURE, measure);
      }, []);
      return createElement("main", { className: open ? "" : "left-collapsed" },
        createElement("aside", { className: "navigation-pane" }),
        createElement("section", { className: "workspace" },
          createElement("div", { className: "workspace-canvas" })));
    }
    flushSync(() => root.render(createElement(Library)));
    const libraryShell = host.querySelector<HTMLElement>("main")!;
    const canvas = host.querySelector<HTMLElement>(".workspace-canvas")!;
    const motion = new NavigationReflowTransition();
    const toggle = () => {
      let destination = true;
      return motion.run(libraryShell, () => {}, () => {
        destination = stageNavigationToggle(libraryShell);
      }, async () => {
        settleCanvasLayout(canvas, () => flushSync(() => {
          publishOpen(destination);
          canvas.dispatchEvent(new Event(CANVAS_LAYOUT_MEASURE));
        }), () => {});
      });
    };
    try {
      commits.length = 0;
      const close = toggle();
      await latest.updateCallbackDone;
      expect(commits).toEqual([{ open: false, width: 1024 }]);
      const open = toggle();
      await close;
      await latest.updateCallbackDone;
      expect(commits).toEqual([{ open: false, width: 1024 }, { open: true, width: 800 }]);
      expect(libraryShell.classList.contains("left-collapsed")).toBe(false);
      endPlayback();
      await open;
    } finally {
      motion.cancel();
      flushSync(() => root.unmount());
      host.remove();
    }
  });
});

describe("immediate navigation press", () => {
  it("activates on mouse down and consumes its subsequent click", () => {
    const press = new NavigationPressAction();
    const activate = vi.fn();
    press.pointerDown({ pointerType: "mouse", button: 0 }, activate);
    expect(activate).toHaveBeenCalledOnce();
    press.click({ detail: 1 }, activate);
    expect(activate).toHaveBeenCalledOnce();
  });

  it("preserves keyboard activation after a mouse press outside the button", () => {
    const press = new NavigationPressAction();
    const activate = vi.fn();
    press.pointerDown({ pointerType: "mouse", button: 0 }, activate);
    press.click({ detail: 0 }, activate);
    expect(activate).toHaveBeenCalledTimes(2);
  });

  it("keeps touch activation on click and ignores secondary mouse presses", () => {
    const press = new NavigationPressAction();
    const activate = vi.fn();
    press.pointerDown({ pointerType: "touch", button: 0 }, activate);
    expect(activate).not.toHaveBeenCalled();
    press.click({ detail: 1 }, activate);
    expect(activate).toHaveBeenCalledOnce();
    press.pointerDown({ pointerType: "mouse", button: 2 }, activate);
    expect(activate).toHaveBeenCalledOnce();
  });

  it("handles successive mouse gestures once each and clears a cancelled press", () => {
    const press = new NavigationPressAction();
    const activate = vi.fn();
    for (let i = 0; i < 2; i++) {
      press.pointerDown({ pointerType: "mouse", button: 0 }, activate);
      press.click({ detail: i + 1 }, activate);
    }
    expect(activate).toHaveBeenCalledTimes(2);
    press.cancel();
    press.click({ detail: 1 }, activate);
    expect(activate).toHaveBeenCalledTimes(3);
  });
});
