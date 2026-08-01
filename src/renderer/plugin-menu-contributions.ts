import { useEffect, useState } from "react";

import type {
  PluginHostMenuTarget,
  SerpentPluginManagerApi,
} from "../shared/plugin-manager-api";

export type PluginMenuDescriptor = {
  id: string;
  label: string;
  contributionId: string;
  commandId: string;
  pluginId: string;
};

export function buildPluginMenuDescriptors(
  contributions: readonly {
    kind: 'menu';
    id: string;
    title: string;
    commandId: string;
    pluginId: string;
  }[],
): PluginMenuDescriptor[] {
  return contributions
    .map((contribution) => ({
      id: contribution.id,
      label: contribution.title,
      contributionId: contribution.id,
      commandId: contribution.commandId,
      pluginId: contribution.pluginId,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

/** @deprecated Use {@link buildPluginMenuDescriptors} */
export const buildPluginAssetMenuDescriptors = buildPluginMenuDescriptors;

export function usePluginMenuContributions(
  pluginApi: SerpentPluginManagerApi | undefined,
  libraryId: string | undefined,
  target: PluginHostMenuTarget,
  enabled: boolean,
  refreshKey: string | null,
): PluginMenuDescriptor[] {
  const [items, setItems] = useState<PluginMenuDescriptor[]>([]);

  useEffect(() => {
    if (!enabled || pluginApi === undefined || libraryId === undefined) {
      setItems([]);
      return;
    }
    let cancelled = false;
    void pluginApi.listPluginContributions({
      libraryId,
      target,
    }).then((result) => {
      if (cancelled) return;
      if (!("contributions" in result)) {
        setItems([]);
        return;
      }
      const menuContributions = result.contributions.filter(
        (contribution): contribution is Extract<typeof contribution, { kind: 'menu' }> => contribution.kind === 'menu',
      );
      setItems(buildPluginMenuDescriptors(menuContributions));
    }).catch((error: unknown) => {
      if (!cancelled) {
        setItems([]);
        console.warn("plugin-menu-contributions-unavailable", target, error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, libraryId, pluginApi, refreshKey, target]);

  return items;
}

export async function runPluginMenuCommand(
  pluginApi: SerpentPluginManagerApi,
  libraryId: string,
  item: Pick<PluginMenuDescriptor, 'contributionId' | 'id'>,
  context: {
    assetIds?: string[];
    folderIds?: string[];
    collectionIds?: string[];
  },
): Promise<void> {
  const result = await pluginApi.runPluginCommand({
    type: "plugin-manager.run-command",
    libraryId,
    contributionId: item.contributionId,
    ...(context.assetIds === undefined ? {} : { assetIds: context.assetIds }),
    ...(context.folderIds === undefined ? {} : { folderIds: context.folderIds }),
    ...(context.collectionIds === undefined ? {} : { collectionIds: context.collectionIds }),
  });
  if (!result.ok) {
    console.warn("plugin-command-failed", item.id, result.code);
  }
}
