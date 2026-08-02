import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { CollectionSummary } from "../shared/asset-types";
import { useContextMenu } from "./context-menu";
import { Icon } from "./Icons";
import { useT } from "./i18n";
import { moveTagSuggestionIndex } from "./tag-suggestions";

const RECENT_COLLECTIONS_KEY = "serpent.recentCollectionIds";
const RECENT_COLLECTION_LIMIT = 5;

function readRecentCollectionIds(): string[] {
  try {
    const value = JSON.parse(
      window.localStorage.getItem(RECENT_COLLECTIONS_KEY) ?? "[]",
    );
    return Array.isArray(value) && value.every((id) => typeof id === "string")
      ? value
      : [];
  } catch {
    return [];
  }
}

function rememberCollection(collectionId: string) {
  try {
    const next = [
      collectionId,
      ...readRecentCollectionIds().filter((id) => id !== collectionId),
    ].slice(0, RECENT_COLLECTION_LIMIT);
    window.localStorage.setItem(RECENT_COLLECTIONS_KEY, JSON.stringify(next));
  } catch {
    // localStorage may be unavailable in a restricted renderer context.
  }
}

interface CollectionPickerMenuProps {
  title: string;
  collections: readonly CollectionSummary[];
  excludedCollectionIds?: ReadonlySet<string>;
  onPick: (collectionId: string) => void;
}

/** Searchable, recent-first collection picker rendered in a hover submenu. */
export function CollectionPickerMenu({
  title,
  collections,
  excludedCollectionIds,
  onPick,
}: CollectionPickerMenuProps) {
  const t = useT();
  const { close } = useContextMenu();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const candidates = useMemo(() => {
    const available = collections.filter(
      (collection) => !excludedCollectionIds?.has(collection.collectionId),
    );
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const matching = normalizedQuery
      ? available.filter((collection) =>
          collection.name.toLocaleLowerCase().includes(normalizedQuery),
        )
      : available;
    if (normalizedQuery) return matching;
    const recentIds = readRecentCollectionIds();
    const byId = new Map(matching.map((collection) => [collection.collectionId, collection]));
    const recent = recentIds
      .map((id) => byId.get(id))
      .filter((collection): collection is CollectionSummary => collection !== undefined);
    const recentSet = new Set(recent.map((collection) => collection.collectionId));
    return [...recent, ...matching.filter((collection) => !recentSet.has(collection.collectionId))];
  }, [collections, excludedCollectionIds, query]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (activeIndex < 0) return;
    document
      .getElementById(`${listId}-option-${activeIndex}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, listId]);

  const pick = (collectionId: string) => {
    rememberCollection(collectionId);
    onPick(collectionId);
    close();
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      setActiveIndex((current) =>
        moveTagSuggestionIndex(
          current,
          event.key === "ArrowDown" ? 1 : -1,
          candidates.length,
        ),
      );
      return;
    }
    if (event.key === "Home" && candidates.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      setActiveIndex(0);
      return;
    }
    if (event.key === "End" && candidates.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      setActiveIndex(candidates.length - 1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      const target = candidates[activeIndex] ?? candidates[0];
      if (target) pick(target.collectionId);
    }
  };

  const recentIds = new Set(readRecentCollectionIds());
  const showRecentHeading = query.trim() === "" && candidates.some((collection) => recentIds.has(collection.collectionId));

  return (
    <div className="tag-picker collection-picker">
      <div className="tag-picker-header">
        <Icon name="collection" size={14} />
        <span className="tag-picker-title">{title}</span>
      </div>
      <div className="tag-picker-search">
        <Icon name="search" size={12} />
        <input
          aria-activedescendant={
            activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined
          }
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={candidates.length > 0}
          aria-label={t("collectionPicker.search")}
          autoComplete="off"
          className="tag-picker-search-input"
          maxLength={255}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(-1);
          }}
          onKeyDown={handleInputKeyDown}
          placeholder={t("collectionPicker.searchPlaceholder")}
          ref={inputRef}
          role="combobox"
          type="text"
          value={query}
        />
      </div>
      {candidates.length > 0 ? (
        <div aria-label={title} className="tag-picker-options" id={listId} role="listbox">
          {showRecentHeading && (
            <div className="context-menu-section-label">{t("collectionPicker.recent")}</div>
          )}
          {candidates.map((collection, index) => (
            <button
              aria-selected={index === activeIndex}
              className={`tag-picker-option${index === activeIndex ? " is-active" : ""}`}
              id={`${listId}-option-${index}`}
              key={collection.collectionId}
              onClick={() => pick(collection.collectionId)}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              role="option"
              tabIndex={-1}
              type="button"
            >
              <span className="tag-picker-option-icon"><Icon name="collection" size={14} /></span>
              <span className="tag-picker-option-name">{collection.name}</span>
              <span className="tag-picker-option-count">{collection.assetCount}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="tag-picker-empty">{t("collectionPicker.noMatch")}</div>
      )}
    </div>
  );
}
