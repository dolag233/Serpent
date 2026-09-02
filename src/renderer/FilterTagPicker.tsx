import { useState } from "react";
import type { TagSummary } from "../shared/asset-types";
import { applyDimensionSelectionClick } from "./dimension-filter-selection";
import {
  buildTagFilterDefaultSections,
  buildTagFilterSearchResults,
} from "./tag-filter-suggestions";
import {
  sortTags,
  type TagSortDirection,
  type TagSortKey,
} from "./tag-management-model";
import { Icon } from "./Icons";
import { useT } from "./i18n";
import { isImeKeyboardEvent } from "./ime-safe-dismiss";

// ---------------------------------------------------------------------------
// FilterTagPicker (REQ-TAG-002)
//
// Multi-tag picker for the discovery filter panel: selected tags render as
// removable chips; the input searches the library's tags (usage count shown,
// top 20 by count — the full list is never dumped into the UI). Selecting a
// tag adds it to the same comma-separated tagFilter the query layer already
// ORs within the tag field, so no protocol change is needed.
//
// REQ-FILTER-025: clicking (or pressing Enter on) a suggestion replaces the
// tag selection with just that tag by default; Shift+click/Enter
// OR-accumulates it into the existing selection instead.
//
// REQ-FILTER-020: the suggestion area renders inline (not as a floating
// overlay gated behind focus), so it always shows something as soon as the
// popover opens — either the empty-query "top used" + "recently filtered"
// sections, or the live search results once the user types. Rendering
// inline also removes the old absolutely-positioned dropdown that previously
// left a large blank gap in the popover (see styles.css history for
// `.filter-tag-picker`'s `flex: 1 1 220px` regression).
// ---------------------------------------------------------------------------

function TagOptionList({
  tags,
  onSelect,
}: {
  tags: readonly TagSummary[];
  onSelect: (name: string, shiftKey: boolean) => void;
}) {
  return (
    <ul className="filter-tag-options" role="listbox">
      {tags.map((tag) => (
        <li key={tag.tagId} role="option" aria-selected={false}>
          <button onClick={(event) => onSelect(tag.name, event.shiftKey)} type="button">
            <span>{tag.name}</span>
            <span className="filter-tag-count">{tag.assetCount}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function FilterTagPicker({
  tags,
  selectedNames,
  recentNames = [],
  onChange,
  disabled,
}: {
  tags: TagSummary[];
  selectedNames: string[];
  /** Tag names recently applied as a filter, most-recent-first. */
  recentNames?: readonly string[];
  onChange: (names: string[]) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<TagSortKey>("count");
  const [sortDirection, setSortDirection] = useState<TagSortDirection>("desc");

  const trimmed = query.trim();
  const isSearching = trimmed.length > 0;
  const searchResults = isSearching
    ? sortTags(
        buildTagFilterSearchResults(tags, selectedNames, trimmed),
        sortKey,
        sortDirection,
      )
    : [];
  const { top, recent } = isSearching
    ? { top: [], recent: [] }
    : buildTagFilterDefaultSections(tags, selectedNames, recentNames);
  const sortedTop = sortTags(top, sortKey, sortDirection);
  const sortedRecent = sortTags(recent, sortKey, sortDirection);
  const firstCandidate = isSearching
    ? searchResults[0]
    : sortedRecent[0] ?? sortedTop[0];

  const handleSortClick = (nextKey: TagSortKey) => {
    if (sortKey === nextKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDirection(nextKey === "count" ? "desc" : "asc");
  };

  const add = (name: string, shiftKey: boolean) => {
    onChange(applyDimensionSelectionClick(selectedNames, name, shiftKey));
    setQuery("");
  };
  const remove = (name: string) =>
    onChange(selectedNames.filter((candidate) => candidate !== name));

  return (
    <div className="filter-tag-picker">
      {selectedNames.length > 0 && (
        <div className="filter-tag-chips">
          {selectedNames.map((name) => (
            <span className="filter-tag-chip" key={name}>
              {name}
              <button
                aria-label={t("filter.removeTagFilter", { name })}
                title={t("filter.removeTagFilter", { name })}
                onClick={() => remove(name)}
                type="button"
              >
                <Icon name="close" size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        aria-label={t("filter.tagFilter")}
        title={t("filter.tagFilter")}
        className="text-field"
        disabled={disabled}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (isImeKeyboardEvent(event)) return;
          if (event.key === "Enter") {
            event.preventDefault();
            if (firstCandidate) add(firstCandidate.name, event.shiftKey);
          }
        }}
        placeholder={t("filter.searchAddTag")}
        value={query}
      />
      {!disabled && (
        <div className="filter-tag-suggestions" aria-label={t("filter.addableTags")}>
          <div
            aria-label={t("filter.tagSort")}
            className="filter-tag-sort tag-management-sort"
            role="group"
          >
            {(["count", "name"] as const).map((key) => (
              <button
                aria-pressed={sortKey === key}
                className={`dimension-filter-btn${sortKey === key ? " is-active" : ""}`}
                key={key}
                onClick={() => handleSortClick(key)}
                title={
                  sortKey === key
                    ? t(sortDirection === "asc" ? "filter.sortAsc" : "filter.sortDesc")
                    : undefined
                }
                type="button"
              >
                {t(key === "count" ? "filter.tagSortCount" : "filter.tagSortName")}
                {sortKey === key ? (
                  <span aria-hidden="true" className="sort-order-glyph">
                    <Icon
                      name={sortDirection === "asc" ? "sort-asc" : "sort-desc"}
                      size={14}
                    />
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          {isSearching
            ? searchResults.length > 0 && (
                <TagOptionList tags={searchResults} onSelect={add} />
              )
            : (sortedTop.length > 0 || sortedRecent.length > 0) && (
                <>
                  {sortedRecent.length > 0 && (
                    <div className="filter-tag-section">
                      <div className="filter-tag-section-label">
                        {t("filter.recentTags")}
                      </div>
                      <TagOptionList tags={sortedRecent} onSelect={add} />
                    </div>
                  )}
                  {sortedTop.length > 0 && (
                    <div className="filter-tag-section">
                      <div className="filter-tag-section-label">
                        {t("filter.topTags")}
                      </div>
                      <TagOptionList tags={sortedTop} onSelect={add} />
                    </div>
                  )}
                </>
              )}
        </div>
      )}
    </div>
  );
}
