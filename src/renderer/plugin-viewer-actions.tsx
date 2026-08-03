import { useEffect, useState, type ReactNode } from "react";

import type { PluginContributionContext } from "../plugins/plugin-context";
import type { SerpentPluginManagerApi } from "../shared/plugin-manager-api";
import {
  resolvePluginContributionConditions,
  runPluginMenuCommand,
} from "./plugin-menu-contributions";
import { sortPluginSurfaceContributions } from "./plugin-surface-ordering";
import { VIEWER_CHROME_TAB_INDEX } from "./viewer-focus-policy";

export type PluginViewerActionDescriptor = {
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

export function buildPluginViewerActionDescriptors(
  contributions: readonly {
    kind: 'viewer-action';
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
): PluginViewerActionDescriptor[] {
  return sortPluginSurfaceContributions(contributions)
    .flatMap((contribution) => {
      const conditions = resolvePluginContributionConditions(contribution, context);
      if (!conditions.visible) return [];
      return [{
        id: contribution.id,
        label: contribution.title,
        contributionId: contribution.id,
        commandId: contribution.commandId,
        pluginId: contribution.pluginId,
        ...(contribution.when === undefined ? {} : { when: contribution.when }),
        ...(contribution.enablement === undefined ? {} : { enablement: contribution.enablement }),
        ...(conditions.checked === undefined ? {} : { checked: conditions.checked }),
        disabled: conditions.disabled,
      }];
    });
}

export function usePluginViewerActionContributions(
  pluginApi: SerpentPluginManagerApi | undefined,
  libraryId: string | undefined,
  enabled: boolean,
  refreshKey: string | null,
  context?: PluginContributionContext,
): PluginViewerActionDescriptor[] {
  const [items, setItems] = useState<PluginViewerActionDescriptor[]>([]);
  const shouldLoad = enabled && pluginApi !== undefined && libraryId !== undefined;

  useEffect(() => {
    if (!shouldLoad || pluginApi === undefined || libraryId === undefined) return;
    let cancelled = false;
    void pluginApi.listPluginContributions({
      libraryId,
      target: 'viewer.actions',
    }).then((result) => {
      if (cancelled) return;
      if (!("contributions" in result)) {
        setItems([]);
        return;
      }
      const actionContributions = result.contributions.filter(
        (contribution): contribution is Extract<typeof contribution, { kind: 'viewer-action' }> => contribution.kind === 'viewer-action',
      );
      setItems(buildPluginViewerActionDescriptors(actionContributions, context));
    }).catch((error: unknown) => {
      if (!cancelled) {
        setItems([]);
        console.warn("plugin-viewer-actions-unavailable", error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [context, libraryId, pluginApi, refreshKey, shouldLoad]);

  return shouldLoad ? items : [];
}

export function PluginViewerActionButtons({
  pluginApi,
  libraryId,
  assetId,
  disabled = false,
  refreshKey,
  context,
}: {
  pluginApi: SerpentPluginManagerApi | undefined;
  libraryId: string | undefined;
  assetId: string;
  disabled?: boolean;
  refreshKey: string | null;
  context?: PluginContributionContext;
}): ReactNode {
  const items = usePluginViewerActionContributions(
    pluginApi,
    libraryId,
    pluginApi !== undefined && libraryId !== undefined && !disabled,
    refreshKey,
    context,
  );

  if (items.length === 0) return null;

  return (
    <div
      aria-label="Plugin actions"
      className="preview-plugin-actions preview-chrome-fade"
    >
      {items.map((item) => (
        <button
          aria-pressed={item.checked}
          disabled={disabled || item.disabled}
          key={item.id}
          onClick={() => {
            if (pluginApi === undefined || libraryId === undefined) return;
            void runPluginMenuCommand(pluginApi, libraryId, item, {
              assetIds: [assetId],
              contributionContext: context,
            });
          }}
          tabIndex={VIEWER_CHROME_TAB_INDEX}
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
