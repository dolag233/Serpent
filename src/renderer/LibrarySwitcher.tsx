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
import { Icon } from "./Icons";
import { useLocale } from "./i18n";
import {
  focusFirstRovingItem,
  handleRovingListKeyDown,
} from "./roving-list-keyboard";

const MENU_ITEM_SELECTOR = '[role="menuitem"], [role="menuitemradio"]';

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
  /** Recent libraries excluding the open one; the section hides when empty. */
  recentLibraries?: RecentLibraryMenuEntry[];
  onOpenRecent?: (path: string) => void;
  /** Called when the menu opens so the owner can refresh recentLibraries. */
  onMenuOpen?: () => void;
  /** True when a library is open (gates library-scoped transfer actions). */
  libraryOpen?: boolean;
  busy?: boolean;
  /** Labels/titles for transfer items when browsing a collection scope (CU-U5). */
  importMenuCopy?: ImportMenuCopy;
  onImportFiles?: () => void;
  onImportFolder?: () => void;
  onPasteImage?: () => void;
  onImportLinkedFolder?: () => void;
  onExportLibrary?: () => void;
  onImportLibrary?: () => void;
  onImportZip?: () => void;
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
  recentLibraries = [],
  onOpenRecent,
  onMenuOpen,
  libraryOpen = false,
  busy = false,
  importMenuCopy,
  onImportFiles,
  onImportFolder,
  onPasteImage,
  onImportLinkedFolder,
  onExportLibrary,
  onImportLibrary,
  onImportZip,
}: LibrarySwitcherProps) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [keyboardNav, setKeyboardNav] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const label = libraryName ?? t("shell.chooseLibrary");
  const libraryScopedDisabled = !libraryOpen || busy;
  const transferCopy = importMenuCopy ?? resolveImportMenuCopy("folder");
  const showTransferSection =
    onImportFiles != null ||
    onImportFolder != null ||
    onPasteImage != null ||
    onImportLinkedFolder != null ||
    onExportLibrary != null ||
    onImportLibrary != null ||
    onImportZip != null;

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
      const menu = menuRef.current;
      if (menu) focusFirstRovingItem(menu, MENU_ITEM_SELECTOR);
    });
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      cancelAnimationFrame(raf);
    };
  }, [open]);

  function runMenuAction(handler: () => void) {
    closeMenu(true);
    handler();
  }

  function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const menu = menuRef.current;
    if (!menu) return;
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
        <div
          className={`library-switcher-menu${keyboardNav ? " is-keyboard-navigation" : ""}`}
          id={menuId}
          onKeyDown={onMenuKeyDown}
          onPointerMove={() => setKeyboardNav(false)}
          ref={menuRef}
          role="menu"
        >
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
                {onImportFiles != null && (
                  <button
                    className="library-switcher-item"
                    disabled={libraryScopedDisabled}
                    onClick={() => runMenuAction(onImportFiles)}
                    role="menuitem"
                    tabIndex={-1}
                    title={t(transferCopy.importFiles.titleKey)}
                    type="button"
                  >
                    {t(transferCopy.importFiles.labelKey)}
                  </button>
                )}
                {onImportFolder != null && (
                  <button
                    className="library-switcher-item"
                    disabled={libraryScopedDisabled}
                    onClick={() => runMenuAction(onImportFolder)}
                    role="menuitem"
                    tabIndex={-1}
                    title={t(transferCopy.importFolder.titleKey)}
                    type="button"
                  >
                    {t(transferCopy.importFolder.labelKey)}
                  </button>
                )}
                {onPasteImage != null && (
                  <button
                    className="library-switcher-item"
                    disabled={libraryScopedDisabled}
                    onClick={() => runMenuAction(onPasteImage)}
                    role="menuitem"
                    tabIndex={-1}
                    title={t(transferCopy.pasteImage.titleKey)}
                    type="button"
                  >
                    {t(transferCopy.pasteImage.labelKey)}
                  </button>
                )}
                {onImportLinkedFolder != null && (
                  <button
                    className="library-switcher-item"
                    disabled={libraryScopedDisabled}
                    onClick={() => runMenuAction(onImportLinkedFolder)}
                    role="menuitem"
                    tabIndex={-1}
                    title={t(transferCopy.importLinkedFolder.titleKey)}
                    type="button"
                  >
                    {t(transferCopy.importLinkedFolder.labelKey)}
                  </button>
                )}
                {onExportLibrary != null && (
                  <button
                    className="library-switcher-item"
                    disabled={libraryScopedDisabled}
                    onClick={() => runMenuAction(onExportLibrary)}
                    role="menuitem"
                    tabIndex={-1}
                    type="button"
                  >
                    {t("toolbar.exportLibrary")}
                  </button>
                )}
                {onImportLibrary != null && (
                  <button
                    className="library-switcher-item"
                    disabled={busy}
                    onClick={() => runMenuAction(onImportLibrary)}
                    role="menuitem"
                    tabIndex={-1}
                    type="button"
                  >
                    {t("toolbar.importLibrary")}
                  </button>
                )}
                {onImportZip != null && (
                  <button
                    className="library-switcher-item"
                    disabled={busy}
                    onClick={() => runMenuAction(onImportZip)}
                    role="menuitem"
                    tabIndex={-1}
                    type="button"
                  >
                    {t("toolbar.importZip")}
                  </button>
                )}
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
                  <button
                    className="library-switcher-item"
                    key={entry.path}
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
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
