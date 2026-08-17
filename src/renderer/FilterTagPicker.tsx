import { useState } from "react";
import type { TagSummary } from "../shared/asset-types";
import { applyDimensionSelectionClick } from "./dimension-filter-selection";
import {
  buildTagFilterDefaultSections,
  buildTagFilterSearchResults,
} from "./tag-filter-suggestions";
import { Icon } from "./Icons";
import { useT } from "./i18n";

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

  const trimmed = query.trim();
  const isSearching = trimmed.length > 0;
  const searchResults = isSearching
    ? buildTagFilterSearchResults(tags, selectedNames, trimmed)
    : [];
  const { top, recent } = isSearching
    ? { top: [], recent: [] }
    : buildTagFilterDefaultSections(tags, selectedNames, recentNames);
  const firstCandidate = isSearching ? searchResults[0] : recent[0] ?? top[0];

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
          {isSearching
            ? searchResults.length > 0 && (
                <TagOptionList tags={searchResults} onSelect={add} />
              )
            : (top.length > 0 || recent.length > 0) && (
                <>
                  {recent.length > 0 && (
                    <div className="filter-tag-section">
                      <div className="filter-tag-section-label">
                        {t("filter.recentTags")}
                      </div>
                      <TagOptionList tags={recent} onSelect={add} />
                    </div>
                  )}
                  {top.length > 0 && (
                    <div className="filter-tag-section">
                      <div className="filter-tag-section-label">
                        {t("filter.topTags")}
                      </div>
                      <TagOptionList tags={top} onSelect={add} />
                    </div>
                  )}
                </>
              )}
        </div>
      )}
    </div>
  );
}
