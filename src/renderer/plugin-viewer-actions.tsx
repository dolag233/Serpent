import { useEffect, useState, type ReactNode } from "react";

import type { SerpentPluginManagerApi } from "../shared/plugin-manager-api";
import { runPluginMenuCommand } from "./plugin-menu-contributions";
import { VIEWER_CHROME_TAB_INDEX } from "./viewer-focus-policy";

export type PluginViewerActionDescriptor = {
  id: string;
  label: string;
  contributionId: string;
  commandId: string;
  pluginId: string;
};

export function buildPluginViewerActionDescriptors(
  contributions: readonly {
    kind: 'viewer-action';
    id: string;
    title: string;
    commandId: string;
    pluginId: string;
  }[],
): PluginViewerActionDescriptor[] {
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

export function usePluginViewerActionContributions(
  pluginApi: SerpentPluginManagerApi | undefined,
  libraryId: string | undefined,
  enabled: boolean,
  refreshKey: string | null,
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
      setItems(buildPluginViewerActionDescriptors(actionContributions));
    }).catch((error: unknown) => {
      if (!cancelled) {
        setItems([]);
        console.warn("plugin-viewer-actions-unavailable", error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [libraryId, pluginApi, refreshKey, shouldLoad]);

  return shouldLoad ? items : [];
}

export function PluginViewerActionButtons({
  pluginApi,
  libraryId,
  assetId,
  disabled = false,
  refreshKey,
}: {
  pluginApi: SerpentPluginManagerApi | undefined;
  libraryId: string | undefined;
  assetId: string;
  disabled?: boolean;
  refreshKey: string | null;
}): ReactNode {
  const items = usePluginViewerActionContributions(
    pluginApi,
    libraryId,
    pluginApi !== undefined && libraryId !== undefined && !disabled,
    refreshKey,
  );

  if (items.length === 0) return null;

  return (
    <div
      aria-label="Plugin actions"
      className="preview-plugin-actions preview-chrome-fade"
    >
      {items.map((item) => (
        <button
          disabled={disabled}
          key={item.id}
          onClick={() => {
            if (pluginApi === undefined || libraryId === undefined) return;
            void runPluginMenuCommand(pluginApi, libraryId, item, {
              assetIds: [assetId],
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
