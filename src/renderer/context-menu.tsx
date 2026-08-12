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
  const [keyboardNavigationActive, setKeyboardNavigationActive] = useState(false);
  const initialFocusPendingRef = useRef(true);

  // Start hidden + off-screen so we can measure before painting
  const [style, setStyle] = useState<CSSProperties>({
    position: "fixed",
    left: -9999,
    top: -9999,
    visibility: "hidden",
  });

  useLayoutEffect(() => {
    const menu = document.getElementById(menuId);
    if (!(menu instanceof HTMLDivElement)) return;

    const rect = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 4; // minimum px from viewport edge

    let left = position.x;
    let top = position.y;

    // Clamp right edge — if menu overflows right, flip so right edge aligns to cursor
    if (left + rect.width > vw - gap) {
      left = position.x - rect.width;
      // If that still overflows left, pin to left edge
      if (left < gap) left = gap;
    }
    // Ensure not left of viewport
    if (left < gap) left = gap;

    // Clamp bottom edge — if menu overflows bottom, flip above cursor
    if (top + rect.height > vh - gap) {
      top = position.y - rect.height;
      // If that still overflows top, pin to top edge
      if (top < gap) top = gap;
    }
    // Ensure not above viewport
    if (top < gap) top = gap;

    // This is a layout effect, so commit the measured position before the
    // browser can paint. Delaying visibility by one animation frame leaves a
    // newly opened menu at -9999px long enough for a fast pointer action to
    // miss it and hit the underlying canvas instead.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- layout measurement must commit before paint
    setStyle({ position: "fixed", left, top });
  }, [menuId, position]);

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
  }, [menuId, position]);

  // Arrow-key navigation + Escape within menu
  const handleMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const menu = e.currentTarget;
    initialFocusPendingRef.current = false;

    const items = Array.from(
      menu.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).filter((el) => el.getAttribute("aria-disabled") !== "true");
    if (items.length === 0) return;
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      setKeyboardNavigationActive(true);
    }

    const currentIdx = items.indexOf(document.activeElement as HTMLElement);

    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = currentIdx < 0 ? 0 : (currentIdx + 1) % items.length;
      items[next]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev =
        currentIdx <= 0 ? items.length - 1 : (currentIdx - 1 + items.length) % items.length;
      items[prev]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  return (
    <MenuSurface
      className={`context-menu${keyboardNavigationActive ? " is-keyboard-navigation" : ""}`}
      aria-label={ariaLabel}
      id={menuId}
      nodes={CONTEXT_MENU_SURFACE_NODES}
      renderNode={() => <>{children}</>}
      style={style}
      onKeyDown={handleMenuKeyDown}
      onPointerMove={() => {
        initialFocusPendingRef.current = false;
        setKeyboardNavigationActive(false);
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
