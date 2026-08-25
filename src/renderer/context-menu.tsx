import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useT } from "./i18n";
import { isImeKeyboardEvent } from "./ime-safe-dismiss";
import { MenuSurface, resolveMenuNodes } from "./ui/patterns";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ContextMenuDescriptor =
  | {
      type: "asset";
      assetId: string;
      displayName: string;
      locationKind: "managed" | "linked";
      isAvailable: boolean;
      isDeleted: boolean;
    }
  | {
      // Collections only. Tags were removed from the sidebar (REQ-TAG-001),
      // so the organization menu no longer has a tag branch.
      type: "organization";
      id: string;
      name: string;
    }
  | {
      type: "smart-collection";
      id: string;
      name: string;
    }
  | {
      // Directory-tree folders, managed and linked. Managed folders also
      // expose create/rename; linked roots reach rules + remove-from-library.
      // Linked child paths (relativePath set) use trash / disk-delete like
      // managed (clarification #7). Offline linked roots disable path actions.
      type: "folder";
      folderId: string;
      name: string;
      locationKind: "managed" | "linked";
      /** Linked folders only: whether the external root is reachable. */
      status?: "available" | "offline";
      /**
       * Linked child directory relative to the linked root. Absent/undefined
       * means a linked root (or any managed folder).
       */
      linkedRelativePath?: string;
    }
  | {
      type: "multi-asset";
      assetIds: string[];
      /** Canvas folder cards in the same multi/mixed selection (Serpent-koy). */
      folderIds?: string[];
      count: number;
    }
  | {
      /** Workspace canvas empty-area context menu (PLUGIN-015). */
      type: "workspace";
      /** Current asset selection when the menu opens; omitted when empty. */
      assetIds?: string[];
    }
  | {
      /** Sidebar trash row context menu (Serpent-gaoi). */
      type: "trash";
    }
  | {
      /** Deleted managed-folder tombstone in trash browse (Serpent-qufh). */
      type: "trashed-folder";
      tombstoneId: string;
      name: string;
      relativePath: string;
    };

interface ContextMenuContextValue {
  active: { descriptor: ContextMenuDescriptor; position: { x: number; y: number } } | null;
  open: (descriptor: ContextMenuDescriptor, position: { x: number; y: number }) => void;
  close: () => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ContextMenuContext = createContext<ContextMenuContextValue | null>(null);

// Only one submenu may own the floating submenu surface at a time. Pointer
// leave keeps a short grace period so the pointer can cross the gap, but a
// new hover must close the previous submenu synchronously instead of waiting
// for that timer and briefly rendering two panels.
let activeSubmenuClose: (() => void) | null = null;
const CONTEXT_MENU_SURFACE_NODES = resolveMenuNodes([
  { id: "context-menu-content", kind: "separator" as const },
]);

export function useContextMenu() {
  const ctx = useContext(ContextMenuContext);
  if (!ctx) throw new Error("useContextMenu must be used within a <ContextMenuProvider>");
  return ctx;
}

export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ContextMenuContextValue["active"]>(null);

  const open = useCallback(
    (descriptor: ContextMenuDescriptor, position: { x: number; y: number }) => {
      setActive({ descriptor, position });
    },
    [],
  );

  const close = useCallback(() => {
    setActive(null);
  }, []);

  const value = useMemo<ContextMenuContextValue>(
    () => ({ active, open, close }),
    [active, open, close],
  );

  return <ContextMenuContext.Provider value={value}>{children}</ContextMenuContext.Provider>;
}

// ---------------------------------------------------------------------------
// ContextMenuBackdrop — full-screen fixed overlay that captures all close events
// ---------------------------------------------------------------------------

export function ContextMenuBackdrop({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose?: () => void;
}) {
  const { close } = useContextMenu();

  // Single close entry point
  const dismiss = useCallback(() => {
    (onClose ?? close)();
  }, [onClose, close]);

  // Outside-click detection via document-level mousedown (capture phase).
  // The backdrop has pointer-events:none so clicks pass through to elements
  // underneath; this listener detects when the click target is NOT inside
  // the context-menu element and dismisses.
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      const menus = Array.from(document.querySelectorAll<HTMLElement>(".context-menu"));
      const target = e.target;
      if (
        menus.length > 0 &&
        (!(target instanceof Node) || !menus.some((menu) => menu.contains(target)))
      ) {
        dismiss();
      }
    };
    document.addEventListener("mousedown", handleMouseDown, true);
    return () => document.removeEventListener("mousedown", handleMouseDown, true);
  }, [dismiss]);

  // Escape key (document-level, capture phase)
  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (isImeKeyboardEvent(e)) return;
      if (e.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => document.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [dismiss]);

  // Scroll (document-level, capture phase — catches canvas, nav, and any other
  // scroll). Scrolls that originate INSIDE the menu itself (e.g. the tag
  // picker's own scrollable option list, including programmatic scrollIntoView
  // from keyboard navigation) must not dismiss it; only scrolls from outside
  // regions (canvas, nav, document) signal the user has moved on.
  useEffect(() => {
    const handleScroll = (e: Event) => {
      const menus = Array.from(document.querySelectorAll<HTMLElement>(".context-menu"));
      const target = e.target;
      if (
        menus.length > 0 &&
        target instanceof Node &&
        menus.some((menu) => menu.contains(target))
      ) {
        return;
      }
      dismiss();
    };
    document.addEventListener("scroll", handleScroll, { capture: true, passive: true });
    return () => document.removeEventListener("scroll", handleScroll, { capture: true });
  }, [dismiss]);

  // Window resize
  useEffect(() => {
    window.addEventListener("resize", dismiss);
    return () => window.removeEventListener("resize", dismiss);
  }, [dismiss]);

  // Window blur (app switching)
  useEffect(() => {
    window.addEventListener("blur", dismiss);
    return () => window.removeEventListener("blur", dismiss);
  }, [dismiss]);

  return (
    <div className="context-menu-backdrop">
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ContextMenu — the menu panel with viewport clamp/flip and keyboard navigation
// ---------------------------------------------------------------------------

export function ContextMenu({
  children,
  ariaLabel,
  position,
}: {
  children: ReactNode;
  ariaLabel: string;
  position: { x: number; y: number };
}) {
  const { close } = useContextMenu();
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const [keyboardNavigationActive, setKeyboardNavigationActive] = useState(false);
  const initialFocusPendingRef = useRef(true);
  const pointerFocusFrameRef = useRef<number | null>(null);

  // Start hidden + off-screen so we can measure before painting
  const [style, setStyle] = useState<CSSProperties>({
    position: "fixed",
    left: -9999,
    top: -9999,
    visibility: "hidden",
  });

  useLayoutEffect(() => {
    const applyPosition = () => {
      const menu = document.getElementById(menuId);
      if (!(menu instanceof HTMLDivElement)) return;

      const rect = menu.getBoundingClientRect();
      // The document client box is the renderer's usable viewport. During an
      // Electron window resize `innerHeight` can briefly describe the outer
      // BrowserWindow bounds, which would place a tall menu below the page.
      const vw = document.documentElement.clientWidth || window.innerWidth;
      const vh = document.documentElement.clientHeight || window.innerHeight;
      const gap = 4; // minimum px from viewport edge

      let left = position.x;
      let top = position.y;

      // Clamp right edge — if menu overflows right, flip so right edge aligns to cursor
      if (left + rect.width > vw - gap) {
        left = position.x - rect.width;
      }
      // A context-menu request can originate from a scrolled item whose client
      // coordinate is already outside the viewport. Flipping alone is not
      // enough in that case; clamp the final box so every item remains reachable.
      left = Math.min(Math.max(left, gap), Math.max(gap, vw - rect.width - gap));

      // Clamp bottom edge — if menu overflows bottom, flip above cursor
      if (top + rect.height > vh - gap) {
        top = position.y - rect.height;
      }
      top = Math.min(Math.max(top, gap), Math.max(gap, vh - rect.height - gap));

      // This is a layout effect, so commit both the measured position and
      // visibility before the browser can paint. The bootstrap box stays hidden
      // until it is positioned, so a fast pointer cannot target the canvas while
      // the menu is still at -9999px.
      // Keep the final bounds expressed in CSS as well as in the measured
      // numbers. BrowserWindow/DevTools viewport changes can happen between
      // the layout effect and the next paint; `min/max` then re-clamp the
      // already-positioned surface without waiting for a React resize pass.
      setStyle({
        position: "fixed",
        left: `max(${gap}px, min(${left}px, calc(100vw - ${rect.width + gap}px)))`,
        top: `max(${gap}px, min(${top}px, calc(100vh - ${rect.height + gap}px)))`,
        visibility: "visible",
      });
    };

    applyPosition();
    // BrowserWindow sizing can settle one frame after the menu is mounted.
    // Re-measure then as well so a menu opened during that transition cannot
    // retain coordinates computed against the old viewport height.
    const raf = requestAnimationFrame(applyPosition);
    const timer = window.setTimeout(applyPosition, 0);
    window.addEventListener("resize", applyPosition);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      window.removeEventListener("resize", applyPosition);
    };
  }, [menuId, position.x, position.y]);

  // Keep the single focused highlight aligned with the pointer from the
  // first rendered frame; fall back to the first enabled item for keyboard use.
  useEffect(() => {
    const menu = document.getElementById(menuId);
    if (!(menu instanceof HTMLDivElement)) return;
    // Small delay to ensure DOM is settled after layout adjustment
    const raf = requestAnimationFrame(() => {
      const items = Array.from(
        menu.querySelectorAll<HTMLElement>(
          '[role="menuitem"]:not([aria-disabled="true"])',
        ),
      );
      const first = items[0];
      if (!first) return;
      if (!initialFocusPendingRef.current) return;

      // Pointer/mouse focus can arrive before this post-mount frame. Keep the
      // user's menu-item focus instead of treating the menu as untouched and
      // moving focus back to the item under the opening point.
      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLElement &&
        menu.contains(activeElement) &&
        activeElement.matches('[role="menuitem"]:not([aria-disabled="true"])')
      ) {
        initialFocusPendingRef.current = false;
        return;
      }

      initialFocusPendingRef.current = false;
      const underPointer = document.elementFromPoint(position.x, position.y);
      const pointedItem = underPointer?.closest<HTMLElement>(
        '[role="menuitem"]:not([aria-disabled="true"])',
      );
      (pointedItem && menu.contains(pointedItem) ? pointedItem : first).focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [menuId, position.x, position.y]);

  useEffect(
    () => () => {
      if (pointerFocusFrameRef.current !== null) {
        cancelAnimationFrame(pointerFocusFrameRef.current);
        pointerFocusFrameRef.current = null;
      }
    },
    [],
  );

  // Arrow-key navigation + Escape within menu
  const handleMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // On Windows IME layouts Chromium may expose ArrowDown as key=Process
    // while preserving the physical direction in `code`.  Keep navigation
    // working in that case; composition protection still applies to all
    // non-navigation keys.
    const navigationKey = ["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)
      ? e.key
      : ["ArrowDown", "ArrowUp", "Home", "End"].includes(e.code)
        ? e.code
        : undefined;
    if (!navigationKey && isImeKeyboardEvent(e.nativeEvent)) return;
    const menu = e.currentTarget;
    initialFocusPendingRef.current = false;
    // A pointer hover may have queued a post-commit focus reassertion. Once
    // the user presses a navigation key, that queued pointer action is stale
    // and must not steal focus back from the keyboard target.
    if (pointerFocusFrameRef.current !== null) {
      cancelAnimationFrame(pointerFocusFrameRef.current);
      pointerFocusFrameRef.current = null;
    }

    const items = Array.from(
      menu.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).filter((el) => el.getAttribute("aria-disabled") !== "true");
    if (items.length === 0) return;
    if (navigationKey) {
      setKeyboardNavigationActive(true);
    }

    const currentIdx = items.indexOf(document.activeElement as HTMLElement);

    if (navigationKey === "ArrowDown") {
      e.preventDefault();
      const next = currentIdx < 0 ? 0 : (currentIdx + 1) % items.length;
      items[next]?.focus();
    } else if (navigationKey === "ArrowUp") {
      e.preventDefault();
      const prev =
        currentIdx <= 0 ? items.length - 1 : (currentIdx - 1 + items.length) % items.length;
      items[prev]?.focus();
    } else if (navigationKey === "Home") {
      e.preventDefault();
      items[0]?.focus();
    } else if (navigationKey === "End") {
      e.preventDefault();
      items[items.length - 1]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  // Keep a native fallback alongside React's delegated handler.  Electron's
  // Windows keyboard bridge can deliver an arrow key to the focused menu item
  // without replaying it through the React root; the native listener preserves
  // the same focus and visual-modality contract in that case.
  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const handleNativeKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !menu.contains(active)) return;
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        (event.target instanceof HTMLElement && event.target.isContentEditable)
      ) return;
      const key = ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
        ? event.key
        : ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.code)
          ? event.code
          : undefined;
      if (!key) return;
      const items = Array.from(
        menu.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ).filter((item) => item.getAttribute("aria-disabled") !== "true");
      if (items.length === 0) return;
      event.preventDefault();
      setKeyboardNavigationActive(true);
      const current = items.indexOf(active);
      if (key === "ArrowDown") {
        items[current < 0 ? 0 : (current + 1) % items.length]?.focus();
      } else if (key === "ArrowUp") {
        items[current <= 0 ? items.length - 1 : (current - 1 + items.length) % items.length]?.focus();
      } else if (key === "Home") {
        items[0]?.focus();
      } else {
        items[items.length - 1]?.focus();
      }
    };
    menu.addEventListener("keydown", handleNativeKeyDown);
    return () => menu.removeEventListener("keydown", handleNativeKeyDown);
  }, []);

  const schedulePointerFocus = (clientX: number, clientY: number, fallback: HTMLElement | null) => {
    // Focus synchronously for the event that caused the hover. The animation
    // frame below is only a post-commit reassertion; relying on the frame alone
    // lets a React commit or a native menu focus transition win the race.
    if (fallback?.isConnected) fallback.focus({ preventScroll: true });
    if (pointerFocusFrameRef.current !== null) {
      cancelAnimationFrame(pointerFocusFrameRef.current);
    }
    pointerFocusFrameRef.current = requestAnimationFrame(() => {
      pointerFocusFrameRef.current = null;
      const menu = document.getElementById(menuId);
      if (!(menu instanceof HTMLDivElement)) return;
      const pointed = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>(
        '[role="menuitem"]:not([aria-disabled="true"])',
      );
      const item = pointed && menu.contains(pointed) ? pointed : fallback;
      if (item?.isConnected && menu.contains(item)) item.focus({ preventScroll: true });
    });
  };

  return (
    <MenuSurface
      className={`context-menu${keyboardNavigationActive ? " is-keyboard-navigation" : ""}`}
      aria-label={ariaLabel}
      id={menuId}
      nodes={CONTEXT_MENU_SURFACE_NODES}
      ref={menuRef}
      renderNode={() => <>{children}</>}
      style={style}
      // Capture navigation before a menu item or nested control can stop the
      // event, keeping keyboard mode deterministic after pointer focus.
      onKeyDownCapture={handleMenuKeyDown}
      onPointerMoveCapture={(event) => {
        const target = event.target;
        const item = target instanceof Element
          ? target.closest<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')
          : null;
        if (!item || !event.currentTarget.contains(item)) return;
        initialFocusPendingRef.current = false;
        setKeyboardNavigationActive(false);
        if (pointerFocusFrameRef.current !== null) {
          cancelAnimationFrame(pointerFocusFrameRef.current);
          pointerFocusFrameRef.current = null;
        }
        item.focus({ preventScroll: true });
      }}
      onMouseMoveCapture={(event) => {
        const target = event.target;
        const item = target instanceof Element
          ? target.closest<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')
          : null;
        if (!item || !event.currentTarget.contains(item)) return;
        initialFocusPendingRef.current = false;
        setKeyboardNavigationActive(false);
        if (pointerFocusFrameRef.current !== null) {
          cancelAnimationFrame(pointerFocusFrameRef.current);
          pointerFocusFrameRef.current = null;
        }
        item.focus({ preventScroll: true });
      }}
      onPointerMove={(event) => {
        initialFocusPendingRef.current = false;
        setKeyboardNavigationActive(false);

        // Pointer movement out of keyboard mode updates the menu class. That
        // React commit can happen after the child button's synchronous focus
        // handler; restore focus on the next frame so the class transition
        // cannot leave the hovered item unfocused (notably after ArrowDown).
        const target = event.target;
        const item = target instanceof Element
          ? target.closest<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')
          : null;
        if (!item || !event.currentTarget.contains(item)) return;
        schedulePointerFocus(event.clientX, event.clientY, item);
      }}
      onMouseMove={(event) => {
        const target = event.target;
        const item = target instanceof Element
          ? target.closest<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')
          : null;
        if (!item || !event.currentTarget.contains(item)) return;
        schedulePointerFocus(event.clientX, event.clientY, item);
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// ContextMenuItem
// ---------------------------------------------------------------------------

export function ContextMenuItem({
  icon,
  label,
  shortcut,
  danger = false,
  disabled = false,
  checked,
  disabledReason,
  onAction,
}: {
  icon?: ReactNode;
  label: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  checked?: boolean;
  disabledReason?: string;
  onAction: () => void;
}) {
  const { close } = useContextMenu();
  const t = useT();
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleClick = () => {
    if (disabled) return;
    onAction();
    close();
  };

  const handleMouseEnter = () => {
    if (!disabled) buttonRef.current?.focus();
  };
  const handleMouseOver = () => {
    // Chromium/Electron can deliver Playwright/native hover as mouseover
    // without a mouseenter when the pointer crosses a nested label/span.
    // Keep the row focus invariant on both paths.
    if (!disabled) buttonRef.current?.focus({ preventScroll: true });
  };
  const handlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!disabled && event.currentTarget !== document.activeElement) {
      event.currentTarget.focus();
    }
  };

  return (
    <button
      ref={buttonRef}
      className={`context-menu-item${danger ? " is-danger" : ""}${disabled ? " is-disabled" : ""}`}
      role={checked === undefined ? "menuitem" : "menuitemcheckbox"}
      tabIndex={-1}
      type="button"
      aria-disabled={disabled || undefined}
      aria-checked={checked}
      aria-label={
        disabled && disabledReason
          ? t("common.unavailableSuffix", { label, disabledReason })
          : label
      }
      title={disabled && disabledReason ? disabledReason : undefined}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseOver={handleMouseOver}
      onPointerEnter={handlePointerMove}
      onPointerMove={handlePointerMove}
    >
      {icon && <span className="context-menu-item-icon">{icon}</span>}
      <span className="context-menu-item-label">{label}</span>
      {shortcut && <span className="context-menu-item-shortcut">{shortcut}</span>}
    </button>
  );
}

/** A Windows-style submenu that opens as soon as the pointer hovers its row. */
export type ContextMenuSubmenuChildren =
  | ReactNode
  | ((close: () => void) => ReactNode);

export function ContextMenuSubmenu({
  icon,
  label,
  disabled = false,
  children,
}: {
  icon?: ReactNode;
  label: string;
  disabled?: boolean;
  children: ContextMenuSubmenuChildren;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const [positioned, setPositioned] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);
  const openRef = useRef(false);
  const suppressFocusOpenRef = useRef(false);

  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);
  const closeImmediately = useCallback(() => {
    cancelClose();
    openRef.current = false;
    setOpen(false);
  }, [cancelClose]);
  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      openRef.current = false;
      setOpen(false);
    }, 140);
  }, [cancelClose]);
  const scheduleCloseFromBoundary = useCallback(
    (relatedTarget: EventTarget | null) => {
      // The submenu is portaled to document.body, so it is no longer a DOM
      // descendant of the trigger. Treat crossing between the trigger and its
      // floating panel as staying inside the same hover region; otherwise the
      // trigger's mouseleave timer closes the panel before it can be clicked.
      if (
        relatedTarget instanceof Node &&
        (triggerRef.current?.contains(relatedTarget) ||
          submenuRef.current?.contains(relatedTarget))
      ) {
        cancelClose();
        return;
      }
      scheduleClose();
    },
    [cancelClose, scheduleClose],
  );
  const closeSubmenu = useCallback(() => {
    closeImmediately();
    if (activeSubmenuClose === closeImmediately) activeSubmenuClose = null;
    suppressFocusOpenRef.current = true;
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, [closeImmediately]);
  const openSubmenu = useCallback((focusInput = false) => {
    if (disabled) return;
    if (suppressFocusOpenRef.current) {
      suppressFocusOpenRef.current = false;
      return;
    }
    if (openRef.current) {
      cancelClose();
      if (focusInput) {
        window.setTimeout(() => {
          submenuRef.current?.querySelector<HTMLElement>("input")?.focus();
        }, 0);
      }
      return;
    }
    if (activeSubmenuClose && activeSubmenuClose !== closeImmediately) {
      activeSubmenuClose();
    }
    activeSubmenuClose = closeImmediately;
    cancelClose();
    openRef.current = true;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const width = 248;
      // Keep the floating panel flush with the trigger. A visible gap lets
      // pointer events fall through to the asset grid while the cursor
      // crosses over, which exposes the grid's grab cursor and closes the
      // submenu before it can be clicked.
      const left = rect.right + width <= window.innerWidth
        ? rect.right
        : Math.max(0, rect.left - width);
      const top = Math.min(
        Math.max(4, rect.top),
        Math.max(4, window.innerHeight - 360),
      );
      setPosition({ left, top });
    }
    setPositioned(false);
    setOpen(true);
    // Native click handling can restore focus to the trigger after React
    // commits the portal. Give searchable submenus one post-click focus pass
    // so their input remains the active control.
    if (focusInput) {
      window.setTimeout(() => {
        submenuRef.current?.querySelector<HTMLElement>("input")?.focus();
      }, 0);
    }
  }, [cancelClose, closeImmediately, disabled]);

  useEffect(() => {
    if (!open) return;

    const reposition = () => {
      const submenu = submenuRef.current;
      const trigger = triggerRef.current?.getBoundingClientRect();
      if (!submenu || !trigger) return false;

      const rect = submenu.getBoundingClientRect();

      const viewportGap = 4;
      const left =
        trigger.right + rect.width <= window.innerWidth - viewportGap
          ? trigger.right
          : Math.max(viewportGap, trigger.left - rect.width);
      const top = Math.min(
        Math.max(viewportGap, trigger.top),
        Math.max(viewportGap, window.innerHeight - rect.height - viewportGap),
      );

      setPosition((current) =>
        current.left === left && current.top === top ? current : { left, top },
      );
      setPositioned(true);
      return true;
    };

    // The picker contents (especially a long tag list) can settle one frame
    // after the submenu mounts. Measure after layout and keep the panel
    // anchored if its height changes while filtering or loading data.
    const observer = new ResizeObserver(() => {
      reposition();
    });
    const frame = window.requestAnimationFrame(() => {
      if (reposition() && submenuRef.current) {
        observer.observe(submenuRef.current);
      }
    });
    const handleResize = () => reposition();
    window.addEventListener("resize", handleResize);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", handleResize);
    };
  }, [open]);

  useEffect(
    () => () => {
      if (activeSubmenuClose === closeImmediately) activeSubmenuClose = null;
      cancelClose();
    },
    [cancelClose, closeImmediately],
  );

  const submenu = open
    ? createPortal(
        <div
          aria-label={label}
          className="context-menu context-menu-submenu"
          ref={submenuRef}
          role="menu"
          style={{
            left: position.left,
            top: position.top,
            visibility: positioned ? "visible" : "hidden",
          }}
          onMouseEnter={cancelClose}
          onMouseLeave={(event) => scheduleCloseFromBoundary(event.relatedTarget)}
        >
          {/* The render prop receives an event callback; it is not invoked here. */}
          {/* eslint-disable-next-line react-hooks/refs */}
          {typeof children === "function" ? children(closeSubmenu) : children}
        </div>,
        document.body,
      )
    : null;

  return (
    <div
      className="context-menu-submenu-trigger"
      onMouseEnter={() => {
        if (!disabled) triggerRef.current?.focus();
        openSubmenu(false);
      }}
      onPointerMove={() => {
        if (!disabled && triggerRef.current !== document.activeElement) {
          triggerRef.current?.focus();
        }
      }}
      onMouseLeave={(event) => scheduleCloseFromBoundary(event.relatedTarget)}
    >
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-disabled={disabled || undefined}
        aria-label={label}
        className={`context-menu-item${disabled ? " is-disabled" : ""}`}
        ref={triggerRef}
        role="menuitem"
        tabIndex={-1}
        type="button"
        onClick={() => openSubmenu(true)}
        onFocus={() => openSubmenu(false)}
      >
        {icon && <span className="context-menu-item-icon">{icon}</span>}
        <span className="context-menu-item-label">{label}</span>
        <span className="context-menu-item-shortcut" aria-hidden="true">
          <span className="context-menu-submenu-chevron">›</span>
        </span>
      </button>
      {submenu}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ContextMenuSection — grouping with optional divider label
// ---------------------------------------------------------------------------

export function ContextMenuSection({
  label,
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  return (
    <div className="context-menu-section" role="group" aria-label={label}>
      {label && <div className="context-menu-section-label">{label}</div>}
      {children}
    </div>
  );
}
