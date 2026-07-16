import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "./Icons";

export type RecentLibraryMenuEntry = {
  path: string;
  name: string;
};

/**
 * The 其他资源库 menu section lists every known recent library except the one
 * currently open (identified by absolute path, so same-named libraries still
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
}: LibrarySwitcherProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const label = libraryName ?? "选择资源库";

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

  return (
    <div className="library-switcher" ref={rootRef}>
      <button
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={libraryName ? `当前资源库 ${libraryName}` : "资源库菜单"}
        className="library-switcher-trigger"
        disabled={disabled}
        onClick={() => {
          if (!open) onMenuOpen?.();
          setOpen(!open);
        }}
        title={libraryName ? `资源库：${libraryName}` : "尚未打开资源库"}
        type="button"
      >
        <span className="library-switcher-name">{label}</span>
        <Icon name="chevron" size={13} />
      </button>
      {open && (
        <div
          className="library-switcher-menu"
          id={menuId}
          role="menu"
        >
          <button
            className="library-switcher-item"
            onClick={() => {
              setOpen(false);
              onCreateLibrary();
            }}
            role="menuitem"
            type="button"
          >
            新建资源库…
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
            打开资源库…
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
            关闭资源库
          </button>
          {recentLibraries.length > 0 && (
            <>
              <div aria-hidden="true" className="library-switcher-divider" />
              <div
                aria-label="其他资源库"
                className="library-switcher-section"
                role="group"
              >
                <div className="library-switcher-section-label">其他资源库</div>
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
