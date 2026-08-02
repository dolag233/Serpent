import { useEffect, useMemo, useState, type ReactNode } from 'react';

import type {
  PluginManagerPackageSummary,
  SerpentPluginManagerApi,
} from '../shared/plugin-manager-api';
import { PluginHostSettingsFields } from './plugin-host-settings-fields';
import { usePluginSettingsPages } from './plugin-settings-pages';
import { PluginIframeViewHost } from './plugin-iframe-view-host';
import { useT } from './i18n';

export type PluginSettingsNavEntry = {
  readonly pluginId: string;
  readonly name: string;
};

export function collectPluginSettingsNavEntries(
  packages: readonly PluginManagerPackageSummary[],
  pagePluginIds: readonly string[],
  pageTitlesByPluginId: ReadonlyMap<string, string>,
): PluginSettingsNavEntry[] {
  const byId = new Map<string, string>();
  for (const item of packages) {
    if (item.status !== 'valid') continue;
    if (item.hasSettingsUi || pagePluginIds.includes(item.pluginId)) {
      byId.set(item.pluginId, item.name);
    }
  }
  for (const pluginId of pagePluginIds) {
    if (!byId.has(pluginId)) {
      byId.set(pluginId, pageTitlesByPluginId.get(pluginId) ?? pluginId);
    }
  }
  return [...byId.entries()]
    .map(([pluginId, name]) => ({ pluginId, name }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function usePluginSettingsNavEntries(
  pluginApi: SerpentPluginManagerApi | undefined,
  libraryId: string | undefined,
  refreshKey: string | null,
): PluginSettingsNavEntry[] {
  const [packages, setPackages] = useState<PluginManagerPackageSummary[]>([]);
  const pages = usePluginSettingsPages(pluginApi, libraryId, true, refreshKey);

  useEffect(() => {
    if (pluginApi === undefined) {
      setPackages([]);
      return;
    }
    let cancelled = false;
    void pluginApi.request({
      type: 'plugin-manager.list',
      ...(libraryId === undefined ? {} : { libraryId }),
    }).then((response) => {
      if (cancelled || !response.ok || !('packages' in response)) return;
      setPackages(response.packages);
    }).catch(() => {
      if (!cancelled) setPackages([]);
    });
    return () => {
      cancelled = true;
    };
  }, [pluginApi, libraryId, refreshKey]);

  return useMemo(() => {
    const pageTitles = new Map<string, string>();
    for (const page of pages) {
      if (!pageTitles.has(page.pluginId)) pageTitles.set(page.pluginId, page.title);
    }
    return collectPluginSettingsNavEntries(
      packages,
      pages.map((page) => page.pluginId),
      pageTitles,
    );
  }, [packages, pages]);
}

export function PluginSettingsDetailPage({
  pluginApi,
  libraryId,
  pluginId,
  pluginName,
  refreshKey,
}: {
  pluginApi: SerpentPluginManagerApi | undefined;
  libraryId: string | undefined;
  pluginId: string;
  pluginName: string;
  refreshKey: string | null;
}): ReactNode {
  const t = useT();
  const pages = usePluginSettingsPages(pluginApi, libraryId, true, refreshKey)
    .filter((page) => page.pluginId === pluginId);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const activePage = pages.find((page) => page.id === activePageId) ?? pages[0];
  const [scopes, setScopes] = useState<Array<'user' | 'library'>>([]);

  useEffect(() => {
    if (pluginApi === undefined) {
      setScopes([]);
      return;
    }
    let cancelled = false;
    void pluginApi.request({
      type: 'plugin-manager.list',
      ...(libraryId === undefined ? {} : { libraryId }),
    }).then((response) => {
      if (cancelled || !response.ok || !('packages' in response)) return;
      const found = new Set<'user' | 'library'>();
      for (const item of response.packages) {
        if (item.pluginId === pluginId && item.status === 'valid' && item.hasSettingsUi) {
          found.add(item.scope);
        }
      }
      setScopes([...found]);
    }).catch(() => {
      if (!cancelled) setScopes([]);
    });
    return () => {
      cancelled = true;
    };
  }, [pluginApi, libraryId, pluginId, refreshKey]);

  useEffect(() => {
    if (activePageId !== null && !pages.some((page) => page.id === activePageId)) {
      setActivePageId(null);
    }
  }, [activePageId, pages]);

  return (
    <div className="plugin-settings-detail-page">
      <p className="app-settings-hint">{pluginName}</p>
      {scopes.map((scope) => (
        <PluginHostSettingsFields
          api={pluginApi}
          key={`${pluginId}:${scope}`}
          libraryId={libraryId}
          pluginId={pluginId}
          scope={scope}
        />
      ))}
      {pages.length === 0 ? null : (
        <section className="app-settings-card plugin-settings-pages-card">
          <div className="app-settings-row-copy">
            <strong>{t('settings.pluginCustomPagesTitle')}</strong>
            <span>{t('settings.pluginCustomPagesHint')}</span>
          </div>
          {pages.length > 1 ? (
            <div className="plugin-settings-page-tabs" role="tablist">
              {pages.map((page) => (
                <button
                  aria-selected={page.id === activePage?.id}
                  className="compact-action"
                  key={page.id}
                  onClick={() => setActivePageId(page.id)}
                  role="tab"
                  type="button"
                >
                  {page.title}
                </button>
              ))}
            </div>
          ) : null}
          {activePage === undefined ? null : (
            <PluginIframeViewHost
              className="plugin-settings-page-frame"
              libraryId={libraryId}
              pluginApi={pluginApi}
              view={activePage}
            />
          )}
        </section>
      )}
      {scopes.length === 0 && pages.length === 0 ? (
        <p className="app-settings-hint">{t('settings.pluginSettingsEmpty')}</p>
      ) : null}
    </div>
  );
}
