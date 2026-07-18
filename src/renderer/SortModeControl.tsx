import { useEffect, useRef, useState } from "react";

import { Icon } from "./Icons";
import { useT } from "./i18n";
import type { SortDefinition } from "../shared/asset-types";

export type SortFieldOption = "relevance" | SortDefinition["field"];

export const PRIMARY_SORT_FIELDS: SortFieldOption[] = [
  "relevance",
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
    case "relevance":
      return t("filter.sortRelevance");
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
  const rootRef = useRef<HTMLDivElement>(null);
  const nonDefault = sortField !== "relevance" || sortOrder !== "asc";

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      const root = rootRef.current;
      if (!root || !(event.target instanceof Node)) return;
      if (!root.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  return (
    <div className="sort-mode-control" ref={rootRef}>
      <div className="dimension-filter-dim-sep" aria-hidden="true" />
      <div className="dimension-filter-dim">
        <button
          aria-expanded={open || undefined}
          aria-label={t("filter.sortMode")}
          className={`dimension-filter-btn${nonDefault ? " is-active" : ""}${open ? " is-open" : ""}`}
          disabled={disabled}
          onClick={() => setOpen((current) => !current)}
          type="button"
        >
          <Icon name="sliders" size={14} />
          <span>{labelForSortField(sortField, t)}</span>
        </button>
        {open && (
          <div
            aria-label={t("filter.sortMode")}
            className="dimension-filter-popover sort-mode-popover"
            role="listbox"
          >
            <div className="sort-mode-section-label">{t("filter.sortPrimary")}</div>
            {PRIMARY_SORT_FIELDS.map((field) => (
              <button
                aria-selected={sortField === field}
                className={`sort-mode-option${sortField === field ? " is-active" : ""}`}
                key={field}
                onClick={() => {
                  setSortField(field);
                  setOpen(false);
                }}
                role="option"
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
                onClick={() => {
                  setSortField(field);
                  setOpen(false);
                }}
                role="option"
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
          {sortOrder === "asc" ? "↑" : "↓"}
        </span>
      </button>
    </div>
  );
}
