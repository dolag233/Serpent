/**
 * Shared Arrow/Home/End/Escape navigation for menus and listboxes that use a
 * single focused item (`tabIndex={-1}` roving). Extracted from context-menu
 * patterns for LibrarySwitcher / SortModeControl (Serpent-vvn).
 */

export function queryEnabledRovingItems(
  container: HTMLElement,
  itemSelector: string,
): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(itemSelector),
  ).filter(
    (el) =>
      !(el instanceof HTMLButtonElement && el.disabled) &&
      el.getAttribute("aria-disabled") !== "true",
  );
}

/** Pure index math for Arrow/Home/End over a non-empty list. */
export function resolveRovingTargetIndex(
  key: "ArrowDown" | "ArrowUp" | "Home" | "End",
  currentIdx: number,
  length: number,
): number {
  if (length <= 0) return -1;
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  if (key === "ArrowDown") {
    return currentIdx < 0 ? 0 : (currentIdx + 1) % length;
  }
  return currentIdx <= 0 ? length - 1 : currentIdx - 1;
}

export function focusRovingItemAt(
  items: HTMLElement[],
  index: number,
): HTMLElement | null {
  if (items.length === 0) return null;
  const clamped = ((index % items.length) + items.length) % items.length;
  const target = items[clamped] ?? null;
  target?.focus();
  return target;
}

export function focusFirstRovingItem(
  container: HTMLElement,
  itemSelector: string,
): HTMLElement | null {
  return focusRovingItemAt(
    queryEnabledRovingItems(container, itemSelector),
    0,
  );
}

export type RovingListKeyResult =
  | { handled: false }
  | { handled: true; action: "navigate" | "escape" };

/**
 * Handle ArrowUp/Down, Home, End, and Escape for a roving list.
 * Caller should call `event.preventDefault()` when `handled` is true.
 */
export function handleRovingListKeyDown(input: {
  key: string;
  container: HTMLElement;
  itemSelector: string;
  activeElement?: Element | null;
}): RovingListKeyResult {
  const { key, container, itemSelector } = input;
  if (key === "Escape") return { handled: true, action: "escape" };

  if (key !== "ArrowDown" && key !== "ArrowUp" && key !== "Home" && key !== "End") {
    return { handled: false };
  }

  const items = queryEnabledRovingItems(container, itemSelector);
  if (items.length === 0) return { handled: false };

  const active = input.activeElement ?? document.activeElement;
  const currentIdx = items.indexOf(active as HTMLElement);
  const nextIdx = resolveRovingTargetIndex(key, currentIdx, items.length);
  focusRovingItemAt(items, nextIdx);
  return { handled: true, action: "navigate" };
}

/** Preferred selectors for common ARIA patterns. */
export const ROVING_MENU_ITEM_SELECTOR =
  '[role="menuitem"], [role="menuitemradio"]';

export const ROVING_OPTION_SELECTOR = '[role="option"]';
