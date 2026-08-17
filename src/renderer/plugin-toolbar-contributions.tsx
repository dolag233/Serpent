import { useEffect, useState, type ReactNode } from "react";

import type { SerpentPluginManagerApi } from "../shared/plugin-manager-api";
import type { PluginContributionContext } from "../plugins/plugin-context";
import {
  resolvePluginContributionConditions,
  runPluginMenuCommand,
} from "./plugin-menu-contributions";
import { sortPluginSurfaceContributions } from "./plugin-surface-ordering";

export type PluginToolbarDescriptor = {
  id: string;
  label: string;
  contributionId: string;
  commandId: string;
  pluginId: string;
  disabled: boolean;
  when?: string;
  enablement?: string;
  checked?: boolean;
};

export function buildPluginToolbarDescriptors(
  contributions: readonly {
    kind: 'toolbar';
    id: string;
    title: string;
    commandId: string;
    pluginId: string;
    pluginInstanceId?: string;
    when?: string;
    enablement?: string;
    checked?: string;
  }[],
  context?: PluginContributionContext,
): PluginToolbarDescriptor[] {
  return sortPluginSurfaceContributions(contributions)
    .flatMap((contribution) => {
      const conditions = resolvePluginContributionConditions(contribution, context);
      if (!conditions.visible) return [];
      return {
        id: contribution.id,
        label: contribution.title,
        contributionId: contribution.id,
        commandId: contribution.commandId,
        pluginId: contribution.pluginId,
        ...(contribution.when === undefined ? {} : { when: contribution.when }),
        ...(contribution.enablement === undefined ? {} : { enablement: contribution.enablement }),
        ...(conditions.checked === undefined ? {} : { checked: conditions.checked }),
        disabled: conditions.disabled,
      };
    });
}

export function usePluginToolbarContributions(
  pluginApi: SerpentPluginManagerApi | undefined,
  libraryId: string | undefined,
  enabled: boolean,
  refreshKey: string | null,
  context?: PluginContributionContext,
): PluginToolbarDescriptor[] {
  const [items, setItems] = useState<PluginToolbarDescriptor[]>([]);
  const shouldLoad = enabled && pluginApi !== undefined && libraryId !== undefined;

  useEffect(() => {
    if (!shouldLoad || pluginApi === undefined || libraryId === undefined) return;
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
      setItems(buildPluginToolbarDescriptors(toolbarContributions, context));
    }).catch((error: unknown) => {
      if (!cancelled) {
        setItems([]);
        console.warn("plugin-toolbar-contributions-unavailable", error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [context, libraryId, pluginApi, refreshKey, shouldLoad]);

  return shouldLoad ? items : [];
}

export async function runPluginToolbarCommand(
  pluginApi: SerpentPluginManagerApi,
  libraryId: string,
  item: PluginToolbarDescriptor,
  context: {
    assetIds?: string[];
  },
  contributionContext?: PluginContributionContext,
): Promise<void> {
  await runPluginMenuCommand(pluginApi, libraryId, item, { ...context, contributionContext });
}

export function PluginToolbarButtons({
  pluginApi,
  libraryId,
  selectedAssetIds,
  disabled = false,
  refreshKey,
  context,
}: {
  pluginApi: SerpentPluginManagerApi | undefined;
  libraryId: string | undefined;
  selectedAssetIds: readonly string[];
  disabled?: boolean;
  refreshKey: string | null;
  context?: PluginContributionContext;
}): ReactNode {
  const items = usePluginToolbarContributions(
    pluginApi,
    libraryId,
    pluginApi !== undefined && libraryId !== undefined && !disabled,
    refreshKey,
    context,
  );

  if (items.length === 0) return null;

  return (
    <>
      <span className="tool-separator" />
      {items.map((item) => (
        <button
          className="compact-action"
          disabled={disabled || item.disabled}
          aria-pressed={item.checked}
          key={item.id}
          onClick={() => {
            if (pluginApi === undefined || libraryId === undefined) return;
            void runPluginToolbarCommand(pluginApi, libraryId, item, {
              ...(selectedAssetIds.length === 0
                ? {}
                : { assetIds: [...selectedAssetIds] }),
            }, context);
          }}
          type="button"
        >
          {item.label}
        </button>
      ))}
    </>
  );
}
