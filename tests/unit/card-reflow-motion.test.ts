// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CardReflowMotion, cardReflowLayoutRect } from "../../src/renderer/card-reflow-motion";
import { scheduleAnchorRestore } from "../../src/renderer/canvas-reflow-restore";

describe("card resize reflow motion", () => {
  let root: HTMLDivElement;
  let reduced = false;
  const animation = () => ({ cancel: vi.fn(), finished: new Promise(() => {}) }) as unknown as Animation;
  function card(id: string, rect: DOMRect) {
    const node = document.createElement("button");
    node.className = "asset-card";
    node.dataset.assetId = id;
    node.getBoundingClientRect = () => rect;
    node.animate = vi.fn(animation);
    root.append(node);
    return node;
  }
  beforeEach(() => {
    reduced = false;
    vi.spyOn(window, "matchMedia").mockImplementation(() => ({ matches: reduced }) as MediaQueryList);
    root = document.createElement("div");
    root.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 600);
    document.body.append(root);
  });
  afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

  it("moves a remounted virtual card from its old position and size", () => {
    const motion = new CardReflowMotion();
    const old = card("a", new DOMRect(100, 200, 100, 150));
    motion.capture(root);
    old.remove();
    const next = card("a", new DOMRect(300, 100, 200, 300));
    motion.play(root);
    expect(next.animate).toHaveBeenCalledWith([
      { translate: "-200px 100px", scale: "0.5 0.5", transformOrigin: "0 0" },
      { translate: "0px 0px", scale: "1 1", transformOrigin: "0 0" },
    ], { duration: 200, easing: "cubic-bezier(0.2, 0, 0.2, 1)" });
    expect(next.style.transform).toBe("");
  });

  it("skips offscreen cards, unchanged cards, and newly mounted identities", () => {
    const motion = new CardReflowMotion();
    const offscreen = card("off", new DOMRect(0, 800, 100, 100));
    const unchanged = card("same", new DOMRect(0, 0, 100, 100));
    motion.capture(root);
    offscreen.getBoundingClientRect = () => new DOMRect(0, 200, 100, 100);
    const added = card("new", new DOMRect(100, 0, 100, 100));
    motion.play(root);
    for (const node of [offscreen, unchanged, added]) expect(node.animate).not.toHaveBeenCalled();
  });

  it("captures the current visual position before cancelling interrupted motion", () => {
    const motion = new CardReflowMotion();
    const node = card("a", new DOMRect(100, 0, 100, 100));
    motion.capture(root);
    node.getBoundingClientRect = () => new DOMRect(200, 0, 100, 100);
    motion.play(root);
    const running = vi.mocked(node.animate).mock.results[0]!.value as Animation;
    node.getBoundingClientRect = () => new DOMRect(150, 0, 100, 100);
    motion.capture(root);
    expect(running.cancel).toHaveBeenCalledOnce();
    node.getBoundingClientRect = () => new DOMRect(300, 0, 100, 100);
    motion.play(root);
    expect(vi.mocked(node.animate).mock.calls[1]![0]).toEqual([
      { translate: "-150px 0px", scale: "1 1", transformOrigin: "0 0" },
      { translate: "0px 0px", scale: "1 1", transformOrigin: "0 0" },
    ]);
  });

  it("respects reduced motion and clears pending snapshots on cancel", () => {
    const motion = new CardReflowMotion();
    const node = card("a", new DOMRect(100, 0, 100, 100));
    motion.capture(root);
    node.getBoundingClientRect = () => new DOMRect(200, 0, 100, 100);
    reduced = true;
    motion.play(root);
    expect(node.animate).not.toHaveBeenCalled();
    reduced = false;
    motion.capture(root);
    motion.cancel();
    node.getBoundingClientRect = () => new DOMRect(300, 0, 100, 100);
    motion.play(root);
    expect(node.animate).not.toHaveBeenCalled();
  });

  it("measures unanimated layout while a card is moving and scaling", () => {
    const motion = new CardReflowMotion();
    const node = card("a", new DOMRect(100, 200, 100, 150));
    motion.capture(root);
    node.getBoundingClientRect = () => new DOMRect(300, 100, 200, 300);
    motion.play(root);
    // Halfway through the visual transition: layout is still (300,100,200,300).
    node.getBoundingClientRect = () => new DOMRect(200, 150, 150, 225);
    vi.spyOn(globalThis, "getComputedStyle").mockReturnValue({
      translate: "-100px 50px", scale: "0.75 0.75",
    } as CSSStyleDeclaration);
    const rect = cardReflowLayoutRect(node);
    expect([rect.left, rect.top, rect.width, rect.height]).toEqual([300, 100, 200, 300]);
    motion.cancel();
    expect(cardReflowLayoutRect(node).left).toBe(200);
  });

  it("restores the scroll anchor before motion without chasing animated coordinates", () => {
    const queue: FrameRequestCallback[] = [];
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
      queue.push(callback);
      return queue.length;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
    Object.defineProperties(root, {
      scrollHeight: { value: 4000 }, scrollWidth: { value: 1000 },
      clientHeight: { value: 600 }, clientWidth: { value: 1000 },
    });
    root.scrollTop = 1000;
    const node = card("a", new DOMRect(0, 80, 100, 100));
    const motion = new CardReflowMotion();
    motion.capture(root);
    node.getBoundingClientRect = () => new DOMRect(0, 1500 - root.scrollTop, 200, 200);
    scheduleAnchorRestore(root, {
      assetId: "a", ratioX: 0, ratioY: 0, clientX: 0, clientY: 80,
    }, { current: null }, 0, undefined, { left: 0, top: 1000 }, cardReflowLayoutRect);
    // Compensation happens synchronously, before the first animation frame.
    expect(root.scrollTop).toBe(1420);
    motion.play(root);
    vi.spyOn(globalThis, "getComputedStyle").mockReturnValue({
      translate: "0px 120px", scale: "0.75 0.75",
    } as CSSStyleDeclaration);
    node.getBoundingClientRect = () => new DOMRect(0, 1500 - root.scrollTop + 120, 150, 150);
    while (queue.length) queue.shift()!(0);
    expect(root.scrollTop).toBe(1420);
    motion.cancel();
  });
});
