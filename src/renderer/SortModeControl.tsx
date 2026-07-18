import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { Icon } from "./Icons";
import { useT } from "./i18n";
import type { SortDefinition } from "../shared/asset-types";
import {
  focusFirstRovingItem,
  handleRovingListKeyDown,
  ROVING_OPTION_SELECTOR,
} from "./roving-list-keyboard";

/** Browse/sort fields only — relevance removed from sort UI (REQ-SORT-003). */
export type SortFieldOption = SortDefinition["field"];

export const PRIMARY_SORT_FIELDS: SortFieldOption[] = [
  "name",
  "modified_at",
  "byte_size",
  "long_edge",
  "duration",
];

export const SECONDARY_SORT_FIELDS: SortFieldOption[] = [
  "created_at",
  "rating",
  "color",
  "author",
];

export const DEFAULT_SORT_FIELD: SortFieldOption = "name";
export const DEFAULT_SORT_ORDER: SortDefinition["order"] = "asc";

export type SortModeControlProps = {
  disabled?: boolean;
  sortField: SortFieldOption;
  setSortField: (value: SortFieldOption) => void;
  sortOrder: SortDefinition["order"];
  setSortOrder: (value: SortDefinition["order"]) => void;
};

function labelForSortField(
  field: SortFieldOption,
  t: ReturnType<typeof useT>,
): string {
  switch (field) {
    case "name":
      return t("filter.sortName");
    case "modified_at":
      return t("filter.sortModified");
    case "created_at":
      return t("filter.sortCreated");
    case "byte_size":
      return t("filter.sortSize");
    case "long_edge":
      return t("filter.sortResolution");
    case "duration":
      return t("filter.sortDuration");
    case "rating":
      return t("filter.sortRating");
    case "color":
      return t("filter.sortColor");
    case "author":
      return t("filter.sortAuthor");
  }
}

export function SortModeControl({
  disabled,
  sortField,
  setSortField,
  sortOrder,
  setSortOrder,
}: SortModeControlProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [keyboardNav, setKeyboardNav] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const nonDefault =
    sortField !== DEFAULT_SORT_FIELD || sortOrder !== DEFAULT_SORT_ORDER;

  function closeList(restoreTriggerFocus: boolean) {
    setOpen(false);
    setKeyboardNav(false);
    if (restoreTriggerFocus) {
      requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      const root = rootRef.current;
      if (!root || !(event.target instanceof Node)) return;
      if (!root.contains(event.target)) closeList(false);
    };
    document.addEventListener("mousedown", onMouseDown, true);
    const raf = requestAnimationFrame(() => {
      const list = listRef.current;
      if (!list) return;
      const selected = list.querySelector<HTMLElement>(
        '[role="option"][aria-selected="true"]',
      );
      if (
        selected &&
        !(selected instanceof HTMLButtonElement && selected.disabled)
      ) {
        selected.focus();
        return;
      }
      focusFirstRovingItem(list, ROVING_OPTION_SELECTOR);
    });
    return () => {
      document.removeEventListener("mousedown", onMouseDown, true);
      cancelAnimationFrame(raf);
    };
  }, [open]);

  function onListKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const list = listRef.current;
    if (!list) return;
    const result = handleRovingListKeyDown({
      key: event.key,
      container: list,
      itemSelector: ROVING_OPTION_SELECTOR,
    });
    if (!result.handled) return;
    event.preventDefault();
    event.stopPropagation();
    if (result.action === "escape") {
      closeList(true);
      return;
    }
    setKeyboardNav(true);
  }

  function pickField(field: SortFieldOption) {
    setSortField(field);
    closeList(true);
  }

  return (
    <div className="sort-mode-control" ref={rootRef}>
      <div className="dimension-filter-dim-sep" aria-hidden="true" />
      <div className="dimension-filter-dim">
        <button
          aria-expanded={open || undefined}
          aria-haspopup="listbox"
          aria-label={t("filter.sortMode")}
          className={`dimension-filter-btn${nonDefault ? " is-active" : ""}${open ? " is-open" : ""}`}
          disabled={disabled}
          onClick={() => {
            if (open) closeList(true);
            else setOpen(true);
          }}
          ref={triggerRef}
          type="button"
        >
          <Icon name="sliders" size={14} />
          <span>{labelForSortField(sortField, t)}</span>
        </button>
        {open && (
          <div
            aria-label={t("filter.sortMode")}
            className={`dimension-filter-popover sort-mode-popover${keyboardNav ? " is-keyboard-navigation" : ""}`}
            onKeyDown={onListKeyDown}
            onPointerMove={() => setKeyboardNav(false)}
            ref={listRef}
            role="listbox"
          >
            <div className="sort-mode-section-label">{t("filter.sortPrimary")}</div>
            {PRIMARY_SORT_FIELDS.map((field) => (
              <button
                aria-selected={sortField === field}
                className={`sort-mode-option${sortField === field ? " is-active" : ""}`}
                key={field}
                onClick={() => pickField(field)}
                role="option"
                tabIndex={-1}
                type="button"
              >
                {labelForSortField(field, t)}
              </button>
            ))}
            <div className="sort-mode-section-label">{t("filter.sortMore")}</div>
            {SECONDARY_SORT_FIELDS.map((field) => (
              <button
                aria-selected={sortField === field}
                className={`sort-mode-option${sortField === field ? " is-active" : ""}`}
                key={field}
                onClick={() => pickField(field)}
                role="option"
                tabIndex={-1}
                type="button"
              >
                {labelForSortField(field, t)}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        aria-label={
          sortOrder === "asc" ? t("filter.sortAsc") : t("filter.sortDesc")
        }
        className={`dimension-filter-btn sort-order-btn${sortOrder === "desc" ? " is-active" : ""}`}
        disabled={disabled}
        onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
        title={
          sortOrder === "asc" ? t("filter.sortAsc") : t("filter.sortDesc")
        }
        type="button"
      >
        <span className="sort-order-glyph" aria-hidden="true">
          <Icon name={sortOrder === "asc" ? "sort-asc" : "sort-desc"} size={14} />
        </span>
      </button>
    </div>
  );
}
