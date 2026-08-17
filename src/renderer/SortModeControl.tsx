import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { Icon } from "./Icons";
import { useT } from "./i18n";
import type { SortDefinition } from "../shared/asset-types";
import { PortaledPopover } from "./PortaledPopover";
import {
  focusFirstRovingItem,
  handleRovingListKeyDown,
  ROVING_OPTION_SELECTOR,
} from "./roving-list-keyboard";

/** Field options + in-panel order radios share one arrow-key roving set. */
const SORT_PANEL_ROVING_SELECTOR = `${ROVING_OPTION_SELECTOR}, [role="radio"]`;

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

export const SORT_ORDER_OPTIONS: readonly SortDefinition["order"][] = [
  "asc",
  "desc",
];

export type SortModeControlProps = {
  disabled?: boolean;
  sortField: SortFieldOption;
  setSortField: (value: SortFieldOption) => void;
  sortOrder: SortDefinition["order"];
  setSortOrder: (value: SortDefinition["order"]) => void;
  /** Serpent-hm28: client-side shuffle mode (not a SortDefinition field). */
  shuffleActive?: boolean;
  onShuffle?: () => void;
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

function labelForSortOrder(
  order: SortDefinition["order"],
  t: ReturnType<typeof useT>,
): string {
  return order === "asc" ? t("filter.sortAsc") : t("filter.sortDesc");
}

export function SortModeControl({
  disabled,
  sortField,
  setSortField,
  sortOrder,
  setSortOrder,
  shuffleActive = false,
  onShuffle,
}: SortModeControlProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [keyboardNav, setKeyboardNav] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const dimRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const nonDefault =
    shuffleActive ||
    sortField !== DEFAULT_SORT_FIELD ||
    sortOrder !== DEFAULT_SORT_ORDER;
  const triggerLabel = shuffleActive
    ? t("filter.sortShuffle")
    : labelForSortField(sortField, t);

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
      if (!root || !(event.target instanceof Element)) return;
      if (root.contains(event.target)) return;
      if (event.target.closest("[data-dimension-filter-popover]")) return;
      closeList(false);
    };
    document.addEventListener("mousedown", onMouseDown, true);
    const raf = requestAnimationFrame(() => {
      const list = document.getElementById(listId);
      if (!(list instanceof HTMLDivElement)) return;
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
      focusFirstRovingItem(list, SORT_PANEL_ROVING_SELECTOR);
    });
    return () => {
      document.removeEventListener("mousedown", onMouseDown, true);
      cancelAnimationFrame(raf);
    };
  }, [listId, open]);

  function onListKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const list = event.currentTarget;
    const result = handleRovingListKeyDown({
      key: event.key,
      container: list,
      itemSelector: SORT_PANEL_ROVING_SELECTOR,
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

  function pickOrder(order: SortDefinition["order"]) {
    setSortOrder(order);
    closeList(true);
  }

  function pickShuffle() {
    onShuffle?.();
    closeList(true);
  }

  return (
    <div className="sort-mode-control" ref={rootRef}>
      <div className="dimension-filter-dim-sep" aria-hidden="true" />
      <div className="dimension-filter-dim" ref={dimRef}>
        <button
          aria-expanded={open || undefined}
          aria-haspopup="listbox"
          aria-label={`${t("filter.sortMode")}${shuffleActive ? "" : `, ${labelForSortOrder(sortOrder, t)}`}`}
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
          <span>{triggerLabel}</span>
          {!shuffleActive ? (
            <span className="sort-order-glyph" aria-hidden="true">
              <Icon
                name={sortOrder === "asc" ? "sort-asc" : "sort-desc"}
                size={14}
              />
            </span>
          ) : null}
        </button>
        {open && (
          <PortaledPopover
            anchorRef={dimRef}
            className={`dimension-filter-popover sort-mode-popover${keyboardNav ? " is-keyboard-navigation" : ""}`}
            id={listId}
            onKeyDown={onListKeyDown}
            onPointerMove={() => setKeyboardNav(false)}
            role="dialog"
          >
            <div
              aria-label={t("filter.sortDirection")}
              className="sort-mode-order-group"
              role="radiogroup"
            >
              <div className="sort-mode-section-label">
                {t("filter.sortDirection")}
              </div>
              {SORT_ORDER_OPTIONS.map((order) => (
                <button
                  aria-checked={!shuffleActive && sortOrder === order}
                  className={`sort-mode-option sort-mode-order-option${!shuffleActive && sortOrder === order ? " is-active" : ""}`}
                  key={order}
                  onClick={() => pickOrder(order)}
                  role="radio"
                  tabIndex={-1}
                  type="button"
                >
                  <Icon
                    name={order === "asc" ? "sort-asc" : "sort-desc"}
                    size={14}
                  />
                  <span>{labelForSortOrder(order, t)}</span>
                </button>
              ))}
            </div>
            <div
              aria-label={t("filter.sortMode")}
              className="sort-mode-field-list"
              role="listbox"
            >
              <div className="sort-mode-section-label">{t("filter.sortPrimary")}</div>
              {onShuffle ? (
                <button
                  aria-selected={shuffleActive}
                  className={`sort-mode-option${shuffleActive ? " is-active" : ""}`}
                  onClick={pickShuffle}
                  role="option"
                  tabIndex={-1}
                  type="button"
                >
                  {t("filter.sortShuffle")}
                </button>
              ) : null}
              {PRIMARY_SORT_FIELDS.map((field) => (
                <button
                  aria-selected={!shuffleActive && sortField === field}
                  className={`sort-mode-option${!shuffleActive && sortField === field ? " is-active" : ""}`}
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
                  aria-selected={!shuffleActive && sortField === field}
                  className={`sort-mode-option${!shuffleActive && sortField === field ? " is-active" : ""}`}
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
          </PortaledPopover>
        )}
      </div>
    </div>
  );
}
