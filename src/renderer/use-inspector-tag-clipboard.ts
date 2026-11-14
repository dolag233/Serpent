import { useState } from "react";

import { applyTagSelectionClick, type TagSelectionState } from "./tag-management-model";
import { computeMarqueeSelection, type MarqueeModifierSnapshot } from "./marquee-selection";
import { resolveSelectionPlatform } from "./selection-modifiers";

type Tag = { id: string; name: string };

/** Selection and plain-text transfer for the Inspector's existing tag editor. */
export function useInspectorTagClipboard(selectionKey: string, tags: readonly Tag[]) {
  const initial = (): { key: string; selection: TagSelectionState } => ({
    key: selectionKey,
    selection: { selectedIds: [], anchorId: null },
  });
  const [state, setState] = useState(initial);
  if (state.key !== selectionKey) setState(initial());
  const ids = state.key === selectionKey ? state.selection.selectedIds : [];
  const selectedIds = ids.filter(id => tags.some(tag => tag.id === id));
  const selectedNames = tags.filter(tag => selectedIds.includes(tag.id)).map(tag => tag.name);

  return {
    selectedIds,
    selectedNames,
    clear: () => setState(initial()),
    select: (id: string, options: { toggle: boolean; range: boolean }) => {
      setState(current => ({
        key: selectionKey,
        selection: applyTagSelectionClick(
          current.key === selectionKey
            ? { ...current.selection, selectedIds: current.selection.selectedIds.filter(selectedId => tags.some(tag => tag.id === selectedId)) }
            : initial().selection,
          id,
          tags.map(tag => tag.id),
          options,
        ),
      }));
    },
    marquee: (hitIds: string[], initialIds: string[], modifiers: MarqueeModifierSnapshot) => {
      const visibleIds = new Set(tags.map(tag => tag.id));
      const selected = computeMarqueeSelection(
        initialIds.filter(id => visibleIds.has(id)),
        hitIds.filter(id => visibleIds.has(id)),
        modifiers,
        resolveSelectionPlatform(navigator.userAgent),
      );
      setState({
        key: selectionKey,
        selection: { selectedIds: selected, anchorId: hitIds.at(-1) ?? selected.at(-1) ?? null },
      });
    },
  };
}

/** One tag name per line; ignore duplicates and blank clipboard lines. */
export function parseTagClipboardText(text: string): string[] {
  const seen = new Set<string>();
  return text.split(/\r?\n/u).map(name => name.trim()).filter(name => {
    const key = name.toLocaleLowerCase();
    if (!name || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function copyTagNames(
  names: readonly string[],
  clipboard: Pick<Clipboard, "writeText">,
): Promise<void> {
  if (names.length > 0) await clipboard.writeText(names.join("\n"));
}

export async function readTagNames(
  clipboard: Pick<Clipboard, "readText">,
): Promise<string[]> {
  return parseTagClipboardText(await clipboard.readText());
}
