import { useEffect } from "react";

import { createCommandRegistry } from "./commands/command-registry";
import {
  matchesShortcut,
  type CommandPlatform,
  type ShortcutSpec,
} from "./commands/command-types";
import {
  sidebarCommandDefinitions,
  type SidebarCommandDefinition,
} from "./commands/sidebar-commands";

const collectionKeyboardCommandRegistry = createCommandRegistry(
  sidebarCommandDefinitions as readonly SidebarCommandDefinition[],
);

type CollectionShortcutCommandId =
  | "collection.rename"
  | "collection.delete";

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function matchCollectionShortcut(
  commandId: CollectionShortcutCommandId,
  event: KeyboardEvent,
  platform: CommandPlatform,
): boolean {
  const spec: ShortcutSpec | undefined =
    collectionKeyboardCommandRegistry.get(commandId)?.shortcut;
  return spec !== undefined && matchesShortcut(spec, event, platform);
}

export type UseCollectionCommandShortcutsArgs = {
  readonly enabled: boolean;
  readonly platform: CommandPlatform;
  readonly previewOpen: boolean;
  readonly renameCollection: (collectionId: string, currentName: string) => void;
  readonly deleteCollection: (collectionId: string, name: string) => void;
};

/**
 * Handles F2/Delete while a collection row owns sidebar focus. Keeping this
 * separate from canvas asset shortcuts prevents Delete from removing members
 * when the user is operating on the collection itself.
 */
export function useCollectionCommandShortcuts(
  args: UseCollectionCommandShortcutsArgs,
): void {
  const {
    enabled,
    platform,
    previewOpen,
    renameCollection,
    deleteCollection,
  } = args;

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableKeyboardTarget(event.target)) return;
      if (previewOpen) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;

      const focused = document.activeElement?.closest<HTMLElement>(
        "[data-nav-collection-id]",
      );
      if (!focused) return;
      const collectionId = focused.dataset.navCollectionId?.trim();
      if (!collectionId) return;
      const name = focused.querySelector<HTMLElement>(
        ".nav-row-label",
      )?.textContent?.trim();
      if (!name) return;

      if (matchCollectionShortcut("collection.rename", event, platform)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        renameCollection(collectionId, name);
        return;
      }
      if (matchCollectionShortcut("collection.delete", event, platform)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        deleteCollection(collectionId, name);
      }
    };

    document.addEventListener("keydown", onKeyDown, platform === "windows");
    return () => document.removeEventListener("keydown", onKeyDown, platform === "windows");
  }, [
    enabled,
    platform,
    previewOpen,
    renameCollection,
    deleteCollection,
  ]);
}
