import { useEffect, useMemo, useState, type ReactNode } from 'react';

import type {
  PluginManagerWorkspaceViewContribution,
  SerpentPluginManagerApi,
} from '../shared/plugin-manager-api';
import {
  buildPluginIframeViewDescriptors,
  PluginIframeViewHost,
  type PluginIframeViewDescriptor,
} from './plugin-iframe-view-host';

export type PluginWorkspaceViewDescriptor = PluginIframeViewDescriptor;

export function buildPluginWorkspaceViewDescriptors(
  contributions: readonly PluginManagerWorkspaceViewContribution[],
): PluginWorkspaceViewDescriptor[] {
  return buildPluginIframeViewDescriptors(contributions);
}

export function usePluginWorkspaceViews(
  pluginApi: SerpentPluginManagerApi | undefined,
  libraryId: string | undefined,
  enabled: boolean,
  refreshKey: string | null,
): PluginWorkspaceViewDescriptor[] {
  const [items, setItems] = useState<PluginWorkspaceViewDescriptor[]>([]);
  const shouldLoad = enabled && pluginApi !== undefined && libraryId !== undefined;

  useEffect(() => {
    if (!shouldLoad || pluginApi === undefined || libraryId === undefined) return;
    let cancelled = false;
    void pluginApi.listPluginContributions({
      libraryId,
      target: 'workspace.views',
    }).then((result) => {
      if (cancelled || !('contributions' in result)) return;
      const views = result.contributions.filter(
        (contribution): contribution is PluginManagerWorkspaceViewContribution =>
          contribution.kind === 'view' && contribution.target === 'workspace.views',
      );
      setItems(buildPluginWorkspaceViewDescriptors(views));
    }).catch(() => {
      if (!cancelled) setItems([]);
    });
    return () => {
      cancelled = true;
    };
  }, [libraryId, pluginApi, refreshKey, shouldLoad]);

  return shouldLoad ? items : [];
}

export function PluginWorkspaceViews({
  pluginApi,
  libraryId,
  disabled = false,
  refreshKey,
}: {
  pluginApi: SerpentPluginManagerApi | undefined;
  libraryId: string | undefined;
  disabled?: boolean;
  refreshKey: string | null;
}): ReactNode {
  const items = usePluginWorkspaceViews(pluginApi, libraryId, !disabled, refreshKey);
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = useMemo(() => {
    const selectedId = items.some((item) => item.id === activeId) ? activeId : null;
    return items.find((item) => item.id === selectedId) ?? items[0];
  }, [activeId, items]);

  if (items.length === 0) return null;

  return (
    <section className="plugin-workspace-views" aria-label="Plugin workspace views">
      <div className="plugin-workspace-view-tabs" role="tablist">
        {items.map((item) => (
          <button
            aria-selected={item.id === active?.id}
            className="compact-action"
            key={item.id}
            onClick={() => setActiveId(item.id)}
            role="tab"
            type="button"
          >
            {item.title}
          </button>
        ))}
      </div>
      {active === undefined ? null : (
        <PluginIframeViewHost
          className="plugin-workspace-view-frame"
          libraryId={libraryId}
          pluginApi={pluginApi}
          view={active}
        />
      )}
    </section>
  );
}
