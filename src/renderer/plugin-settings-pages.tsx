import { useEffect, useMemo, useState, type ReactNode } from 'react';

import type {
  PluginManagerSettingsPageContribution,
  SerpentPluginManagerApi,
} from '../shared/plugin-manager-api';
import {
  buildPluginIframeViewDescriptors,
  PluginIframeViewHost,
  type PluginIframeViewDescriptor,
} from './plugin-iframe-view-host';
import { useT } from './i18n';

export type PluginSettingsPageDescriptor = PluginIframeViewDescriptor;

export function buildPluginSettingsPageDescriptors(
  contributions: readonly PluginManagerSettingsPageContribution[],
): PluginSettingsPageDescriptor[] {
  return buildPluginIframeViewDescriptors(contributions);
}

export function usePluginSettingsPages(
  pluginApi: SerpentPluginManagerApi | undefined,
  libraryId: string | undefined,
  enabled: boolean,
  refreshKey: string | null,
): PluginSettingsPageDescriptor[] {
  const [items, setItems] = useState<PluginSettingsPageDescriptor[]>([]);

  useEffect(() => {
    if (!enabled || pluginApi === undefined || libraryId === undefined) {
      setItems([]);
      return;
    }
    let cancelled = false;
    void pluginApi.listPluginContributions({
      libraryId,
      target: 'settings.pages',
    }).then((result) => {
      if (cancelled || !('contributions' in result)) return;
      const views = result.contributions.filter(
        (contribution): contribution is PluginManagerSettingsPageContribution =>
          contribution.kind === 'view' && contribution.target === 'settings.pages',
      );
      setItems(buildPluginSettingsPageDescriptors(views));
    }).catch(() => {
      if (!cancelled) setItems([]);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, libraryId, pluginApi, refreshKey]);

  return items;
}

export function PluginSettingsPages({
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
  const items = usePluginSettingsPages(pluginApi, libraryId, !disabled, refreshKey);
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
    <section className="app-settings-card plugin-settings-pages-card">
      <div className="app-settings-row-copy">
        <strong>{t('settings.pluginCustomPagesTitle')}</strong>
        <span>{t('settings.pluginCustomPagesHint')}</span>
      </div>
      <div
        aria-label={t('settings.pluginCustomPagesTitle')}
        className="plugin-settings-pages"
        role="region"
      >
        <div className="plugin-settings-page-tabs" role="tablist">
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
            className="plugin-settings-page-frame"
            libraryId={libraryId}
            pluginApi={pluginApi}
            view={active}
          />
        )}
      </div>
    </section>
  );
}
