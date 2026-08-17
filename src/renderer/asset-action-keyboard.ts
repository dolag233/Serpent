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

const assetKeyboardCommandRegistry = createCommandRegistry(
  assetCommandDefinitions,
);

export type AssetActionKeyboardCommand =
  | "asset.open-external"
  | "asset.move-to-trash"
  | "asset.rename"
  | "asset.copy"
  | "asset.copy-file-path"
  | "asset.paste"
  | "asset.reveal-in-folder"
  | "asset.delete-from-disk";

export function matchAssetActionKeyboardCommand(
  commandId: AssetActionKeyboardCommand,
  event: ShortcutEvent,
  platform: CommandPlatform,
): boolean {
  const spec: ShortcutSpec | undefined =
    assetKeyboardCommandRegistry.get(commandId)?.shortcut;
  return (
    spec !== undefined && matchesShortcut(spec, event, platform)
  );
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
