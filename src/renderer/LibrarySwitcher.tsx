import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  resolveImportMenuCopy,
  type ImportMenuCopy,
} from "./browse-empty-state";
import {
  buildLibraryTransferMenuItems,
  type LibraryTransferMenuHandlers,
} from "./library-transfer-menu";
import { iconActionAttrs } from "./icon-action-attrs";
import { useLocale } from "./i18n";
import {
  focusFirstRovingItem,
  handleRovingListKeyDown,
} from "./roving-list-keyboard";
import { Icon } from "./Icons";
import { MenuSurface, resolveMenuNodes } from "./ui/patterns";

const MENU_ITEM_SELECTOR = '[role="menuitem"], [role="menuitemradio"]';
const LIBRARY_MENU_SURFACE_NODES = resolveMenuNodes([
  { id: "library-menu-content", kind: "separator" as const },
]);

export type RecentLibraryMenuEntry = {
  path: string;
  name: string;
};

/**
 * The other-libraries menu section lists every known recent library except the
 * one currently open (identified by absolute path, so same-named libraries still
 * distinguish correctly). Store order (most recent first) is preserved.
 */
export function buildRecentLibraryMenuEntries(
  entries: RecentLibraryMenuEntry[],
  currentLibraryPath: string | null,
): RecentLibraryMenuEntry[] {
  return entries.filter((entry) => entry.path !== currentLibraryPath);
}

export type LibrarySwitcherProps = {
  libraryName: string | null;
  disabled?: boolean;
  onCreateLibrary: () => void;
  onOpenLibrary: () => void;
  onCloseLibrary: () => void;
  /** Soft remove: close + drop from recents; disk untouched (Serpent-ucx). */
  onRemoveLibrary?: () => void;
  /** Irreversible delete of the currently open library root (Serpent-9i8). */
  onDeleteLibraryFromDisk?: () => void;
  onOpenLibrarySettings?: () => void;
  /** Recent libraries excluding the open one; the section hides when empty. */
  recentLibraries?: RecentLibraryMenuEntry[];
  onOpenRecent?: (path: string) => void;
  /** Soft-forget a recent entry without opening it. */
  onForgetRecent?: (path: string) => void;
  /** Called when the menu opens so the owner can refresh recentLibraries. */
  onMenuOpen?: () => void;
  /** True when a library is open (gates library-scoped transfer actions). */
  libraryOpen?: boolean;
  busy?: boolean;
  /** Labels/titles for folder/linked-folder transfer items (CU-U5). */
  importMenuCopy?: ImportMenuCopy;
  onImportFolder?: () => void;
  onImportLinkedFolder?: () => void;
  onExportLibrary?: () => void;
  /** Opens second-level chooser (folder vs ZIP). Do not add a separate ZIP menu item. */
  onImportLibrary?: () => void;
};

/**
 * Top-left library control: current library name with create/open/close menu.
 * Replaces the brand glyph + static label.
 */
export function LibrarySwitcher({
  libraryName,
  disabled = false,
  onCreateLibrary,
  onOpenLibrary,
  onCloseLibrary,
  onRemoveLibrary,
  onDeleteLibraryFromDisk,
  onOpenLibrarySettings,
  recentLibraries = [],
  onOpenRecent,
  onForgetRecent,
  onMenuOpen,
  libraryOpen = false,
  busy = false,
  importMenuCopy,
  onImportFolder,
  onImportLinkedFolder,
  onExportLibrary,
  onImportLibrary,
}: LibrarySwitcherProps) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [keyboardNav, setKeyboardNav] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const label = libraryName ?? t("shell.chooseLibrary");
  const libraryScopedDisabled = !libraryOpen || busy;
  const transferCopy = importMenuCopy ?? resolveImportMenuCopy("folder");

  const transferHandlers: LibraryTransferMenuHandlers = {};
  if (onImportFolder) transferHandlers["import-folder"] = onImportFolder;
  if (onImportLinkedFolder) {
    transferHandlers["import-linked-folder"] = onImportLinkedFolder;
  }
  if (onImportLibrary) transferHandlers["import-library"] = onImportLibrary;
  if (onExportLibrary) transferHandlers["export-library"] = onExportLibrary;

  const transferMenuItems = buildLibraryTransferMenuItems({
    handlers: transferHandlers,
    libraryScopedDisabled,
    busy,
    importFolderCopy: transferCopy.importFolder,
    importLinkedFolderCopy: transferCopy.importLinkedFolder,
  });
  const showTransferSection = transferMenuItems.length > 0;

  function closeMenu(restoreTriggerFocus: boolean) {
    setOpen(false);
    setKeyboardNav(false);
    if (restoreTriggerFocus) {
      requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        closeMenu(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    const raf = requestAnimationFrame(() => {
      const menu = document.getElementById(menuId);
      if (menu instanceof HTMLDivElement) {
        focusFirstRovingItem(menu, MENU_ITEM_SELECTOR);
      }
    });
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      cancelAnimationFrame(raf);
    };
  }, [menuId, open]);

  function runMenuAction(handler: () => void) {
    closeMenu(true);
    handler();
  }

  function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const menu = event.currentTarget;
    const result = handleRovingListKeyDown({
      key: event.key,
      container: menu,
      itemSelector: MENU_ITEM_SELECTOR,
    });
    if (!result.handled) return;
    event.preventDefault();
    event.stopPropagation();
    if (result.action === "escape") {
      closeMenu(true);
      return;
    }
    setKeyboardNav(true);
  }

  return (
    <div className="library-switcher" ref={rootRef}>
      <button
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={
          libraryName
            ? t("shell.currentLibrary", { name: libraryName })
            : t("shell.libraryMenu")
        }
        className="library-switcher-trigger"
        disabled={disabled}
        onClick={() => {
          if (open) {
            closeMenu(true);
            return;
          }
          onMenuOpen?.();
          setOpen(true);
        }}
        ref={triggerRef}
        title={
          libraryName
            ? t("shell.libraryNamed", { name: libraryName })
            : t("shell.noLibraryOpen")
        }
        type="button"
      >
        <span className="library-switcher-name">{label}</span>
        <Icon name="chevron" size={13} />
      </button>
      {open && (
        <MenuSurface
          className={`library-switcher-menu${keyboardNav ? " is-keyboard-navigation" : ""}`}
          id={menuId}
          nodes={LIBRARY_MENU_SURFACE_NODES}
          onKeyDown={onMenuKeyDown}
          onPointerMove={() => setKeyboardNav(false)}
          renderNode={() => (
            <>
          <button
            className="library-switcher-item"
            onClick={() => runMenuAction(onCreateLibrary)}
            role="menuitem"
            tabIndex={-1}
            type="button"
          >
            {t("shell.createLibraryEllipsis")}
          </button>
          <button
            className="library-switcher-item"
            onClick={() => runMenuAction(onOpenLibrary)}
            role="menuitem"
            tabIndex={-1}
            type="button"
          >
            {t("shell.openLibraryEllipsis")}
          </button>
          <button
            className="library-switcher-item"
            disabled={!libraryName}
            onClick={() => runMenuAction(onCloseLibrary)}
            role="menuitem"
            tabIndex={-1}
            type="button"
          >
            {t("shell.closeLibrary")}
          </button>
          {onRemoveLibrary != null && (
            <button
              className="library-switcher-item"
              disabled={!libraryName}
              onClick={() => runMenuAction(onRemoveLibrary)}
              role="menuitem"
              tabIndex={-1}
              title={t("shell.removeLibraryHint")}
              type="button"
            >
              {t("shell.removeLibrary")}
            </button>
          )}
          {onDeleteLibraryFromDisk != null && (
            <button
              className="library-switcher-item is-danger"
              disabled={!libraryName}
              onClick={() => runMenuAction(onDeleteLibraryFromDisk)}
              role="menuitem"
              tabIndex={-1}
              type="button"
            >
              {t("shell.deleteLibraryFromDisk")}
            </button>
          )}
          {onOpenLibrarySettings != null && (
            <button
              className="library-switcher-item"
              disabled={!libraryName || busy}
              onClick={() => runMenuAction(onOpenLibrarySettings)}
              role="menuitem"
              tabIndex={-1}
              type="button"
            >
              {t("settings.librarySettings")}
            </button>
          )}
          {showTransferSection && (
            <>
              <div aria-hidden="true" className="library-switcher-divider" />
              <div
                aria-label={t("shell.libraryTransfer")}
                className="library-switcher-section"
                role="group"
              >
                <div className="library-switcher-section-label">
                  {t("shell.libraryTransfer")}
                </div>
                {transferMenuItems.map((item) => (
                  <button
                    className="library-switcher-item"
                    disabled={item.disabled}
                    key={item.id}
                    onClick={() => runMenuAction(item.onSelect)}
                    role="menuitem"
                    tabIndex={-1}
                    title={item.titleKey ? t(item.titleKey) : undefined}
                    type="button"
                  >
                    {t(item.labelKey)}
                  </button>
                ))}
              </div>
            </>
          )}
          {recentLibraries.length > 0 && (
            <>
              <div aria-hidden="true" className="library-switcher-divider" />
              <div
                aria-label={t("shell.otherLibraries")}
                className="library-switcher-section"
                role="group"
              >
                <div className="library-switcher-section-label">
                  {t("shell.otherLibraries")}
                </div>
                {recentLibraries.map((entry) => (
                  <div className="library-switcher-recent-row" key={entry.path}>
                    <button
                      className="library-switcher-item library-switcher-recent-open"
                      onClick={() => {
                        closeMenu(true);
                        onOpenRecent?.(entry.path);
                      }}
                      role="menuitem"
                      tabIndex={-1}
                      title={entry.path}
                      type="button"
                    >
                      <span className="library-switcher-item-label">
                        {entry.name}
                      </span>
                      {/* Serpent-s0oq: the full path is visible on the row so
                          hovering/scanning distinguishes same-named libraries. */}
                      <span className="library-switcher-recent-path">
                        {entry.path}
                      </span>
                    </button>
                    {onForgetRecent != null && (
                      <button
                        className="library-switcher-recent-forget"
                        onClick={(event) => {
                          event.stopPropagation();
                          onForgetRecent(entry.path);
                        }}
                        tabIndex={-1}
                        title={t("shell.forgetRecentLibrary")}
                        type="button"
                        {...iconActionAttrs(t("shell.forgetRecentLibrary"))}
                      >
                        <Icon name="close" size={12} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
            </>
          )}
        />
      )}
    </div>
  );
}
