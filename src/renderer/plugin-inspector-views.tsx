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

export type PluginInspectorViewDescriptor = PluginIframeViewDescriptor & {
  receivesInspectorSelection?: true;
};

const EMPTY_VIEWS: PluginInspectorViewDescriptor[] = [];

export function buildPluginInspectorSelectionState(
  assetIds: readonly string[],
  primaryAssetId: string,
) {
  const limit = 64;
  const validId = (id: string) => /^[a-zA-Z0-9_-]{1,128}$/.test(id);
  const selectedAssetIds = assetIds.slice(0, limit).filter(validId);
  const primary = validId(primaryAssetId) ? primaryAssetId : null;
  if (primary !== null && !selectedAssetIds.includes(primary)) {
    selectedAssetIds.splice(limit - 1, 1);
    selectedAssetIds.push(primary);
  }
  return { selectedAssetIds, primaryAssetId: primary };
}

export function buildPluginInspectorViewDescriptors(
  contributions: readonly PluginManagerInspectorViewContribution[],
): PluginInspectorViewDescriptor[] {
  return buildPluginIframeViewDescriptors(contributions, 'inspector', 'library');
}

export function usePluginInspectorViews(
  pluginApi: SerpentPluginManagerApi | undefined,
  libraryId: string | undefined,
  enabled: boolean,
  refreshKey: string | null,
): PluginInspectorViewDescriptor[] {
  const [loaded, setLoaded] = useState<{
    libraryId: string;
    pluginApi: SerpentPluginManagerApi;
    items: PluginInspectorViewDescriptor[];
  }>();
  const shouldLoad = enabled && pluginApi !== undefined && libraryId !== undefined;

  useEffect(() => {
    if (!shouldLoad || pluginApi === undefined || libraryId === undefined) return;
    let cancelled = false;
    void pluginApi.listPluginContributions({
      libraryId,
      target: 'inspector.views',
    }).then((result) => {
      if (cancelled) return;
      const views = 'contributions' in result ? result.contributions.filter(
        (contribution): contribution is PluginManagerInspectorViewContribution =>
          contribution.kind === 'view' && contribution.target === 'inspector.views',
      ) : [];
      setLoaded({ libraryId, pluginApi, items: buildPluginInspectorViewDescriptors(views) });
    }).catch(() => {
      if (!cancelled) setLoaded(undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [libraryId, pluginApi, refreshKey, shouldLoad]);

  return shouldLoad && loaded !== undefined &&
    loaded.libraryId === libraryId && loaded.pluginApi === pluginApi
    ? loaded.items
    : EMPTY_VIEWS;
}

export function PluginInspectorViews({
  pluginApi,
  libraryId,
  disabled = false,
  primaryAssetId,
  refreshKey,
  selectedAssetIds,
}: {
  pluginApi: SerpentPluginManagerApi | undefined;
  libraryId: string | undefined;
  disabled?: boolean;
  primaryAssetId: string;
  refreshKey: string | null;
  selectedAssetIds: readonly string[];
}): ReactNode {
  const t = useT();
  const items = usePluginInspectorViews(pluginApi, libraryId, !disabled, refreshKey);
  const state = useMemo(
    () => buildPluginInspectorSelectionState(selectedAssetIds, primaryAssetId),
    [primaryAssetId, selectedAssetIds],
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = useMemo(() => {
    const selectedId = items.some((item) => item.id === activeId) ? activeId : null;
    return items.find((item) => item.id === selectedId) ?? items[0];
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
          state={active.receivesInspectorSelection === true ? state : undefined}
          view={active}
        />
      )}
    </section>
  );
}
