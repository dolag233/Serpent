import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { Icon, type IconName } from "./Icons";
import { useT } from "./i18n";
import {
  horizontalScrollDeltaFromWheel,
  nextTabStripScrollLeft,
} from "./workspace-tab-strip-scroll";
import { workspaceTabMaxWidthPx } from "./workspace-tabs";
import "./workspace-tabs.css";

export interface WorkspaceTabItem {
  id: string;
  title: string;
  /** Hover text; a folder tab names its location instead of repeating its label. */
  tip?: string;
  icon: IconName;
}

export interface WorkspaceTabsProps {
  tabs: readonly WorkspaceTabItem[];
  activeTabId: string;
  disabled?: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onClose: (id: string) => void;
  /** Drops the dragged tab at its final index in the strip. */
  onReorder: (id: string, toIndex: number) => void;
  onContextMenu: (id: string, position: { x: number; y: number }) => void;
}

export function WorkspaceTabs({
  tabs, activeTabId, disabled = false, onSelect, onAdd, onClose, onReorder,
  onContextMenu,
}: WorkspaceTabsProps) {
  const t = useT();
  const listRef = useRef<HTMLDivElement>(null);
  const buttonsRef = useRef(new Map<string, HTMLButtonElement>());
  const restoreFocusRef = useRef(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const canClose = tabs.length > 1;

  useEffect(() => {
    const list = listRef.current;
    const button = buttonsRef.current.get(activeTabId);
    if (!list || !button) return;
    if (restoreFocusRef.current) {
      button.focus({ preventScroll: true });
      restoreFocusRef.current = false;
    }
    const keepVisible = () => {
      const item = button.parentElement;
      if (!item) return;
      // Scroll only this strip: scrollIntoView can also move the workspace.
      const left = item.offsetLeft;
      const right = left + item.offsetWidth;
      if (left < list.scrollLeft) list.scrollLeft = left;
      else if (right > list.scrollLeft + list.clientWidth) {
        list.scrollLeft = right - list.clientWidth;
      }
    };
    keepVisible();
    const observer = new ResizeObserver(keepVisible);
    observer.observe(list);
    return () => observer.disconnect();
  }, [activeTabId, tabs.length]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const onWheel = (event: WheelEvent) => {
      if (list.scrollWidth <= list.clientWidth) return;
      const delta = horizontalScrollDeltaFromWheel(event, list.clientWidth);
      if (delta == null || delta === 0) return;
      event.preventDefault();
      list.scrollLeft = nextTabStripScrollLeft(
        list.scrollLeft,
        list.scrollWidth,
        list.clientWidth,
        delta,
      );
    };
    list.addEventListener("wheel", onWheel, { passive: false });
    return () => list.removeEventListener("wheel", onWheel);
  }, []);

  function closeTab(id: string) {
    restoreFocusRef.current = true;
    onClose(id);
  }

  /** Live reorder: the hovered half of a tab decides which side the drag lands on. */
  function handleDragOver(
    event: DragEvent<HTMLDivElement>,
    index: number,
  ) {
    if (disabled || !draggingId || draggingId === tabs[index]?.id) return;
    const fromIndex = tabs.findIndex((tab) => tab.id === draggingId);
    if (fromIndex < 0) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const rect = event.currentTarget.getBoundingClientRect();
    const target = index + (event.clientX > rect.left + rect.width / 2 ? 1 : 0);
    const toIndex = target > fromIndex ? target - 1 : target;
    if (toIndex !== fromIndex) onReorder(draggingId, toIndex);
  }

  function handleKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (disabled || event.altKey || event.ctrlKey || event.metaKey) return;
    const tab = tabs[index];
    if (!tab) return;
    const id = tab.id;
    if (event.key === "Delete") {
      event.preventDefault();
      event.stopPropagation();
      if (canClose) closeTab(id);
      return;
    }
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault();
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      onContextMenu(id, { x: rect.left, y: rect.bottom });
      return;
    }
    const target = event.key === "ArrowRight" ? (index + 1) % tabs.length
      : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length
      : event.key === "Home" ? 0
      : event.key === "End" ? tabs.length - 1 : -1;
    if (target < 0) return;
    event.preventDefault();
    event.stopPropagation();
    const targetTab = tabs[target];
    if (!targetTab) return;
    onSelect(targetTab.id);
    buttonsRef.current.get(targetTab.id)?.focus();
  }

  return (
    <div
      className="workspace-tabs"
      style={{
        "--workspace-tab-max-width": `${workspaceTabMaxWidthPx(tabs.length)}px`,
      } as CSSProperties}
    >
      <div className="workspace-tabs-list" role="tablist" aria-label={t("tabs.label")} ref={listRef}>
        {tabs.map((tab, index) => (
          <div
            className={`workspace-tab${tab.id === activeTabId ? " is-active" : ""}`}
            key={tab.id}
            draggable={!disabled}
            onDragStart={(event) => {
              if (disabled) {
                event.preventDefault();
                return;
              }
              setDraggingId(tab.id);
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", tab.id);
            }}
            onDragOver={(event) => handleDragOver(event, index)}
            onDrop={(event) => {
              // Only claim drops that this strip started; a file dragged in from
              // the desktop keeps its default handling.
              if (!draggingId) return;
              event.preventDefault();
              setDraggingId(null);
            }}
            onDragEnd={() => setDraggingId(null)}
            onContextMenu={(event) => {
              event.preventDefault();
              if (!disabled) onContextMenu(tab.id, { x: event.clientX, y: event.clientY });
            }}
          >
            <button
              className="workspace-tab-select"
              type="button"
              role="tab"
              aria-selected={tab.id === activeTabId}
              aria-label={tab.title}
              tabIndex={tab.id === activeTabId ? 0 : -1}
              disabled={disabled}
              data-hover-tip={tab.tip ?? tab.title}
              ref={(node) => {
                if (node) buttonsRef.current.set(tab.id, node);
                else buttonsRef.current.delete(tab.id);
              }}
              onClick={() => onSelect(tab.id)}
              onKeyDown={(event) => handleKey(event, index)}
            >
              <Icon name={tab.icon} size={16} />
              <span className="workspace-tab-title">{tab.title}</span>
            </button>
            {canClose ? (
              <button
                className="workspace-tab-close"
                type="button"
                disabled={disabled}
                aria-label={t("tabs.closeNamed", { name: tab.title })}
                data-hover-tip={t("tabs.close")}
                onClick={() => closeTab(tab.id)}
              >
                <Icon name="close" size={12} />
              </button>
            ) : null}
          </div>
        ))}
      </div>
      <button
        className="workspace-tab-add"
        type="button"
        disabled={disabled}
        aria-label={t("tabs.add")}
        data-hover-tip={t("tabs.add")}
        onClick={() => {
          restoreFocusRef.current = true;
          onAdd();
        }}
      >
        <Icon name="plus" size={16} />
      </button>
    </div>
  );
}
