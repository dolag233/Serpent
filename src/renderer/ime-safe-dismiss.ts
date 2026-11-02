/**
 * IME-safe dismiss helpers (Serpent-fb30ca).
 *
 * Microsoft Pinyin (and other IMEs) fire Escape / focusout / outside-looking
 * pointer events while the composition window is open. App chrome that closes
 * on those events will dismiss mid-keystroke.
 *
 * Japanese and Korean IMEs confirm a conversion with Enter. On macOS that
 * keydown can arrive after `compositionend`, with `isComposing` already false
 * and `keyCode` 13. Treat that immediate Enter as part of the conversion, not
 * as a commit. A later Enter still commits. Call `installImeCompositionGuard`
 * once at renderer startup so every field gets this, including ones whose own
 * key handler forgets the check.
 */

const IME_KEY_CODE = 229;

/** Same physical Enter as compositionend; longer than the observed 0–9ms gap. */
export const IME_CONFIRM_ENTER_WINDOW_MS = 50;

export type ImeKeyboardLike = {
  readonly isComposing?: boolean;
  readonly key?: string;
  readonly code?: string;
  readonly keyCode?: number;
  readonly nativeEvent?: ImeKeyboardLike;
};

function isActiveImeKey(event: ImeKeyboardLike): boolean {
  const native = event.nativeEvent;
  return event.isComposing === true
    || native?.isComposing === true
    || event.key === "Process"
    || native?.key === "Process"
    || event.keyCode === IME_KEY_CODE
    || native?.keyCode === IME_KEY_CODE;
}

function isEnterKey(event: ImeKeyboardLike): boolean {
  const native = event.nativeEvent;
  return event.key === "Enter"
    || native?.key === "Enter"
    || event.code === "NumpadEnter"
    || native?.code === "NumpadEnter";
}

let compositionEndedAt = Number.NEGATIVE_INFINITY;
let installedGuards = 0;

function isPostCompositionConfirmEnter(
  event: ImeKeyboardLike,
  now = performance.now(),
): boolean {
  if (!isEnterKey(event) || isActiveImeKey(event)) return false;
  if (!Number.isFinite(compositionEndedAt)) return false;
  const elapsed = now - compositionEndedAt;
  return elapsed >= 0 && elapsed <= IME_CONFIRM_ENTER_WINDOW_MS;
}

export function isImeKeyboardEvent(event: ImeKeyboardLike): boolean {
  return isActiveImeKey(event) || isPostCompositionConfirmEnter(event);
}

const guardedTargets = new WeakSet<EventTarget>();

/**
 * Record composition end and swallow the Enter that only confirms the
 * conversion. Active composition keydowns are left alone so the IME still
 * receives them.
 */
export function installImeCompositionGuard(target?: EventTarget): () => void {
  const view = target ?? globalThis.window;
  if (!view || guardedTargets.has(view)) return () => {};
  guardedTargets.add(view);
  installedGuards += 1;
  const onCompositionEnd = () => {
    compositionEndedAt = performance.now();
  };
  const onKeyDown = (event: Event) => {
    if (!isPostCompositionConfirmEnter(event as ImeKeyboardLike)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  view.addEventListener("compositionend", onCompositionEnd, true);
  view.addEventListener("keydown", onKeyDown, true);
  return () => {
    if (!guardedTargets.has(view)) return;
    guardedTargets.delete(view);
    view.removeEventListener("compositionend", onCompositionEnd, true);
    view.removeEventListener("keydown", onKeyDown, true);
    installedGuards -= 1;
    if (installedGuards === 0) compositionEndedAt = Number.NEGATIVE_INFINITY;
  };
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
