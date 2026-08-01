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

  useEffect(() => {
    if (!enabled || pluginApi === undefined || libraryId === undefined) {
      setItems([]);
      return;
    }
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
  }, [enabled, libraryId, pluginApi, refreshKey]);

  return items;
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
  const active = useMemo(
    () => items.find((item) => item.id === activeId) ?? items[0],
    [activeId, items],
  );

  useEffect(() => {
    if (activeId !== null && !items.some((item) => item.id === activeId)) {
      setActiveId(null);
    }
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
