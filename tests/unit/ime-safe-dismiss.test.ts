import { afterEach, describe, expect, it, vi } from "vitest";

import {
  attachCompositionLock,
  IME_CONFIRM_ENTER_WINDOW_MS,
  installImeCompositionGuard,
  isImeFocusDeparture,
  isImeKeyboardEvent,
  shouldHoldDismissForIme,
} from "../../src/renderer/ime-safe-dismiss";

describe("ime-safe-dismiss (Serpent-fb30ca)", () => {
  it("treats composing / Process / keyCode 229 as IME key events", () => {
    expect(isImeKeyboardEvent({ isComposing: true, key: "Escape", keyCode: 27 })).toBe(true);
    expect(isImeKeyboardEvent({ isComposing: false, key: "Process", keyCode: 229 })).toBe(true);
    expect(isImeKeyboardEvent({ isComposing: false, key: "a", keyCode: 229 })).toBe(true);
    expect(isImeKeyboardEvent({ isComposing: false, key: "Escape", keyCode: 27 })).toBe(false);
  });

  it("treats a null relatedTarget as IME/OS focus departure", () => {
    expect(isImeFocusDeparture({ relatedTarget: null })).toBe(true);
    expect(isImeFocusDeparture({ relatedTarget: {} as EventTarget })).toBe(false);
  });

  it("holds dismiss while composing or during IME focus loss", () => {
    expect(shouldHoldDismissForIme({ composing: true })).toBe(true);
    expect(
      shouldHoldDismissForIme({
        keyEvent: { isComposing: true, key: "Escape", keyCode: 27 },
      }),
    ).toBe(true);
    expect(shouldHoldDismissForIme({ focusEvent: { relatedTarget: null } })).toBe(true);
    expect(
      shouldHoldDismissForIme({
        composing: false,
        keyEvent: { isComposing: false, key: "Escape", keyCode: 27 },
        focusEvent: { relatedTarget: {} as EventTarget },
      }),
    ).toBe(false);
  });

  it("tracks compositionstart/end on a target", () => {
    const target = new EventTarget();
    const lock = attachCompositionLock(target);
    expect(lock.isActive()).toBe(false);
    target.dispatchEvent(new Event("compositionstart"));
    expect(lock.isActive()).toBe(true);
    target.dispatchEvent(new Event("compositionend"));
    expect(lock.isActive()).toBe(false);
    lock.dispose();
    target.dispatchEvent(new Event("compositionstart"));
    expect(lock.isActive()).toBe(false);
  });
});

function enterKey(isComposing = false): Event {
  const event = new Event("keydown", { cancelable: true });
  Object.defineProperties(event, {
    key: { value: "Enter" },
    keyCode: { value: isComposing ? 229 : 13 },
    isComposing: { value: isComposing },
  });
  return event;
}

describe("ime confirm Enter", () => {
  let uninstall = () => {};

  afterEach(() => {
    uninstall();
    uninstall = () => {};
    vi.restoreAllMocks();
  });

  it("treats the Enter that arrives immediately after compositionend as IME", () => {
    const target = new EventTarget();
    uninstall = installImeCompositionGuard(target);
    target.dispatchEvent(new Event("compositionend"));
    expect(isImeKeyboardEvent({
      isComposing: false,
      key: "Enter",
      keyCode: 13,
    })).toBe(true);
    expect(isImeKeyboardEvent({
      isComposing: false,
      key: "a",
      keyCode: 65,
    })).toBe(false);
  });

  it("lets a later Enter commit", () => {
    const target = new EventTarget();
    const endedAt = 1_000;
    vi.spyOn(performance, "now").mockReturnValue(endedAt);
    uninstall = installImeCompositionGuard(target);
    target.dispatchEvent(new Event("compositionend"));
    vi.spyOn(performance, "now").mockReturnValue(endedAt + IME_CONFIRM_ENTER_WINDOW_MS + 1);
    expect(isImeKeyboardEvent({
      isComposing: false,
      key: "Enter",
      keyCode: 13,
    })).toBe(false);
  });

  it("swallows only the post-composition Enter before other listeners", () => {
    const target = new EventTarget();
    uninstall = installImeCompositionGuard(target);
    const seen: string[] = [];
    target.addEventListener("keydown", (event) => {
      seen.push((event as Event & { key: string }).key);
    }, true);
    target.dispatchEvent(new Event("compositionend"));
    const confirming = enterKey();
    target.dispatchEvent(confirming);
    expect(confirming.defaultPrevented).toBe(true);
    expect(seen).toEqual([]);

    const endedAt = performance.now();
    vi.spyOn(performance, "now").mockReturnValue(endedAt + IME_CONFIRM_ENTER_WINDOW_MS + 1);
    const committing = enterKey();
    target.dispatchEvent(committing);
    expect(committing.defaultPrevented).toBe(false);
    expect(seen).toEqual(["Enter"]);
  });

  it("does not swallow Enter while composition is still active", () => {
    const target = new EventTarget();
    uninstall = installImeCompositionGuard(target);
    target.dispatchEvent(new Event("compositionend"));
    const seen: string[] = [];
    target.addEventListener("keydown", () => {
      seen.push("keydown");
    }, true);
    target.dispatchEvent(enterKey(true));
    expect(seen).toEqual(["keydown"]);
  });
});
