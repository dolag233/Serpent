import { useEffect, useState, type ReactNode } from "react";

import type { SerpentPluginManagerApi } from "../shared/plugin-manager-api";
import { runPluginMenuCommand } from "./plugin-menu-contributions";

export type PluginToolbarDescriptor = {
  id: string;
  label: string;
  contributionId: string;
  commandId: string;
  pluginId: string;
};

export function buildPluginToolbarDescriptors(
  contributions: readonly {
    kind: 'toolbar';
    id: string;
    title: string;
    commandId: string;
    pluginId: string;
  }[],
): PluginToolbarDescriptor[] {
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

export function usePluginToolbarContributions(
  pluginApi: SerpentPluginManagerApi | undefined,
  libraryId: string | undefined,
  enabled: boolean,
  refreshKey: string | null,
): PluginToolbarDescriptor[] {
  const [items, setItems] = useState<PluginToolbarDescriptor[]>([]);

  useEffect(() => {
    if (!enabled || pluginApi === undefined || libraryId === undefined) {
      setItems([]);
      return;
    }
    let cancelled = false;
    void pluginApi.listPluginContributions({
      libraryId,
      target: 'toolbar',
    }).then((result) => {
      if (cancelled) return;
      if (!("contributions" in result)) {
        setItems([]);
        return;
      }
      const toolbarContributions = result.contributions.filter(
        (contribution): contribution is Extract<typeof contribution, { kind: 'toolbar' }> => contribution.kind === 'toolbar',
      );
      setItems(buildPluginToolbarDescriptors(toolbarContributions));
    }).catch((error: unknown) => {
      if (!cancelled) {
        setItems([]);
        console.warn("plugin-toolbar-contributions-unavailable", error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, libraryId, pluginApi, refreshKey]);

  return items;
}

export async function runPluginToolbarCommand(
  pluginApi: SerpentPluginManagerApi,
  libraryId: string,
  item: PluginToolbarDescriptor,
  context: {
    assetIds?: string[];
  },
): Promise<void> {
  await runPluginMenuCommand(pluginApi, libraryId, item, context);
}

export function PluginToolbarButtons({
  pluginApi,
  libraryId,
  selectedAssetIds,
  disabled = false,
  refreshKey,
}: {
  pluginApi: SerpentPluginManagerApi | undefined;
  libraryId: string | undefined;
  selectedAssetIds: readonly string[];
  disabled?: boolean;
  refreshKey: string | null;
}): ReactNode {
  const items = usePluginToolbarContributions(
    pluginApi,
    libraryId,
    pluginApi !== undefined && libraryId !== undefined && !disabled,
    refreshKey,
  );

  if (items.length === 0) return null;

  return (
    <>
      <span className="tool-separator" />
      {items.map((item) => (
        <button
          className="compact-action"
          disabled={disabled}
          key={item.id}
          onClick={() => {
            if (pluginApi === undefined || libraryId === undefined) return;
            void runPluginToolbarCommand(pluginApi, libraryId, item, {
              ...(selectedAssetIds.length === 0
                ? {}
                : { assetIds: [...selectedAssetIds] }),
            });
          }}
          type="button"
        >
          {item.label}
        </button>
      ))}
    </>
  );
}
