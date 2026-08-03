import { useEffect, useState } from "react";

import { parseElectronAccelerator } from "../shared/plugin-accelerator";
import type { SerpentPluginManagerApi } from "../shared/plugin-manager-api";
import {
  matchesShortcut,
  type CommandPlatform,
  type ShortcutEvent,
} from "./commands/command-types";
import { isEditableAssetActionKeyboardTarget } from "./asset-action-keyboard";
import { runPluginMenuCommand } from "./plugin-menu-contributions";

export type PluginShortcutDescriptor = {
  id: string;
  label: string;
  contributionId: string;
  commandId: string;
  pluginId: string;
  accelerator: string;
};

export function buildPluginShortcutDescriptors(
  contributions: readonly {
    kind: 'shortcut';
    id: string;
    title: string;
    commandId: string;
    pluginId: string;
    accelerator: string;
  }[],
): PluginShortcutDescriptor[] {
  return contributions
    .map((contribution) => ({
      id: contribution.id,
      label: contribution.title,
      contributionId: contribution.id,
      commandId: contribution.commandId,
      pluginId: contribution.pluginId,
      accelerator: contribution.accelerator,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function usePluginShortcutContributions(
  pluginApi: SerpentPluginManagerApi | undefined,
  libraryId: string | undefined,
  enabled: boolean,
  refreshKey: string | null,
): PluginShortcutDescriptor[] {
  const [items, setItems] = useState<PluginShortcutDescriptor[]>([]);
  const shouldLoad = enabled && pluginApi !== undefined && libraryId !== undefined;

  useEffect(() => {
    if (!shouldLoad || pluginApi === undefined || libraryId === undefined) return;
    let cancelled = false;
    void pluginApi.listPluginContributions({
      libraryId,
      target: 'shortcuts',
    }).then((result) => {
      if (cancelled) return;
      if (!("contributions" in result)) {
        setItems([]);
        return;
      }
      const shortcutContributions = result.contributions.filter(
        (contribution): contribution is Extract<typeof contribution, { kind: 'shortcut' }> => contribution.kind === 'shortcut',
      );
      setItems(buildPluginShortcutDescriptors(shortcutContributions));
    }).catch((error: unknown) => {
      if (!cancelled) {
        setItems([]);
        console.warn("plugin-shortcut-contributions-unavailable", error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [libraryId, pluginApi, refreshKey, shouldLoad]);

  return shouldLoad ? items : [];
}

export function matchPluginShortcut(
  shortcuts: readonly PluginShortcutDescriptor[],
  event: ShortcutEvent,
  platform: CommandPlatform,
): PluginShortcutDescriptor | null {
  for (const shortcut of shortcuts) {
    const chord = parseElectronAccelerator(shortcut.accelerator, platform);
    if (chord !== null && matchesShortcut({ mac: chord, windows: chord }, event, platform)) {
      return shortcut;
    }
  }
  return null;
}

export async function runPluginShortcutCommand(
  pluginApi: SerpentPluginManagerApi,
  libraryId: string,
  item: PluginShortcutDescriptor,
  context: {
    assetIds?: string[];
  },
): Promise<void> {
  await runPluginMenuCommand(pluginApi, libraryId, item, context);
}

export function usePluginShortcutKeyboard(args: {
  readonly enabled: boolean;
  readonly platform: CommandPlatform;
  readonly pluginApi: SerpentPluginManagerApi | undefined;
  readonly libraryId: string | undefined;
  readonly refreshKey: string | null;
  readonly previewOpen: boolean;
  readonly selectedAssetIds: readonly string[];
}): void {
  const {
    enabled,
    platform,
    pluginApi,
    libraryId,
    refreshKey,
    previewOpen,
    selectedAssetIds,
  } = args;
  const shortcuts = usePluginShortcutContributions(
    pluginApi,
    libraryId,
    enabled && pluginApi !== undefined && libraryId !== undefined,
    refreshKey,
  );

  useEffect(() => {
    if (!enabled || pluginApi === undefined || libraryId === undefined || shortcuts.length === 0) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableAssetActionKeyboardTarget(event.target)) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (previewOpen) return;

      const matched = matchPluginShortcut(shortcuts, event, platform);
      if (matched === null) return;

      event.preventDefault();
      void runPluginShortcutCommand(pluginApi, libraryId, matched, {
        ...(selectedAssetIds.length === 0
          ? {}
          : { assetIds: [...selectedAssetIds] }),
      });
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [
    enabled,
    libraryId,
    platform,
    pluginApi,
    previewOpen,
    selectedAssetIds,
    shortcuts,
  ]);
}
