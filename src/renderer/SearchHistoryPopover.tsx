import { useT } from "./i18n";

export function SearchHistoryPopover({
  items,
  activeIndex,
  onPick,
  onClear,
  onHighlight,
}: {
  readonly items: readonly string[];
  readonly activeIndex: number;
  readonly onPick: (query: string) => void;
  readonly onClear: () => void;
  readonly onHighlight: (index: number) => void;
}) {
  const t = useT();
  if (items.length === 0) return null;
  return (
    <div
      className="dimension-filter-popover search-history-popover"
      id="search-history-list"
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="search-history-header">
        <span>{t("toolbar.recentSearches")}</span>
        <button className="search-history-clear" type="button" onClick={onClear}>
          {t("toolbar.clearSearchHistory")}
        </button>
      </div>
      <div
        className="search-history-chips"
        role="listbox"
        aria-label={t("toolbar.recentSearches")}
      >
        {items.map((query, index) => (
          <button
            key={query}
            id={`search-history-${index}`}
            data-search-history-chip=""
            className={`search-history-item${
              index === activeIndex ? " is-highlighted" : ""
            }`}
            role="option"
            aria-selected={index === activeIndex}
            type="button"
            title={query}
            onMouseEnter={() => onHighlight(index)}
            onClick={() => onPick(query)}
          >
            {query}
          </button>
        ))}
      </div>
    </div>
  );
}
