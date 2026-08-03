import { useEffect, useState, type ReactNode } from 'react';

import type {
  PluginManagerSidebarViewContribution,
  SerpentPluginManagerApi,
} from '../shared/plugin-manager-api';
import {
  buildPluginIframeViewDescriptors,
  PluginIframeViewHost,
  type PluginIframeViewDescriptor,
} from './plugin-iframe-view-host';

export type PluginSidebarViewDescriptor = PluginIframeViewDescriptor;

export function buildPluginSidebarViewDescriptors(
  contributions: readonly PluginManagerSidebarViewContribution[],
): PluginSidebarViewDescriptor[] {
  return buildPluginIframeViewDescriptors(contributions);
}

export function usePluginSidebarViews(
  pluginApi: SerpentPluginManagerApi | undefined,
  libraryId: string | undefined,
  enabled: boolean,
  refreshKey: string | null,
): PluginSidebarViewDescriptor[] {
  const [items, setItems] = useState<PluginSidebarViewDescriptor[]>([]);
  const shouldLoad = enabled && pluginApi !== undefined && libraryId !== undefined;

  useEffect(() => {
    if (!shouldLoad || pluginApi === undefined || libraryId === undefined) return;
    let cancelled = false;
    void pluginApi.listPluginContributions({
      libraryId,
      target: 'sidebar.entries',
    }).then((result) => {
      if (cancelled || !('contributions' in result)) return;
      const views = result.contributions.filter(
        (contribution): contribution is PluginManagerSidebarViewContribution =>
          contribution.kind === 'view' && contribution.target === 'sidebar.entries',
      );
      setItems(buildPluginSidebarViewDescriptors(views));
    }).catch(() => {
      if (!cancelled) setItems([]);
    });
    return () => {
      cancelled = true;
    };
  }, [libraryId, pluginApi, refreshKey, shouldLoad]);

  return shouldLoad ? items : [];
}

export function PluginSidebarViewPanel({
  activeView,
  pluginApi,
  libraryId,
}: {
  activeView: PluginSidebarViewDescriptor | undefined;
  pluginApi: SerpentPluginManagerApi | undefined;
  libraryId: string | undefined;
}): ReactNode {
  if (activeView === undefined) return null;
  return (
    <section className="plugin-sidebar-view-panel" aria-label={activeView.title}>
      <PluginIframeViewHost
        className="plugin-sidebar-view-frame"
        libraryId={libraryId}
        pluginApi={pluginApi}
        view={activeView}
      />
    </section>
  );
}
