import { useState } from "react";
import type { TagSummary } from "../shared/asset-types";
import {
  applyTagFilterClick,
  type TagFilterSelection,
} from "./dimension-filter-selection";
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
// removable chips; the input searches the library's complete tag set (usage
// count shown). Selecting a
// tag adds it to the same comma-separated tagFilter the query layer already
// ORs within the tag field, so no protocol change is needed.
//
// REQ-FILTER-025: clicking (or pressing Enter on) a suggestion replaces the
// tag selection with just that tag by default; Shift+click/Enter
// OR-accumulates it into the include set. Right-click does the same for the
// exclude set. The two sets stay together, so one tag can be selected while
// another is excluded.
//
// REQ-FILTER-020: the suggestion area renders inline (not as a floating
// overlay gated behind focus), so it always shows something as soon as the
// popover opens — either the empty-query "all tags" + "recently filtered"
// sections, or the live search results once the user types. Rendering
// inline also removes the old absolutely-positioned dropdown that previously
// left a large blank gap in the popover (see styles.css history for
// `.filter-tag-picker`'s `flex: 1 1 220px` regression).
// ---------------------------------------------------------------------------

function TagOptionList({
  tags,
  className,
  onContextMenuSelect,
  onSelect,
}: {
  tags: readonly TagSummary[];
  className?: string;
  onContextMenuSelect: (name: string, shiftKey: boolean) => void;
  onSelect: (name: string, shiftKey: boolean) => void;
}) {
  return (
    <ul className={`filter-tag-options${className ? ` ${className}` : ""}`} role="listbox">
      {tags.map((tag) => (
        <li key={tag.tagId} role="option" aria-selected={false}>
          <button
            onClick={(event) => onSelect(tag.name, event.shiftKey)}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onContextMenuSelect(tag.name, event.shiftKey);
            }}
            type="button"
          >
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
  includedNames,
  excludedNames,
  recentNames = [],
  onChange,
  disabled,
}: {
  tags: TagSummary[];
  includedNames: string[];
  excludedNames: string[];
  /** Tag names recently applied as a filter, most-recent-first. */
  recentNames?: readonly string[];
  onChange: (next: TagFilterSelection) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<TagSortKey>("count");
  const [sortDirection, setSortDirection] = useState<TagSortDirection>("desc");

  const trimmed = query.trim();
  const isSearching = trimmed.length > 0;
  const occupiedNames = [...includedNames, ...excludedNames];
  const searchResults = isSearching
    ? sortTags(
        buildTagFilterSearchResults(tags, occupiedNames, trimmed),
        sortKey,
        sortDirection,
      )
    : [];
  const { all, recent } = isSearching
    ? { all: [], recent: [] }
    : buildTagFilterDefaultSections(tags, occupiedNames, recentNames);
  const sortedAll = sortTags(all, sortKey, sortDirection);
  const sortedRecent = sortTags(recent, sortKey, sortDirection);
  const firstCandidate = isSearching
    ? searchResults[0]
    : sortedRecent[0] ?? sortedAll[0];

  const handleSortClick = (nextKey: TagSortKey) => {
    if (sortKey === nextKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDirection(nextKey === "count" ? "desc" : "asc");
  };

  const choose = (name: string, side: "include" | "exclude", shiftKey: boolean) => {
    onChange(applyTagFilterClick(
      { includes: includedNames, excludes: excludedNames },
      name,
      side,
      shiftKey,
    ));
    setQuery("");
  };
  const remove = (name: string, side: "include" | "exclude") => {
    onChange({
      includes: side === "include"
        ? includedNames.filter((candidate) => candidate !== name)
        : includedNames,
      excludes: side === "exclude"
        ? excludedNames.filter((candidate) => candidate !== name)
        : excludedNames,
    });
  };

  return (
    <div className="filter-tag-picker">
      {(includedNames.length > 0 || excludedNames.length > 0) && (
        <div className="filter-tag-chips">
          {includedNames.map((name) => (
            <span className="filter-tag-chip is-selected" key={`include:${name}`}>
              <span className="filter-tag-chip-label">{name}</span>
              <button
                aria-label={t("filter.removeTagFilter", { name })}
                data-hover-tip={t("filter.removeTagFilter", { name })}
                onClick={() => remove(name, "include")}
                type="button"
              >
                <Icon name="close" size={11} />
              </button>
            </span>
          ))}
          {excludedNames.map((name) => (
            <span className="filter-tag-chip is-selected is-excluding" key={`exclude:${name}`}>
              <span className="filter-tag-chip-label">{name}</span>
              <button
                aria-label={t("filter.removeTagFilter", { name })}
                data-hover-tip={t("filter.removeTagFilter", { name })}
                onClick={() => remove(name, "exclude")}
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
        data-hover-tip={t("filter.tagFilter")}
        className="text-field"
        disabled={disabled}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (isImeKeyboardEvent(event)) return;
          if (event.key === "Enter") {
            event.preventDefault();
            if (firstCandidate) choose(firstCandidate.name, "include", event.shiftKey);
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
                data-hover-tip={
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
                <div className="filter-tag-section filter-tag-all-section">
                  <div className="filter-tag-section-label">
                    {t("filter.allTags")}
                  </div>
                  <div className="filter-tag-all-scroll">
                    <TagOptionList
                    tags={searchResults}
                    onContextMenuSelect={(name, shiftKey) => choose(name, "exclude", shiftKey)}
                    onSelect={(name, shiftKey) => choose(name, "include", shiftKey)}
                  />
                  </div>
                </div>
              )
            : (sortedAll.length > 0 || sortedRecent.length > 0) && (
                <>
                  {sortedRecent.length > 0 && (
                    <div className="filter-tag-section filter-tag-recent-section">
                      <div className="filter-tag-section-label">
                        {t("filter.recentTags")}
                      </div>
                      <TagOptionList
                        className="filter-tag-recent-options"
                        tags={sortedRecent}
                        onContextMenuSelect={(name, shiftKey) => choose(name, "exclude", shiftKey)}
                        onSelect={(name, shiftKey) => choose(name, "include", shiftKey)}
                      />
                    </div>
                  )}
                  {sortedAll.length > 0 && (
                    <div className="filter-tag-section filter-tag-all-section">
                      <div className="filter-tag-section-label">
                        {t("filter.allTags")}
                      </div>
                      <div className="filter-tag-all-scroll">
                        <TagOptionList
                          tags={sortedAll}
                          onContextMenuSelect={(name, shiftKey) => choose(name, "exclude", shiftKey)}
                          onSelect={(name, shiftKey) => choose(name, "include", shiftKey)}
                        />
                      </div>
                    </div>
                  )}
                </>
              )}
        </div>
      )}
    </div>
  );
}
