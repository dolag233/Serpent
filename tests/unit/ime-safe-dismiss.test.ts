import { describe, expect, it } from "vitest";

import {
  attachCompositionLock,
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
