import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import type {
  PluginCommunityCatalogSnapshot,
  PluginCommunityPluginSummary,
  PluginManagerPackageSummary,
  SerpentPluginManagerApi,
} from '../shared/plugin-manager-api';
import type { PluginInstallProgress } from '../shared/plugin-install-progress';
import { pickLocalizedText, resolvePluginDisplayCopy } from '../plugins/plugin-localized-copy';
import { Icon } from './Icons';
import { iconActionAttrs } from './icon-action-attrs';
import { useLocale, useT } from './i18n';
import { PluginCommunityDetailPage } from './PluginCommunityDetailPage';
import { DialogShell } from './ui/patterns';

type PluginCommunityPageProps = {
  readonly api: SerpentPluginManagerApi | undefined;
  readonly libraryId: string | undefined;
  readonly refreshKey: string | null;
  readonly detailPluginId?: string;
  readonly onDetailPluginIdChange?: (pluginId: string | undefined) => void;
  readonly onDetailTitleChange?: (title: string | undefined) => void;
  readonly onInstalled: () => void;
};

type InstallScope = 'user' | 'library';

type PluginSnapshot = Extract<
  Awaited<ReturnType<SerpentPluginManagerApi['request']>>,
  { ok: true; packages: unknown }
>;

function formatPluginManagerFailure(
  response: Extract<Awaited<ReturnType<SerpentPluginManagerApi['request']>>, { ok: false }>,
  t: ReturnType<typeof useT>,
): string {
  if (response.message !== undefined && response.message.trim() !== '') {
    return t('settings.pluginOperationFailedDetail', {
      code: response.failureCode ?? response.code,
      message: response.message,
    });
  }
  return t('settings.pluginOperationFailed', { code: response.failureCode ?? response.code });
}

export function PluginCommunityPage({
  api,
  libraryId,
  refreshKey,
  detailPluginId,
  onDetailPluginIdChange,
  onDetailTitleChange,
  onInstalled,
}: PluginCommunityPageProps): ReactNode {
  const t = useT();
  const { locale } = useLocale();
  const [catalog, setCatalog] = useState<PluginCommunityCatalogSnapshot | undefined>();
  const [packages, setPackages] = useState<readonly PluginManagerPackageSummary[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [installTarget, setInstallTarget] = useState<PluginCommunityPluginSummary | undefined>();
  const [installScope, setInstallScope] = useState<InstallScope>(libraryId === undefined ? 'user' : 'library');
  const [operationId, setOperationId] = useState<string | undefined>();
  const [progress, setProgress] = useState<PluginInstallProgress | undefined>();
  const [installError, setInstallError] = useState<string | undefined>();

  const load = useCallback(async () => {
    if (api === undefined) {
      setError(t('settings.pluginUnavailable'));
      return;
    }
    try {
      const [catalogResponse, listResponse] = await Promise.all([
        api.request({ type: 'plugin-manager.community-catalog', refresh: true }),
        api.request({
          type: 'plugin-manager.list',
          ...(libraryId === undefined ? {} : { libraryId }),
        }),
      ]);
      if (!catalogResponse.ok) {
        setError(formatPluginManagerFailure(catalogResponse, t));
        return;
      }
      if (!('catalog' in catalogResponse)) {
        setError(t('settings.pluginOperationFailed', { code: 'unexpected-response' }));
        return;
      }
      setCatalog(catalogResponse.catalog);
      if (listResponse.ok && 'packages' in listResponse) {
        setPackages((listResponse as PluginSnapshot).packages);
      }
      setError(undefined);
    } catch {
      setError(t('settings.pluginOperationFailed', { code: 'bridge-unavailable' }));
    }
  }, [api, libraryId, t]);

  useEffect(() => {
    const timer = globalThis.setTimeout(() => void load(), 0);
    return () => globalThis.clearTimeout(timer);
  }, [load, refreshKey]);

  useEffect(() => {
    if (api?.onInstallProgress === undefined) return undefined;
    return api.onInstallProgress((event) => {
      if (operationId !== undefined && event.operationId === operationId) {
        setProgress(event);
      }
    });
  }, [api, operationId]);

  const installedById = useMemo(() => {
    const map = new Map<string, PluginManagerPackageSummary>();
    for (const item of packages) {
      const current = map.get(item.pluginId);
      if (current === undefined || item.version.localeCompare(current.version) > 0) {
        map.set(item.pluginId, item);
      }
    }
    return map;
  }, [packages]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (catalog?.plugins ?? []).filter((plugin) => {
      if (needle === '') return true;
      const copy = resolvePluginDisplayCopy({
        locale,
        fallbackName: plugin.name.en,
        fallbackDescription: plugin.description.en,
        catalog: plugin,
      });
      return copy.name.toLowerCase().includes(needle)
        || copy.description.toLowerCase().includes(needle)
        || plugin.pluginId.toLowerCase().includes(needle);
    });
  }, [catalog?.plugins, locale, query]);

  const canUseLibraryScope = libraryId !== undefined;
  const progressActive = progress !== undefined
    && (progress.state === 'running' || progress.state === 'paused');
  const installTargetUpdating = installTarget !== undefined
    && installedById.get(installTarget.pluginId) !== undefined
    && installedById.get(installTarget.pluginId)?.version !== installTarget.version;
  const detailPlugin = catalog?.plugins.find((plugin) => plugin.pluginId === detailPluginId);

  useEffect(() => {
    if (detailPluginId === undefined) {
      onDetailTitleChange?.(undefined);
      return;
    }
    if (detailPlugin !== undefined) {
      onDetailTitleChange?.(pickLocalizedText(locale, detailPlugin.name));
      return;
    }
    if (catalog !== undefined) onDetailPluginIdChange?.(undefined);
  }, [
    catalog,
    detailPlugin,
    detailPluginId,
    locale,
    onDetailPluginIdChange,
    onDetailTitleChange,
  ]);

  const closeInstall = useCallback(() => {
    if (api !== undefined && operationId !== undefined && progressActive) {
      void api.request({ type: 'plugin-manager.install-control', operationId, action: 'stop' });
    }
    setInstallTarget(undefined);
    setInstallError(undefined);
    setOperationId(undefined);
    setProgress(undefined);
  }, [api, operationId, progressActive]);

  const startInstall = useCallback(async () => {
    if (api === undefined || installTarget === undefined) return;
    if (installScope === 'library' && libraryId === undefined) {
      setInstallError(t('settings.pluginLibraryClosedHint'));
      return;
    }
    const nextOperationId = globalThis.crypto.randomUUID();
    setOperationId(nextOperationId);
    setProgress({
      operationId: nextOperationId,
      phase: 'resolving',
      state: 'running',
      bytesDownloaded: 0,
    });
    setInstallError(undefined);
    setBusy(true);
    try {
      const response = await api.request({
        type: 'plugin-manager.install-community',
        pluginId: installTarget.pluginId,
        scope: installScope,
        ...(installScope === 'library' && libraryId !== undefined ? { libraryId } : {}),
        operationId: nextOperationId,
      });
      if (!response.ok) {
        if (response.code !== 'selection-cancelled') {
          setInstallError(formatPluginManagerFailure(response, t));
        }
        return;
      }
      closeInstall();
      onInstalled();
    } catch {
      setInstallError(t('settings.pluginOperationFailed', { code: 'bridge-unavailable' }));
    } finally {
      setBusy(false);
    }
  }, [api, closeInstall, installScope, installTarget, libraryId, onInstalled, t]);

  function installAction(plugin: PluginCommunityPluginSummary): ReactNode {
    const installedPackage = installedById.get(plugin.pluginId);
    const needsUpdate = installedPackage !== undefined && installedPackage.version !== plugin.version;
    if (installedPackage === undefined) {
      return (
        <button
          className="secondary-button"
          disabled={busy || api === undefined || !plugin.compatible}
          onClick={(event) => {
            event.stopPropagation();
            setInstallTarget(plugin);
            setInstallScope(libraryId === undefined ? 'user' : 'library');
            setInstallError(undefined);
          }}
          type="button"
          {...(!plugin.compatible ? iconActionAttrs(t('settings.pluginCommunityNoPlatform')) : {})}
        >
          {t('settings.pluginCommunityInstall')}
        </button>
      );
    }
    if (needsUpdate) {
      return (
        <button
          className="secondary-button"
          disabled={busy || api === undefined || !plugin.compatible}
          onClick={(event) => {
            event.stopPropagation();
            setInstallTarget(plugin);
            setInstallScope(installedPackage.scope);
            setInstallError(undefined);
          }}
          type="button"
        >
          {t('settings.pluginCommunityUpdate')}
        </button>
      );
    }
    return (
      <span className="plugin-community-installed">
        <Icon name="check" size={12} />
        {t('settings.pluginCommunityInstalled')}
      </span>
    );
  }

  const installDialog = installTarget === undefined ? null : (
        <div
          className="dialog-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget && !progressActive) closeInstall();
          }}
          role="presentation"
        >
          <DialogShell
            className="create-dialog plugin-install-dialog"
            dialogId="plugin-community-install-dialog"
            footer={progressActive ? (
              <button
                className="secondary-button plugin-install-stop-button"
                onClick={() => {
                  if (operationId !== undefined) {
                    void api?.request({ type: 'plugin-manager.install-control', operationId, action: 'stop' });
                  }
                }}
                type="button"
              >
                {t('settings.pluginInstallStop')}
              </button>
            ) : (
              <button
                className="primary-button"
                disabled={busy || api === undefined || (installScope === 'library' && !canUseLibraryScope)}
                onClick={() => void startInstall()}
                type="button"
              >
                {installTargetUpdating
                  ? t('settings.pluginCommunityUpdate')
                  : t('settings.pluginCommunityInstall')}
              </button>
            )}
            headerActions={(
              <button className="dialog-close" onClick={closeInstall} type="button">
                <Icon name="close" size={16} />
                <span className="visually-hidden">{t('common.cancel')}</span>
              </button>
            )}
            style={{ padding: 0 }}
            title={t(
              installTargetUpdating
                ? 'settings.pluginCommunityUpdateNamed'
                : 'settings.pluginCommunityInstallNamed',
              { name: pickLocalizedText(locale, installTarget.name) },
            )}
          >
            <label className="plugin-install-scope-field">
              <span className="micro-label">{t('settings.pluginInstallScope')}</span>
              <select
                className="text-field"
                disabled={busy || progressActive}
                onChange={(event) => setInstallScope(event.target.value as InstallScope)}
                value={installScope}
              >
                <option value="user">{t('settings.pluginScopeUser')}</option>
                <option disabled={!canUseLibraryScope} value="library">
                  {t('settings.pluginScopeLibrary')}
                </option>
              </select>
            </label>
            {installScope === 'library' && !canUseLibraryScope ? (
              <p className="app-settings-hint">{t('settings.pluginLibraryClosedHint')}</p>
            ) : null}
            {progress === undefined ? null : (
              <div className="plugin-install-progress" role="status">
                <div className="plugin-install-progress-label">
                  <span>
                    {progress.phase === 'resolving'
                      ? t('settings.pluginInstallResolving')
                      : progress.phase === 'installing'
                        ? t('settings.pluginInstallInstalling')
                        : t('settings.pluginInstallDownloading')}
                  </span>
                </div>
                <progress
                  className="plugin-install-progress-bar"
                  max={progress.totalBytes ?? 1}
                  value={progress.totalBytes === undefined ? undefined : progress.bytesDownloaded}
                />
              </div>
            )}
            {installError === undefined ? null : <p className="plugin-settings-error" role="status">{installError}</p>}
          </DialogShell>
        </div>
      );

  if (detailPluginId !== undefined && (detailPlugin !== undefined || catalog === undefined)) {
    return (
      <div className="plugin-community-page">
        {catalog?.stale === true ? (
          <p className="app-settings-hint" role="status">{t('settings.pluginCommunityStale')}</p>
        ) : null}
        {error !== undefined ? <p className="plugin-settings-error" role="status">{error}</p> : null}
        {detailPlugin === undefined ? (
          <p className="app-settings-hint">{t('settings.pluginCommunityReadmeLoading')}</p>
        ) : (
          <PluginCommunityDetailPage
            action={installAction(detailPlugin)}
            api={api}
            key={detailPlugin.pluginId}
            plugin={detailPlugin}
          />
        )}
        {installDialog}
      </div>
    );
  }

  return (
    <div className="plugin-community-page">
      {catalog?.stale === true ? (
        <p className="app-settings-hint" role="status">{t('settings.pluginCommunityStale')}</p>
      ) : null}
      {error !== undefined ? <p className="plugin-settings-error" role="status">{error}</p> : null}
      <label className="plugin-community-search">
        <span className="visually-hidden">{t('settings.pluginCommunitySearch')}</span>
        <Icon name="search" size={14} />
        <input
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('settings.pluginCommunitySearch')}
          type="search"
          value={query}
        />
      </label>
      {filtered.length === 0 && error === undefined ? (
        <p className="app-settings-hint">{t('settings.pluginCommunityEmpty')}</p>
      ) : null}
      <div className="plugin-community-list">
        {filtered.map((plugin) => {
          const copy = resolvePluginDisplayCopy({
            locale,
            fallbackName: plugin.name.en,
            fallbackDescription: plugin.description.en,
            catalog: plugin,
          });
          return (
            <article className="plugin-community-card" key={plugin.pluginId}>
              <button
                className="plugin-community-card-open"
                data-hover-tip={t('settings.pluginCommunityViewDetails')}
                onClick={() => onDetailPluginIdChange?.(plugin.pluginId)}
                type="button"
              >
                <span aria-hidden="true" className="plugin-community-card-icon">
                  <Icon name="box" size={18} />
                </span>
                <div className="plugin-community-card-copy">
                  <div className="plugin-community-title-row">
                    <strong>{copy.name}</strong>
                    <span className="plugin-settings-package-version-inline">{`v${plugin.version}`}</span>
                    <span className={`plugin-community-badge plugin-community-badge--${plugin.tier}`}>
                      {plugin.tier === 'first-party'
                        ? t('settings.pluginCommunityOfficial')
                        : t('settings.pluginCommunityCertified')}
                    </span>
                  </div>
                  <p className="plugin-settings-package-description">{copy.description}</p>
                  {!plugin.compatible ? (
                    <p className="app-settings-hint">{t('settings.pluginCommunityNoPlatform')}</p>
                  ) : null}
                </div>
              </button>
              <div className="plugin-community-card-action">
                {installAction(plugin)}
              </div>
            </article>
          );
        })}
      </div>
      {installDialog}
    </div>
  );
}
