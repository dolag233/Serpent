import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icons";
import { useT } from "./i18n";

export type WorkspaceOverflowItem = {
  id: string;
  label: string;
  disabled?: boolean;
  onSelect: () => void;
};

/**
 * CU-B5: when the workspace bar is tight, utility actions live in a "More"
 * menu instead of being clipped to width 0 with no discoverable entry.
 */
export function WorkspaceToolsOverflow({
  items,
}: {
  items: readonly WorkspaceOverflowItem[];
}): ReactNode {
  const t = useT();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
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

  if (items.length === 0) return null;

  return (
    <div className="workspace-tools-overflow" ref={rootRef}>
      <button
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t("shell.moreWorkspaceTools")}
        className="tool-button"
        data-hover-tip={t("shell.moreWorkspaceTools")}
        onClick={() => setOpen((value) => !value)}
        title={t("shell.moreWorkspaceTools")}
        type="button"
      >
        <Icon name="menu" size={14} />
      </button>
      {open && (
        <div className="workspace-tools-overflow-menu" id={menuId} role="menu">
          {items.map((item) => (
            <button
              className="library-switcher-item"
              disabled={item.disabled}
              key={item.id}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              role="menuitem"
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
