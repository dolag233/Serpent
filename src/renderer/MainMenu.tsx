import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";
import { isImeKeyboardEvent } from "./ime-safe-dismiss";
import type { MainMenuItem, MainMenuSection } from "./main-menu-items";
import { MenuSurface, resolveMenuNodes } from "./ui/patterns";

const MENU_ITEM_SELECTOR = '[role="menuitem"]:not([aria-disabled="true"])';
const MAIN_MENU_SURFACE_NODES = resolveMenuNodes([
  { id: "main-menu-content", kind: "separator" as const },
]);

function nextEnabledIndex(items: readonly HTMLElement[], current: number, step: number): number {
  if (items.length === 0) return -1;
  let index = current;
  for (let count = 0; count < items.length; count += 1) {
    index = (index + step + items.length) % items.length;
    if (items[index]?.getAttribute("aria-disabled") !== "true") return index;
  }
  return -1;
}

function MenuItemButton({
  item,
  active = false,
  onOpenSubmenu,
  onHover,
  parentItemId,
  onSelect,
}: {
  readonly item: MainMenuItem;
  readonly active?: boolean;
  readonly onOpenSubmenu?: () => void;
  readonly onHover?: () => void;
  readonly parentItemId?: string;
  readonly onSelect: () => void;
}) {
  const hasSubmenu = Boolean(item.submenu?.length);
  return (
    <button
      aria-disabled={item.disabled || undefined}
      aria-expanded={hasSubmenu ? active : undefined}
      aria-haspopup={hasSubmenu ? "menu" : undefined}
      className={`main-menu-item${item.danger ? " is-danger" : ""}${item.disabled ? " is-disabled" : ""}${active ? " is-active" : ""}`}
      data-menu-item-id={item.id}
      data-main-menu-item-id={item.id}
      data-main-menu-parent-item-id={parentItemId}
      disabled={item.disabled}
      onClick={() => {
        if (!item.disabled) {
          if (hasSubmenu) onOpenSubmenu?.();
          else onSelect();
        }
      }}
      onFocus={() => {
        if (!item.disabled) onHover?.();
      }}
      onMouseEnter={() => {
        if (!item.disabled) onHover?.();
      }}
      role="menuitem"
      tabIndex={-1}
      type="button"
    >
      <span className="main-menu-item-label">{item.label}</span>
      {item.shortcut ? (
        <span aria-hidden="true" className="main-menu-item-shortcut">
          {item.shortcut}
        </span>
      ) : null}
      {hasSubmenu ? (
        <span aria-hidden="true" className="main-menu-chevron">
          ›
        </span>
      ) : null}
    </button>
  );
}

export function MainMenu({
  sections,
  disabled = false,
}: {
  readonly sections: readonly MainMenuSection[];
  readonly disabled?: boolean;
}): ReactNode {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [submenuPosition, setSubmenuPosition] = useState({ left: 0, top: 5 });
  const [itemSubmenuPosition, setItemSubmenuPosition] = useState({ left: 0, top: 5 });
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const menuId = useId();

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const closeMenu = useCallback(
    (restoreFocus: boolean) => {
      cancelClose();
      setOpen(false);
      setActiveSectionId(null);
      setActiveItemId(null);
      if (restoreFocus) {
        requestAnimationFrame(() => triggerRef.current?.focus());
      }
    },
    [cancelClose],
  );

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
      setActiveSectionId(null);
      setActiveItemId(null);
    }, 140);
  }, [cancelClose]);

  const openMenu = useCallback(
    (sectionId?: string) => {
      cancelClose();
      setOpen(true);
      setActiveSectionId(sectionId ?? null);
      setActiveItemId(null);
    },
    [cancelClose],
  );

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) closeMenu(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (isImeKeyboardEvent(event)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu(true);
        return;
      }
      const menuSurface = document.getElementById(menuId);
      if (!(menuSurface instanceof HTMLDivElement)) return;
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        return;
      }
      const activeElement = document.activeElement as HTMLElement | null;
      const activeMenu = activeElement?.closest<HTMLElement>('[role="menu"]');
      const surface = activeMenu && rootRef.current?.contains(activeMenu)
        ? activeMenu
        : menuSurface;
      const items = Array.from(
        surface.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR),
      );
      if (items.length === 0) return;
      event.preventDefault();
      const current = items.indexOf(document.activeElement as HTMLElement);
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : nextEnabledIndex(
                items,
                current < 0 ? (event.key === "ArrowUp" ? 0 : -1) : current,
                event.key === "ArrowUp" ? -1 : 1,
              );
      items[next]?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [closeMenu, menuId, open]);

  useEffect(
    () => () => {
      cancelClose();
    },
    [cancelClose],
  );

  const activeSection = sections.find((section) => section.id === activeSectionId);
  const activeItem = activeSection?.items?.find((item) => item.id === activeItemId);

  useLayoutEffect(() => {
    if (!open || !activeSection?.items?.length) return;
    const surface = document.getElementById(menuId);
    const root = rootRef.current;
    const trigger = surface?.querySelector<HTMLElement>(
      `[data-main-menu-section-id="${activeSection.id}"]`,
    );
    if (!surface || !root || !trigger) return;
    const rootRect = root.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    setSubmenuPosition({
      // Keep the secondary surface as a sibling of the acrylic primary
      // surface. If it is nested inside that surface, its backdrop-filter
      // only sees the already-composited primary panel and cannot blur the
      // asset view behind it.
      left: triggerRect.right - rootRect.left,
      top: triggerRect.top - rootRect.top,
    });
  }, [activeSection, activeSectionId, menuId, open]);

  useLayoutEffect(() => {
    if (!open || !activeSection || !activeItem?.submenu?.length) return;
    const surface = document.getElementById(menuId);
    const root = rootRef.current;
    const trigger = root?.querySelector<HTMLElement>(
      `[data-main-menu-item-id="${CSS.escape(activeItem.id)}"]`,
    );
    if (!surface || !root || !trigger) return;
    const rootRect = root.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    setItemSubmenuPosition({
      left: triggerRect.right - rootRect.left,
      top: triggerRect.top - rootRect.top,
    });
  }, [activeItem, activeSection, menuId, open]);

  function runSection(section: MainMenuSection) {
    if (!section.onSelect) return;
    closeMenu(true);
    section.onSelect();
  }

  function runItem(item: MainMenuItem) {
    if (item.disabled) return;
    closeMenu(true);
    item.onSelect();
  }

  function openItemSubmenu(item: MainMenuItem) {
    if (item.disabled || !item.submenu?.length) return;
    setActiveItemId(item.id);
  }

  function onSurfaceKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowRight") {
      const section = sections.find((candidate) => candidate.id === activeSectionId);
      const focused = document.activeElement as HTMLElement | null;
      const focusedItemId = focused?.dataset.mainMenuItemId;
      const focusedParentItemId = focused?.dataset.mainMenuParentItemId;
      const nestedFirstItem = focusedParentItemId !== undefined
        ? undefined
        : focusedItemId === activeItemId
        ? rootRef.current?.querySelector<HTMLElement>(
            `[data-main-menu-item-submenu="${CSS.escape(activeItemId ?? "")}"] ${MENU_ITEM_SELECTOR}`,
          )
        : activeItem?.submenu?.length
          ? rootRef.current?.querySelector<HTMLElement>(
              `[data-main-menu-item-submenu="${CSS.escape(activeItem.id)}"] ${MENU_ITEM_SELECTOR}`,
            )
          : undefined;
      const firstItem = focusedParentItemId !== undefined
        ? undefined
        : nestedFirstItem ?? (
            section && section.items
              ? rootRef.current?.querySelector<HTMLElement>(
                  `[data-main-menu-submenu="${CSS.escape(section.id)}"] ${MENU_ITEM_SELECTOR}`,
                )
              : undefined
          );
      if (firstItem) {
        event.preventDefault();
        firstItem.focus();
      }
    } else if (event.key === "ArrowLeft") {
      const focused = document.activeElement as HTMLElement | null;
      const parentItemId = focused?.dataset.mainMenuParentItemId;
      const target = parentItemId === undefined
        ? (() => {
            const section = sections.find((candidate) =>
              candidate.items?.some((item) => item.id === focused?.dataset.mainMenuItemId),
            );
            return document.getElementById(menuId)?.querySelector<HTMLElement>(
              `[data-main-menu-section-id="${CSS.escape(section?.id ?? activeSectionId ?? "")}"]`,
            );
          })()
        : rootRef.current?.querySelector<HTMLElement>(
            `[data-main-menu-item-id="${CSS.escape(parentItemId)}"]`,
          );
      if (target) {
        event.preventDefault();
        target.focus();
      }
    }
  }

  return (
    <div
      className="main-menu"
      onKeyDown={onSurfaceKeyDown}
      onMouseLeave={scheduleClose}
      ref={rootRef}
    >
      <button
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup="menu"
        className="main-menu-trigger"
        disabled={disabled}
        onClick={() => (open ? closeMenu(true) : openMenu())}
        ref={triggerRef}
        type="button"
        {...iconActionAttrs(t("shell.mainMenu"))}
      >
        <Icon name="menu" size={15} />
      </button>
      {open ? (
        <MenuSurface
          aria-label={t("shell.mainMenu")}
          className="main-menu-surface"
          id={menuId}
          nodes={MAIN_MENU_SURFACE_NODES}
          onMouseEnter={cancelClose}
          renderNode={() => (
            <div className="main-menu-sections" role="group">
              {sections.map((section) => {
                const active = activeSection?.id === section.id;
                const hasSubmenu = Boolean(section.items?.length);
                return (
                  <button
                    aria-expanded={hasSubmenu ? active : undefined}
                    aria-haspopup={hasSubmenu ? "menu" : undefined}
                    aria-disabled={section.disabled || undefined}
                    className={`main-menu-section${active ? " is-active" : ""}`}
                    data-main-menu-section="true"
                    data-main-menu-section-id={section.id}
                    disabled={section.disabled}
                    onClick={() => {
                      if (section.disabled) return;
                      if (hasSubmenu) openMenu(section.id);
                      else runSection(section);
                    }}
                    onFocus={() => {
                      if (!section.disabled) openMenu(hasSubmenu ? section.id : undefined);
                    }}
                    onMouseEnter={() => {
                      if (!section.disabled) openMenu(hasSubmenu ? section.id : undefined);
                    }}
                    role="menuitem"
                    tabIndex={-1}
                    type="button"
                  >
                    <Icon name={section.icon} size={14} />
                    <span>{section.label}</span>
                    {hasSubmenu ? (
                      <span aria-hidden="true" className="main-menu-chevron">
                        ›
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        />
      ) : null}
      {open && activeSection?.items ? (
        <div
          aria-label={activeSection.label}
          className="main-menu-submenu"
          data-main-menu-submenu={activeSection.id}
          role="menu"
          style={submenuPosition}
        >
          {activeSection.items.map((item) => (
            <MenuItemButton
              active={item.id === activeItemId}
              item={item}
              key={item.id}
              onOpenSubmenu={() => openItemSubmenu(item)}
              onHover={() => {
                if (item.submenu?.length) openItemSubmenu(item);
                else setActiveItemId(null);
              }}
              onSelect={() => runItem(item)}
            />
          ))}
        </div>
      ) : null}
      {open && activeItem?.submenu ? (
        <div
          aria-label={activeItem.label}
          className="main-menu-submenu main-menu-item-submenu"
          data-main-menu-item-submenu={activeItem.id}
          role="menu"
          style={itemSubmenuPosition}
        >
          {activeItem.submenu.map((item) => (
            <MenuItemButton
              item={item}
              key={item.id}
              parentItemId={activeItem.id}
              onSelect={() => runItem(item)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
