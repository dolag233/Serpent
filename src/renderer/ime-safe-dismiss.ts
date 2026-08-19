/**
 * IME-safe dismiss helpers (Serpent-fb30ca).
 *
 * Microsoft Pinyin (and other IMEs) fire Escape / focusout / outside-looking
 * pointer events while the composition window is open. App chrome that closes
 * on those events will dismiss mid-keystroke.
 */

const IME_KEY_CODE = 229;

export type ImeKeyboardLike = {
  readonly isComposing?: boolean;
  readonly key?: string;
  readonly keyCode?: number;
  readonly nativeEvent?: ImeKeyboardLike;
};

export function isImeKeyboardEvent(event: ImeKeyboardLike): boolean {
  const native = event.nativeEvent;
  return event.isComposing === true
    || native?.isComposing === true
    || event.key === "Process"
    || native?.key === "Process"
    || event.keyCode === IME_KEY_CODE
    || native?.keyCode === IME_KEY_CODE;
}

export type ImeFocusLike = {
  readonly relatedTarget: EventTarget | null;
};

/**
 * Focus left the page for another HWND (IME candidate, OS chrome) rather
 * than moving to another in-document control.
 */
export function isImeFocusDeparture(event: ImeFocusLike): boolean {
  return event.relatedTarget === null;
}

export function shouldHoldDismissForIme(input: {
  composing?: boolean;
  keyEvent?: ImeKeyboardLike;
  focusEvent?: ImeFocusLike;
}): boolean {
  if (input.composing) return true;
  if (input.keyEvent && isImeKeyboardEvent(input.keyEvent)) return true;
  if (input.focusEvent && isImeFocusDeparture(input.focusEvent)) return true;
  return false;
}

export type CompositionLock = {
  readonly isActive: () => boolean;
  readonly dispose: () => void;
};

export function attachCompositionLock(target: EventTarget = document): CompositionLock {
  let active = false;
  let disposed = false;
  const onStart = () => {
    if (!disposed) active = true;
  };
  const onEnd = () => {
    if (!disposed) active = false;
  };
  const options: AddEventListenerOptions = { capture: true };
  target.addEventListener("compositionstart", onStart, options);
  target.addEventListener("compositionend", onEnd, options);
  return {
    isActive: () => !disposed && active,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      active = false;
      target.removeEventListener("compositionstart", onStart, options);
      target.removeEventListener("compositionend", onEnd, options);
    },
  };
}
