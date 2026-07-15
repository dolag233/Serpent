import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";

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
      type: "organization";
      orgKind: "tag" | "collection";
      id: string;
      name: string;
    }
  | {
      type: "smart-collection";
      id: string;
      name: string;
    }
  | {
      type: "multi-asset";
      assetIds: string[];
      count: number;
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
      const menu = document.querySelector(".context-menu");
      if (menu && !menu.contains(e.target as Node)) {
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

  // Scroll (document-level, capture phase — catches canvas, nav, and any other scroll)
  useEffect(() => {
    document.addEventListener("scroll", dismiss, { capture: true, passive: true });
    return () => document.removeEventListener("scroll", dismiss, { capture: true });
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
  const menuRef = useRef<HTMLDivElement>(null);

  // Start hidden + off-screen so we can measure before painting
  const [style, setStyle] = useState<CSSProperties>({
    position: "fixed",
    left: -9999,
    top: -9999,
    visibility: "hidden",
  });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;

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

    setStyle({ position: "fixed", left, top });
  }, [position]);

  // Auto-focus first menuitem on mount
  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    // Small delay to ensure DOM is settled after layout adjustment
    const raf = requestAnimationFrame(() => {
      const first = menu.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])');
      first?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  // Arrow-key navigation + Escape within menu
  const handleMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const menu = menuRef.current;
    if (!menu) return;

    const items = Array.from(
      menu.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).filter((el) => el.getAttribute("aria-disabled") !== "true");
    if (items.length === 0) return;

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
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  return (
    <div
      ref={menuRef}
      className="context-menu"
      role="menu"
      aria-label={ariaLabel}
      style={style}
      onKeyDown={handleMenuKeyDown}
    >
      {children}
    </div>
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
  disabledReason,
  onAction,
}: {
  icon?: ReactNode;
  label: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onAction: () => void;
}) {
  const { close } = useContextMenu();

  const handleClick = () => {
    if (disabled) return;
    onAction();
    close();
  };

  return (
    <button
      className={`context-menu-item${danger ? " is-danger" : ""}${disabled ? " is-disabled" : ""}`}
      role="menuitem"
      tabIndex={-1}
      type="button"
      aria-disabled={disabled || undefined}
      aria-label={
        disabled && disabledReason
          ? `${label}（不可用：${disabledReason}）`
          : label
      }
      title={disabled && disabledReason ? disabledReason : undefined}
      onClick={handleClick}
    >
      {icon && <span className="context-menu-item-icon">{icon}</span>}
      <span className="context-menu-item-label">{label}</span>
      {shortcut && <span className="context-menu-item-shortcut">{shortcut}</span>}
    </button>
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
