/**
 * Browse-canvas asset action chords (open-external / trash / rename).
 *
 * Pure match helpers — useBrowseCommandKeyboard owns the DOM listener.
 * Shortcut specs come from assetCommandDefinitions (REQ-COMMAND-002).
 */

import {
  assetCommandDefinitions,
} from "./commands/asset-commands";
import { createCommandRegistry } from "./commands/command-registry";
import {
  matchesShortcut,
  type CommandPlatform,
  type ShortcutEvent,
  type ShortcutSpec,
} from "./commands/command-types";
import {
  asLegacyKeyboardShortcutEvent,
  matchesRuntimeShortcut,
} from "./shortcut-runtime";
import type { ShortcutEventLike } from "../shared/shortcut-resolution";

const assetKeyboardCommandRegistry = createCommandRegistry(
  assetCommandDefinitions,
);

export type AssetActionKeyboardCommand =
  | "asset.open-external"
  | "asset.move-to-trash"
  | "asset.rename"
  | "asset.copy"
  | "asset.cut"
  | "asset.copy-file-path"
  | "asset.paste"
  | "asset.reveal-in-folder"
  | "asset.show-in-library-folder"
  | "asset.delete-from-disk";

export function matchAssetActionKeyboardCommand(
  commandId: AssetActionKeyboardCommand,
  event: ShortcutEvent | ShortcutEventLike,
  platform: CommandPlatform,
): boolean {
  const resolved = matchesRuntimeShortcut(commandId, event, platform);
  if (resolved !== null) return resolved;
  const spec: ShortcutSpec | undefined =
    assetKeyboardCommandRegistry.get(commandId)?.shortcut;
  const keyboardEvent = "key" in event ? asLegacyKeyboardShortcutEvent(event) : null;
  return keyboardEvent !== null && spec !== undefined && matchesShortcut(spec, keyboardEvent, platform);
}

export function isEditableAssetActionKeyboardTarget(
  target: EventTarget | null,
): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}
