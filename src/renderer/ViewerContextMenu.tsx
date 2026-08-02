import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { Icon } from "./Icons";
import { useT } from "./i18n";
import { VIEWER_CHROME_TAB_INDEX } from "./viewer-focus-policy";

export interface ViewerContextMenuPosition {
  x: number;
  y: number;
}

interface ViewerContextMenuProps {
  flipHorizontal: boolean;
  flipVertical: boolean;
  fitShortcut?: string;
  isFullscreen: boolean;
  onClose: () => void;
  onFit: () => void;
  onFlipHorizontal: () => void;
  onFlipVertical: () => void;
  onFullscreen: () => void;
  onRotate: () => void;
  position: ViewerContextMenuPosition;
}

/**
 * The viewer menu deliberately uses the same `context-menu*` surface classes
 * as the asset menu. It owns only viewer-local state, so opening it never
 * steals the asset selection menu's descriptor or its asynchronous pickers.
 */
export function ViewerContextMenu({
  flipHorizontal,
  flipVertical,
  fitShortcut,
  isFullscreen,
  onClose,
  onFit,
  onFlipHorizontal,
  onFlipVertical,
  onFullscreen,
  onRotate,
  position,
}: ViewerContextMenuProps) {
  const t = useT();
  const menuRef = useRef<HTMLDivElement>(null);
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
    const gap = 4;
    let left = position.x;
    let top = position.y;
    if (left + rect.width > window.innerWidth - gap) {
      left = Math.max(gap, position.x - rect.width);
    }
    if (top + rect.height > window.innerHeight - gap) {
      top = Math.max(gap, position.y - rect.height);
    }
    setStyle({ position: "fixed", left, top });
  }, [position]);

  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const raf = requestAnimationFrame(() => {
      const first = menu.querySelector<HTMLElement>(
        '[role="menuitem"]:not([aria-disabled="true"])',
      );
      first?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [position]);

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
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
  }, [onClose]);

  const action = (run: () => void) => () => {
    run();
    onClose();
  };

  return (
    <div
      aria-label={t("preview.viewerMenu")}
      className="context-menu viewer-context-menu"
      onKeyDown={(event) => {
        const items = Array.from(
          menuRef.current?.querySelectorAll<HTMLElement>(
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
      ref={menuRef}
      role="menu"
      style={style}
    >
      <div className="context-menu-section" role="group">
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
      <div className="context-menu-section" role="group">
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
    </div>
  );
}
