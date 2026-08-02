import { useEffect, useMemo, useState, type ReactNode } from 'react';

import type {
  PluginManagerInspectorViewContribution,
  SerpentPluginManagerApi,
} from '../shared/plugin-manager-api';
import {
  buildPluginIframeViewDescriptors,
  PluginIframeViewHost,
  type PluginIframeViewDescriptor,
} from './plugin-iframe-view-host';
import { useT } from './i18n';

export type PluginInspectorViewDescriptor = PluginIframeViewDescriptor;

export function buildPluginInspectorViewDescriptors(
  contributions: readonly PluginManagerInspectorViewContribution[],
): PluginInspectorViewDescriptor[] {
  return buildPluginIframeViewDescriptors(contributions);
}

export function usePluginInspectorViews(
  pluginApi: SerpentPluginManagerApi | undefined,
  libraryId: string | undefined,
  enabled: boolean,
  refreshKey: string | null,
): PluginInspectorViewDescriptor[] {
  const [items, setItems] = useState<PluginInspectorViewDescriptor[]>([]);

  useEffect(() => {
    if (!enabled || pluginApi === undefined || libraryId === undefined) {
      setItems([]);
      return;
    }
    let cancelled = false;
    void pluginApi.listPluginContributions({
      libraryId,
      target: 'inspector.views',
    }).then((result) => {
      if (cancelled || !('contributions' in result)) return;
      const views = result.contributions.filter(
        (contribution): contribution is PluginManagerInspectorViewContribution =>
          contribution.kind === 'view' && contribution.target === 'inspector.views',
      );
      setItems(buildPluginInspectorViewDescriptors(views));
    }).catch(() => {
      if (!cancelled) setItems([]);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, libraryId, pluginApi, refreshKey]);

  return items;
}

export function PluginInspectorViews({
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
  const t = useT();
  const items = usePluginInspectorViews(pluginApi, libraryId, !disabled, refreshKey);
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
    <section
      aria-label={t('inspector.pluginViewsAriaLabel')}
      className="plugin-inspector-views"
    >
      <div className="plugin-inspector-view-tabs" role="tablist">
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
          className="plugin-inspector-view-frame"
          libraryId={libraryId}
          pluginApi={pluginApi}
          view={active}
        />
      )}
    </section>
  );
}
