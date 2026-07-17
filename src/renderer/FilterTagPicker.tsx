import { useEffect, useRef, useState } from "react";
import type { TagSummary } from "../shared/asset-types";
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
// ---------------------------------------------------------------------------

export function FilterTagPicker({
  tags,
  selectedNames,
  onChange,
  disabled,
}: {
  tags: TagSummary[];
  selectedNames: string[];
  onChange: (names: string[]) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close the dropdown on outside pointer down.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const lowered = query.trim().toLowerCase();
  const candidates = tags
    .filter((tag) => !selectedNames.includes(tag.name))
    .filter((tag) => !lowered || tag.name.toLowerCase().includes(lowered))
    .sort((a, b) => b.assetCount - a.assetCount)
    .slice(0, 20);

  const add = (name: string) => {
    if (selectedNames.includes(name)) return;
    onChange([...selectedNames, name]);
    setQuery("");
  };
  const remove = (name: string) =>
    onChange(selectedNames.filter((candidate) => candidate !== name));

  return (
    <div className="filter-tag-picker" ref={rootRef}>
      {selectedNames.length > 0 && (
        <div className="filter-tag-chips">
          {selectedNames.map((name) => (
            <span className="filter-tag-chip" key={name}>
              {name}
              <button
                aria-label={t("filter.removeTagFilter", { name })}
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
        className="text-field"
        disabled={disabled}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            const first = candidates[0];
            if (first) add(first.name);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={t("filter.searchAddTag")}
        value={query}
      />
      {open && !disabled && candidates.length > 0 && (
        <ul
          aria-label={t("filter.addableTags")}
          className="filter-tag-options"
          role="listbox"
        >
          {candidates.map((tag) => (
            <li key={tag.tagId} role="option" aria-selected={false}>
              <button onClick={() => add(tag.name)} type="button">
                <span>{tag.name}</span>
                <span className="filter-tag-count">{tag.assetCount}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
