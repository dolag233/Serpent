import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { TagSummary } from "../shared/asset-types";
import { useContextMenu } from "./context-menu";
import { Icon } from "./Icons";
import { useT } from "./i18n";
import { moveTagSuggestionIndex } from "./tag-suggestions";
import {
  buildTagAssignCandidates,
  buildTagRemoveCandidates,
} from "./tag-picker-candidates";

// ---------------------------------------------------------------------------
// TagPickerMenu — searchable secondary view rendered inside the open
// ContextMenu (REQ-TAG-004). It replaces the menu body instead of enumerating
// one row per tag.
//
// Highlight convention: the search input keeps DOM focus, so options are
// role="option" (not role="menuitem") and ContextMenu's focus/arrow handling
// does not see them. A single `is-active` option follows pointer hover and
// ArrowUp/ArrowDown, mirroring the menu's one-highlight rule. Escape is left
// to ContextMenuBackdrop and closes the whole menu; the back button is the
// explicit return path.
// ---------------------------------------------------------------------------

interface TagPickerMenuProps {
  mode: "assign" | "remove";
  tags: TagSummary[];
  /** Tags to hide from the assign picker (e.g. already on the asset). */
  excludedTagIds?: ReadonlySet<string>;
  onBack: () => void;
  onPick: (tagId: string) => void;
}

export function TagPickerMenu({
  mode,
  tags,
  excludedTagIds,
  onBack,
  onPick,
}: TagPickerMenuProps) {
  const t = useT();
  const { close } = useContextMenu();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const title =
    mode === "assign" ? t("batch.assignTag") : t("batch.removeTag");

  const candidates = useMemo(
    () =>
      mode === "assign"
        ? buildTagAssignCandidates(tags, query, excludedTagIds ?? new Set(), {
            includeUnusedTags: true,
          })
        : buildTagRemoveCandidates(tags, query),
    [mode, tags, query, excludedTagIds],
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Keep the keyboard-driven highlight visible in long lists.
  useEffect(() => {
    if (activeIndex < 0) return;
    document
      .getElementById(`${listId}-option-${activeIndex}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, listId]);

  const pick = (tagId: string) => {
    onPick(tagId);
    close();
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      // Keep ContextMenu from treating these as menuitem navigation.
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
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      // No explicit highlight: confirm the top match directly.
      const target = candidates[activeIndex] ?? candidates[0];
      if (target) pick(target.tagId);
    }
  };

  return (
    <div className="tag-picker">
      <div className="tag-picker-header">
        <button
          aria-label={t("tagPicker.backAria")}
          title={t("tagPicker.backAria")}
          className="tag-picker-back"
          onClick={onBack}
          type="button"
        >
          <Icon name="chevron-left" size={12} />
          <span>{t("tagPicker.back")}</span>
        </button>
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
          aria-label={
            mode === "assign"
              ? t("tagPicker.searchAssign")
              : t("tagPicker.searchRemove")
          }
          autoComplete="off"
          className="tag-picker-search-input"
          maxLength={255}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(-1);
          }}
          onKeyDown={handleInputKeyDown}
          placeholder={t("tagPicker.searchPlaceholder")}
          ref={inputRef}
          role="combobox"
          type="text"
          value={query}
        />
      </div>
      {candidates.length > 0 ? (
        <div
          aria-label={title}
          className="tag-picker-options"
          id={listId}
          role="listbox"
        >
          {candidates.map((tag, index) => (
            <button
              aria-selected={index === activeIndex}
              className={`tag-picker-option${index === activeIndex ? " is-active" : ""}`}
              id={`${listId}-option-${index}`}
              key={tag.tagId}
              onClick={() => pick(tag.tagId)}
              onMouseEnter={() => setActiveIndex(index)}
              role="option"
              type="button"
            >
              <span className="tag-picker-option-icon">
                <Icon name="tag" size={14} />
              </span>
              <span className="tag-picker-option-name">{tag.name}</span>
              <span className="tag-picker-option-count">{tag.assetCount}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="tag-picker-empty">{t("tagPicker.noMatch")}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TagPickerEntry — menu row that swaps the ContextMenu body to the picker.
// Mirrors ContextMenuItem markup/focus behavior, but does NOT close the menu
// on click (ContextMenuItem always closes; opening the picker must not).
// ---------------------------------------------------------------------------

interface TagPickerEntryProps {
  icon: ReactNode;
  label: string;
  onOpen: () => void;
}

export function TagPickerEntry({ icon, label, onOpen }: TagPickerEntryProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  return (
    <button
      aria-haspopup="menu"
      aria-label={label}
      title={label}
      className="context-menu-item"
      onClick={onOpen}
      onMouseEnter={() => buttonRef.current?.focus()}
      ref={buttonRef}
      role="menuitem"
      tabIndex={-1}
      type="button"
    >
      <span className="context-menu-item-icon">{icon}</span>
      <span className="context-menu-item-label">{label}</span>
      <span className="context-menu-item-shortcut" aria-hidden="true">
        <Icon name="chevron-right" size={10} />
      </span>
    </button>
  );
}
