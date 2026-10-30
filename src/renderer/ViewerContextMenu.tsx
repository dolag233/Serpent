import {
  useEffect,
  useId,
  useLayoutEffect,
  useState,
  type CSSProperties,
} from "react";

import { Icon } from "./Icons";
import { useT } from "./i18n";
import { isImeKeyboardEvent } from "./ime-safe-dismiss";
import { PopoverSurface } from "./ui/patterns";
import { VIEWER_CHROME_TAB_INDEX } from "./viewer-focus-policy";
import {
  ViewerQuickSettingsMenu,
  type ViewerChromeMenuProps,
  type ViewerPlaybackMenuProps,
} from "./viewer-quick-settings-menu";

export interface ViewerContextMenuPosition {
  x: number;
  y: number;
}

interface ViewerContextMenuProps {
  copyShortcut: string;
  copyPathShortcut?: string | null;
  onCopyFilePath?: () => void;
  flipHorizontal: boolean;
  flipVertical: boolean;
  fitShortcut?: string;
  isFullscreen: boolean;
  onCopy: () => void;
  onClose: () => void;
  onFit: () => void;
  onFlipHorizontal: () => void;
  onFlipVertical: () => void;
  onFullscreen: () => void;
  onRotate: () => void;
  onRotateCounterClockwise: () => void;
  position: ViewerContextMenuPosition;
  transformable: boolean;
  canTrash?: boolean;
  canDiskDelete?: boolean;
  diskDeleteLinked?: boolean;
  canRemoveFromCollection?: boolean;
  canPermanentDelete?: boolean;
  onTrash?: () => void;
  onDiskDelete?: () => void;
  onRemoveFromCollection?: () => void;
  onPermanentDelete?: () => void;
  playback?: ViewerPlaybackMenuProps | null;
  chromeSettings?: ViewerChromeMenuProps | null;
}

/**
 * The viewer menu deliberately uses the same `context-menu*` surface classes
 * as the asset menu. It owns only viewer-local state, so opening it never
 * steals the asset selection menu's descriptor or its asynchronous pickers.
 */
export function ViewerContextMenu({
  copyShortcut,
  copyPathShortcut,
  onCopyFilePath,
  flipHorizontal,
  flipVertical,
  fitShortcut,
  isFullscreen,
  onCopy,
  onClose,
  onFit,
  onFlipHorizontal,
  onFlipVertical,
  onFullscreen,
  onRotate,
  onRotateCounterClockwise,
  position,
  transformable,
  canTrash = false,
  canDiskDelete = false,
  diskDeleteLinked = false,
  canRemoveFromCollection = false,
  canPermanentDelete = false,
  onTrash,
  onDiskDelete,
  onRemoveFromCollection,
  onPermanentDelete,
  playback = null,
  chromeSettings = null,
}: ViewerContextMenuProps) {
  const t = useT();
  const menuId = useId();
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
    const gap = 4;
    let left = position.x;
    let top = position.y;
    if (left + rect.width > window.innerWidth - gap) {
      left = Math.max(gap, position.x - rect.width);
    }
    if (top + rect.height > window.innerHeight - gap) {
      top = Math.max(gap, position.y - rect.height);
    }
    const frame = requestAnimationFrame(() => {
      setStyle({ position: "fixed", left, top });
    });
    return () => cancelAnimationFrame(frame);
  }, [menuId, position]);

  useEffect(() => {
    const menu = document.getElementById(menuId);
    if (!(menu instanceof HTMLDivElement)) return;
    const raf = requestAnimationFrame(() => {
      const first = menu.querySelector<HTMLElement>(
        '[role="menuitem"]:not([aria-disabled="true"])',
      );
      first?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [menuId, position]);

  useEffect(() => {
    const insideMenu = (target: EventTarget | null) => {
      if (!(target instanceof Node)) return false;
      const menu = document.getElementById(menuId);
      if (menu?.contains(target)) return true;
      return Array.from(document.querySelectorAll(".context-menu")).some((node) =>
        node.contains(target),
      );
    };
    const onMouseDown = (event: MouseEvent) => {
      if (!insideMenu(event.target)) onClose();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!insideMenu(event.target)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (isImeKeyboardEvent(event)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onClose, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [menuId, onClose]);

  const action = (run: () => void) => () => {
    run();
    onClose();
  };

  return (
    <PopoverSurface
      aria-label={t("preview.viewerMenu")}
      className="context-menu viewer-context-menu"
      id={menuId}
      onKeyDown={(event) => {
        const menu = event.currentTarget;
        const items = Array.from(
          menu.querySelectorAll<HTMLElement>(
            '[role="menuitem"]:not([aria-disabled="true"])',
          ) ?? [],
        );
        const current = items.indexOf(document.activeElement as HTMLElement);
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const delta = event.key === "ArrowDown" ? 1 : -1;
          items[(current + delta + items.length) % items.length]?.focus();
        }
      }}
      role="menu"
      style={style}
    >
      {playback || chromeSettings ? (
        <div className="context-menu-section" role="group">
          <ViewerQuickSettingsMenu
            chrome={chromeSettings}
            onClose={onClose}
            playback={playback}
          />
        </div>
      ) : null}
      {transformable ? (
        <div className="context-menu-section" role="group">
          <button
            className="context-menu-item"
            onClick={action(onRotateCounterClockwise)}
            tabIndex={VIEWER_CHROME_TAB_INDEX}
            type="button"
          >
            <span className="context-menu-item-icon">
              <Icon name="rotate-ccw" size={14} />
            </span>
            <span className="context-menu-item-label">
              {t("preview.rotateCounterClockwise")}
            </span>
          </button>
          <button
            className="context-menu-item"
            onClick={action(onRotate)}
            tabIndex={VIEWER_CHROME_TAB_INDEX}
            type="button"
          >
            <span className="context-menu-item-icon">
              <Icon name="rotate-cw" size={14} />
            </span>
            <span className="context-menu-item-label">
              {t("preview.rotateClockwise")}
            </span>
          </button>
          <button
            className={`context-menu-item${flipHorizontal ? " is-active" : ""}`}
            onClick={action(onFlipHorizontal)}
            tabIndex={VIEWER_CHROME_TAB_INDEX}
            type="button"
          >
            <span className="context-menu-item-icon">
              <Icon name="flip-horizontal-2" size={14} />
            </span>
            <span className="context-menu-item-label">
              {t("preview.flipHorizontal")}
            </span>
          </button>
          <button
            className={`context-menu-item${flipVertical ? " is-active" : ""}`}
            onClick={action(onFlipVertical)}
            tabIndex={VIEWER_CHROME_TAB_INDEX}
            type="button"
          >
            <span className="context-menu-item-icon">
              <Icon name="flip-vertical-2" size={14} />
            </span>
            <span className="context-menu-item-label">
              {t("preview.flipVertical")}
            </span>
          </button>
        </div>
      ) : null}
      <div className="context-menu-section" role="group">
        <button
          className="context-menu-item"
          onClick={action(onCopy)}
          tabIndex={VIEWER_CHROME_TAB_INDEX}
          type="button"
        >
          <span className="context-menu-item-icon">
            <Icon name="copy" size={14} />
          </span>
          <span className="context-menu-item-label">
            {t("preview.copyAsset")}
          </span>
          <span className="context-menu-item-shortcut">{copyShortcut}</span>
        </button>
        {onCopyFilePath ? (
          <button
            className="context-menu-item"
            onClick={action(onCopyFilePath)}
            tabIndex={VIEWER_CHROME_TAB_INDEX}
            type="button"
          >
            <span className="context-menu-item-icon">
              <Icon name="file" size={14} />
            </span>
            <span className="context-menu-item-label">
              {t("command.asset.copyFilePath")}
            </span>
            {copyPathShortcut ? (
              <span className="context-menu-item-shortcut">{copyPathShortcut}</span>
            ) : null}
          </button>
        ) : null}
        {transformable ? (
          <button
            className="context-menu-item"
            onClick={action(onFit)}
            tabIndex={VIEWER_CHROME_TAB_INDEX}
            type="button"
          >
            <span className="context-menu-item-icon">
              <Icon name="fit-window" size={14} />
            </span>
            <span className="context-menu-item-label">
              {t("preview.fitWindow")}
            </span>
            {fitShortcut ? (
              <span className="context-menu-item-shortcut">{fitShortcut}</span>
            ) : null}
          </button>
        ) : null}
        <button
          className="context-menu-item"
          onClick={action(onFullscreen)}
          tabIndex={VIEWER_CHROME_TAB_INDEX}
          type="button"
        >
          <span className="context-menu-item-icon">
            <Icon
              name={isFullscreen ? "fullscreen-exit" : "fullscreen"}
              size={14}
            />
          </span>
          <span className="context-menu-item-label">
            {isFullscreen ? t("preview.exitFullscreen") : t("preview.fullscreen")}
          </span>
        </button>
      </div>
      {canTrash || canDiskDelete || canRemoveFromCollection || canPermanentDelete ? (
        <div className="context-menu-section" role="group">
          {canTrash && onTrash ? (
            <button
              className="context-menu-item"
              onClick={action(onTrash)}
              tabIndex={VIEWER_CHROME_TAB_INDEX}
              type="button"
            >
              <span className="context-menu-item-icon">
                <Icon name="trash" size={14} />
              </span>
              <span className="context-menu-item-label">
                {t("command.asset.moveToTrash")}
              </span>
              <span className="context-menu-item-shortcut">Delete</span>
            </button>
          ) : null}
          {canRemoveFromCollection && onRemoveFromCollection ? (
            <button
              className="context-menu-item"
              onClick={action(onRemoveFromCollection)}
              tabIndex={VIEWER_CHROME_TAB_INDEX}
              type="button"
            >
              <span className="context-menu-item-icon">
                <Icon name="trash" size={14} />
              </span>
              <span className="context-menu-item-label">
                {t("command.asset.removeFromCollection")}
              </span>
              <span className="context-menu-item-shortcut">Delete</span>
            </button>
          ) : null}
          {canPermanentDelete && onPermanentDelete ? (
            <button
              className="context-menu-item"
              onClick={action(onPermanentDelete)}
              tabIndex={VIEWER_CHROME_TAB_INDEX}
              type="button"
            >
              <span className="context-menu-item-icon">
                <Icon name="trash" size={14} />
              </span>
              <span className="context-menu-item-label">
                {t("command.asset.deletePermanent")}
              </span>
              <span className="context-menu-item-shortcut">Delete</span>
            </button>
          ) : null}
          {canDiskDelete && onDiskDelete ? (
            <button
              className="context-menu-item"
              onClick={action(onDiskDelete)}
              tabIndex={VIEWER_CHROME_TAB_INDEX}
              type="button"
            >
              <span className="context-menu-item-icon">
                <Icon name="trash" size={14} />
              </span>
              <span className="context-menu-item-label">
                {t(diskDeleteLinked
                  ? "command.asset.forceDeleteFromDisk"
                  : "command.asset.deleteFromDisk")}
              </span>
              <span className="context-menu-item-shortcut">Shift+Delete</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </PopoverSurface>
  );
}
