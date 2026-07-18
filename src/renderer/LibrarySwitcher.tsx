import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "./Icons";
import { useLocale, type LocalePreference } from "./i18n";
import { useTheme, type ThemePreference } from "./theme";

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
  onImportFiles,
  onImportFolder,
  onPasteImage,
  onImportLinkedFolder,
  onExportLibrary,
  onImportLibrary,
  onImportZip,
}: LibrarySwitcherProps) {
  const { t, preference: localePreference, setLocale } = useLocale();
  const { preference: themePreference, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const label = libraryName ?? t("shell.chooseLibrary");
  const libraryScopedDisabled = !libraryOpen || busy;
  const showTransferSection =
    onImportFiles != null ||
    onImportFolder != null ||
    onPasteImage != null ||
    onImportLinkedFolder != null ||
    onExportLibrary != null ||
    onImportLibrary != null ||
    onImportZip != null;

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function chooseLocale(next: LocalePreference) {
    setLocale(next);
    setOpen(false);
  }

  function chooseTheme(next: ThemePreference) {
    setTheme(next);
  }

  function runMenuAction(handler: () => void) {
    setOpen(false);
    handler();
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
          if (!open) onMenuOpen?.();
          setOpen(!open);
        }}
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
        <div className="library-switcher-menu" id={menuId} role="menu">
          <button
            className="library-switcher-item"
            onClick={() => {
              setOpen(false);
              onCreateLibrary();
            }}
            role="menuitem"
            type="button"
          >
            {t("shell.createLibraryEllipsis")}
          </button>
          <button
            className="library-switcher-item"
            onClick={() => {
              setOpen(false);
              onOpenLibrary();
            }}
            role="menuitem"
            type="button"
          >
            {t("shell.openLibraryEllipsis")}
          </button>
          <button
            className="library-switcher-item"
            disabled={!libraryName}
            onClick={() => {
              setOpen(false);
              onCloseLibrary();
            }}
            role="menuitem"
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
                    type="button"
                  >
                    {t("toolbar.importFiles")}
                  </button>
                )}
                {onImportFolder != null && (
                  <button
                    className="library-switcher-item"
                    disabled={libraryScopedDisabled}
                    onClick={() => runMenuAction(onImportFolder)}
                    role="menuitem"
                    type="button"
                  >
                    {t("toolbar.importFolder")}
                  </button>
                )}
                {onPasteImage != null && (
                  <button
                    className="library-switcher-item"
                    disabled={libraryScopedDisabled}
                    onClick={() => runMenuAction(onPasteImage)}
                    role="menuitem"
                    type="button"
                  >
                    {t("toolbar.pasteImage")}
                  </button>
                )}
                {onImportLinkedFolder != null && (
                  <button
                    className="library-switcher-item"
                    disabled={libraryScopedDisabled}
                    onClick={() => runMenuAction(onImportLinkedFolder)}
                    role="menuitem"
                    type="button"
                  >
                    {t("toolbar.importLinkedFolder")}
                  </button>
                )}
                {onExportLibrary != null && (
                  <button
                    className="library-switcher-item"
                    disabled={libraryScopedDisabled}
                    onClick={() => runMenuAction(onExportLibrary)}
                    role="menuitem"
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
                    type="button"
                  >
                    {t("toolbar.importZip")}
                  </button>
                )}
              </div>
            </>
          )}
          <div aria-hidden="true" className="library-switcher-divider" />
          <div
            aria-label={t("shell.language")}
            className="library-switcher-section"
            role="group"
          >
            <div className="library-switcher-section-label">
              {t("shell.language")}
            </div>
            <button
              aria-checked={localePreference === "system"}
              className="library-switcher-item"
              onClick={() => chooseLocale("system")}
              role="menuitemradio"
              type="button"
            >
              {t("shell.languageSystem")}
            </button>
            <button
              aria-checked={localePreference === "zh-CN"}
              className="library-switcher-item"
              onClick={() => chooseLocale("zh-CN")}
              role="menuitemradio"
              type="button"
            >
              {t("shell.languageZh")}
            </button>
            <button
              aria-checked={localePreference === "en"}
              className="library-switcher-item"
              onClick={() => chooseLocale("en")}
              role="menuitemradio"
              type="button"
            >
              {t("shell.languageEn")}
            </button>
          </div>
          <div aria-hidden="true" className="library-switcher-divider" />
          <div
            aria-label={t("shell.theme")}
            className="library-switcher-section"
            role="group"
          >
            <div className="library-switcher-section-label">
              {t("shell.theme")}
            </div>
            <button
              aria-checked={themePreference === "dark"}
              className="library-switcher-item"
              onClick={() => chooseTheme("dark")}
              role="menuitemradio"
              type="button"
            >
              {t("shell.themeDark")}
            </button>
            <button
              aria-checked={themePreference === "light"}
              className="library-switcher-item"
              onClick={() => chooseTheme("light")}
              role="menuitemradio"
              type="button"
            >
              {t("shell.themeLight")}
            </button>
            <button
              aria-checked={themePreference === "system"}
              className="library-switcher-item"
              onClick={() => chooseTheme("system")}
              role="menuitemradio"
              type="button"
            >
              {t("shell.themeSystem")}
            </button>
          </div>
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
                      setOpen(false);
                      onOpenRecent?.(entry.path);
                    }}
                    role="menuitem"
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
