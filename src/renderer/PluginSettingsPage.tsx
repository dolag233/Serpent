import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type {
  PluginManagerPackageSummary,
  PluginManagerRequest,
  PluginManagerResolutionCandidate,
  PluginManagerResolutionSummary,
  SerpentPluginManagerApi,
} from '../shared/plugin-manager-api';
import { Icon } from './Icons';
import { useT } from './i18n';

type PluginSettingsPageProps = {
  readonly api: SerpentPluginManagerApi | undefined;
  readonly libraryId: string | undefined;
};

type PluginSnapshot = Extract<
  Awaited<ReturnType<SerpentPluginManagerApi['request']>>,
  { ok: true }
>;

type InstallScope = 'user' | 'library';

function sourceLabel(pluginPackage: Pick<PluginManagerPackageSummary, 'source'>, t: ReturnType<typeof useT>): string {
  if (pluginPackage.source.kind === 'github') {
    return `${pluginPackage.source.repository} · ${pluginPackage.source.ref} · ${pluginPackage.source.commitSha.slice(0, 12)}`;
  }
  return pluginPackage.source.kind === 'local-package'
    ? t('settings.pluginSourceLocalPackage')
    : t('settings.pluginSourceLocalDirectory');
}

function resolutionLabel(resolution: PluginManagerResolutionSummary | undefined, t: ReturnType<typeof useT>): string {
  if (resolution === undefined) return t('settings.pluginStatusNoLibrary');
  switch (resolution.status) {
    case 'resolved': return t('settings.pluginStatusActive');
    case 'awaiting-trust': return resolution.reason === 'denied'
      ? t('settings.pluginStatusDenied')
      : t('settings.pluginStatusAwaitingTrust');
    case 'conflict': return t('settings.pluginStatusChooseVersion');
    case 'requires-confirmation': return t('settings.pluginStatusConfirmUpdate');
    case 'disabled':
      if (resolution.reason === 'safe-mode') return t('settings.pluginStatusSafeMode');
      if (resolution.reason === 'quarantined') return t('settings.pluginStatusQuarantined');
      return t('settings.pluginStatusDisabled');
    case 'not-installed': return t('settings.pluginStatusNotInstalled');
  }
}

function candidateLabel(candidate: PluginManagerResolutionCandidate, t: ReturnType<typeof useT>): string {
  return candidate.scope === 'user'
    ? t('settings.pluginUseUserVersion', { version: candidate.version })
    : t('settings.pluginUseLibraryVersion', { version: candidate.version });
}

function isPluginEnabledForScope(
  resolution: PluginManagerResolutionSummary | undefined,
  scope: InstallScope,
): boolean {
  if (resolution?.status !== 'resolved') return false;
  if (resolution.selection === 'use-global') return scope === 'user';
  if (resolution.selection === 'use-library') return scope === 'library';
  return false;
}

function canTogglePluginEnabled(
  resolution: PluginManagerResolutionSummary | undefined,
  libraryId: string | undefined,
): boolean {
  if (libraryId === undefined) return false;
  if (resolution === undefined) return false;
  if (resolution.status === 'resolved') return true;
  if (resolution.status === 'disabled' && resolution.reason === 'user-disabled') return true;
  return false;
}

export function PluginSettingsPage({ api, libraryId }: PluginSettingsPageProps): ReactNode {
  const t = useT();
  const [snapshot, setSnapshot] = useState<PluginSnapshot | undefined>();
  const [installOpen, setInstallOpen] = useState(false);
  const [installScope, setInstallScope] = useState<InstallScope>('user');
  const [githubRepository, setGithubRepository] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [installError, setInstallError] = useState<string | undefined>();

  const load = useCallback(async () => {
    if (api === undefined) {
      setError(t('settings.pluginUnavailable'));
      return;
    }
    setLoading(true);
    try {
      const response = await api.request({
        type: 'plugin-manager.list',
        ...(libraryId === undefined ? {} : { libraryId }),
      });
      if (!response.ok) {
        setError(t('settings.pluginOperationFailed', { code: response.code }));
        return;
      }
      setSnapshot(response);
      setError(undefined);
    } catch {
      setError(t('settings.pluginOperationFailed', { code: 'bridge-unavailable' }));
    } finally {
      setLoading(false);
    }
  }, [api, libraryId, t]);

  useEffect(() => {
    const timer = globalThis.setTimeout(() => void load(), 0);
    return () => globalThis.clearTimeout(timer);
  }, [load]);

  const execute = useCallback(async (request: PluginManagerRequest): Promise<boolean> => {
    if (api === undefined) {
      setError(t('settings.pluginUnavailable'));
      return false;
    }
    setBusy(true);
    try {
      const response = await api.request(request);
      if (!response.ok) {
        if (response.code !== 'selection-cancelled') {
          setError(t('settings.pluginOperationFailed', { code: response.code }));
        }
        return false;
      }
      setError(undefined);
      await load();
      return true;
    } catch {
      setError(t('settings.pluginOperationFailed', { code: 'bridge-unavailable' }));
      return false;
    } finally {
      setBusy(false);
    }
  }, [api, load, t]);

  const resolutionByPluginId = useMemo(
    () => new Map(snapshot?.resolutions.map((resolution) => [resolution.pluginId, resolution]) ?? []),
    [snapshot],
  );

  const packagesByScope = useMemo(() => {
    const user: PluginManagerPackageSummary[] = [];
    const library: PluginManagerPackageSummary[] = [];
    for (const item of snapshot?.packages ?? []) {
      if (item.scope === 'user') user.push(item);
      else library.push(item);
    }
    const sortPackages = (items: PluginManagerPackageSummary[]) => [...items].sort((left, right) => {
      const byId = left.pluginId.localeCompare(right.pluginId);
      if (byId !== 0) return byId;
      return right.version.localeCompare(left.version);
    });
    return {
      user: sortPackages(user),
      library: sortPackages(library),
    };
  }, [snapshot]);

  const canUseLibraryScope = libraryId !== undefined;

  const setEnabledForPackage = useCallback(async (
    pluginPackage: PluginManagerPackageSummary,
    enabled: boolean,
  ): Promise<void> => {
    if (libraryId === undefined) return;
    if (!enabled) {
      await execute({
        type: 'plugin-manager.resolve',
        libraryId,
        pluginId: pluginPackage.pluginId,
        selection: 'disabled',
      });
      return;
    }
    await execute({
      type: 'plugin-manager.resolve',
      libraryId,
      pluginId: pluginPackage.pluginId,
      selection: pluginPackage.scope === 'user' ? 'use-global' : 'use-library',
      packageHash: pluginPackage.packageHash,
    });
  }, [execute, libraryId]);

  const openInstallDialog = useCallback(() => {
    setGithubRepository('');
    setInstallError(undefined);
    setInstallScope(libraryId === undefined ? 'user' : 'library');
    setInstallOpen(true);
  }, [libraryId]);

  const closeInstallDialog = useCallback(() => {
    setInstallOpen(false);
    setGithubRepository('');
    setInstallError(undefined);
  }, []);

  const installScoped = useCallback(async (
    request: Extract<PluginManagerRequest, { type: 'plugin-manager.install-local' | 'plugin-manager.install-github' }>,
  ): Promise<void> => {
    if (api === undefined) {
      setInstallError(t('settings.pluginUnavailable'));
      return;
    }
    setBusy(true);
    try {
      const response = await api.request(request);
      if (!response.ok) {
        if (response.code !== 'selection-cancelled') {
          setInstallError(t('settings.pluginOperationFailed', { code: response.code }));
        }
        return;
      }
      setInstallError(undefined);
      setError(undefined);
      await load();
      closeInstallDialog();
    } catch {
      setInstallError(t('settings.pluginOperationFailed', { code: 'bridge-unavailable' }));
    } finally {
      setBusy(false);
    }
  }, [api, closeInstallDialog, load, t]);

  const scopeHoverTip = (scope: InstallScope): string => (
    scope === 'library'
      ? t('settings.pluginScopeLibraryHint')
      : t('settings.pluginScopeUserTip')
  );

  const renderInstallCard = (scope: InstallScope): ReactNode => {
    const packages = packagesByScope[scope];
    const scopeDisabled = scope === 'library' && !canUseLibraryScope;
    const pluginGroups = new Map<string, PluginManagerPackageSummary[]>();
    for (const item of packages) {
      const group = pluginGroups.get(item.pluginId) ?? [];
      group.push(item);
      pluginGroups.set(item.pluginId, group);
    }
    const grouped = [...pluginGroups.entries()];

    return (
      <section className="app-settings-card plugin-settings-scope-card" key={scope}>
        <div className="app-settings-row-copy">
          <strong>{scope === 'user' ? t('settings.pluginScopeUser') : t('settings.pluginScopeLibrary')}</strong>
          {scope === 'library' ? (
            <span>{t('settings.pluginScopeLibraryHint')}</span>
          ) : null}
        </div>
        {scopeDisabled ? <p className="app-settings-hint">{t('settings.pluginLibraryClosedHint')}</p> : null}

        {grouped.length === 0 && !scopeDisabled ? (
          <p className="app-settings-hint">{t('settings.pluginEmpty')}</p>
        ) : null}

        {grouped.map(([pluginId, pluginPackages]) => {
          const resolution = resolutionByPluginId.get(pluginId);
          const newest = pluginPackages[0];
          if (newest === undefined) return null;
          const enabled = isPluginEnabledForScope(resolution, scope);
          const toggleEnabled = canTogglePluginEnabled(resolution, libraryId)
            && newest.status === 'valid';
          const canRollback = enabled
            && libraryId !== undefined
            && pluginPackages.length > 1;

          return (
            <div className="plugin-settings-package" key={`${scope}:${pluginId}`}>
              <div className="plugin-settings-package-header">
                <div className="app-settings-row-copy">
                  <strong>{newest.name}</strong>
                  <span>{newest.description ?? pluginId}</span>
                </div>
                <div className="plugin-settings-package-controls">
                  <span className="plugin-settings-status">{resolutionLabel(resolution, t)}</span>
                  <label
                    className="app-settings-toggle-row plugin-settings-enable-toggle"
                    title={t('settings.pluginEnable')}
                  >
                    <span className="visually-hidden">{t('settings.pluginEnable')}</span>
                    <span className="app-settings-toggle-control">
                      <input
                        aria-label={t('settings.pluginEnable')}
                        checked={enabled}
                        disabled={busy || !toggleEnabled}
                        onChange={(event) => void setEnabledForPackage(newest, event.target.checked)}
                        type="checkbox"
                      />
                      <span aria-hidden="true" className="app-settings-toggle-track" />
                    </span>
                  </label>
                </div>
              </div>

              {pluginPackages.map((pluginPackage) => (
                <div className="plugin-settings-package-version" key={`${pluginPackage.scope}:${pluginPackage.packageHash}`}>
                  <div className="plugin-settings-package-meta">
                    <strong>{pluginPackage.version}</strong>
                    <span>{sourceLabel(pluginPackage, t)}</span>
                    <span>
                      {pluginPackage.runtimeMode === 'trusted'
                        ? t('settings.pluginRuntimeTrusted')
                        : t('settings.pluginRuntimeStandard')}
                      {' · '}
                      {pluginPackage.permissions.join(', ') || t('settings.pluginNoPermissions')}
                    </span>
                    <span className="app-settings-hint">
                      {pluginPackage.runtimeMode === 'trusted'
                        ? t('settings.pluginRuntimeTrustedHint')
                        : t('settings.pluginRuntimeStandardHint')}
                    </span>
                    {pluginPackage.scope === 'library'
                      && pluginPackage.status === 'valid'
                      && pluginPackage.trust !== 'trusted'
                      && pluginPackage.runtimeMode === 'trusted'
                      ? <span className="app-settings-hint">{t('settings.pluginTrustTrustedConfirmHint')}</span>
                      : null}
                    {pluginPackage.status === 'invalid'
                      ? <span>{t('settings.pluginInvalid', { code: pluginPackage.errorCode ?? 'unknown' })}</span>
                      : null}
                  </div>
                  <div className="plugin-settings-package-actions">
                    {pluginPackage.scope === 'library'
                      && pluginPackage.status === 'valid'
                      && pluginPackage.trust !== 'trusted' ? (
                      <>
                        <button
                          className="secondary-button"
                          disabled={busy || libraryId === undefined}
                          onClick={() => void execute({
                            type: 'plugin-manager.trust',
                            scope: 'library',
                            libraryId: libraryId!,
                            pluginId,
                            packageHash: pluginPackage.packageHash,
                            decision: 'trusted',
                          })}
                          type="button"
                        >
                          {t('settings.pluginTrust')}
                        </button>
                        <button
                          className="secondary-button"
                          disabled={busy || libraryId === undefined}
                          onClick={() => void execute({
                            type: 'plugin-manager.trust',
                            scope: 'library',
                            libraryId: libraryId!,
                            pluginId,
                            packageHash: pluginPackage.packageHash,
                            decision: 'denied',
                          })}
                          type="button"
                        >
                          {t('settings.pluginDeny')}
                        </button>
                      </>
                    ) : null}
                    <button
                      className="secondary-button"
                      disabled={busy || (pluginPackage.scope === 'library' && libraryId === undefined)}
                      onClick={() => void execute({
                        type: 'plugin-manager.uninstall',
                        scope: pluginPackage.scope,
                        ...(pluginPackage.scope === 'library' && libraryId !== undefined ? { libraryId } : {}),
                        pluginId,
                        version: pluginPackage.version,
                      })}
                      type="button"
                    >
                      {t('settings.pluginUninstall')}
                    </button>
                  </div>
                </div>
              ))}

              {canRollback ? (
                <div className="plugin-settings-resolution">
                  <span>{t('settings.pluginRollbackHint')}</span>
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => void execute({
                      type: 'plugin-manager.rollback',
                      libraryId: libraryId!,
                      pluginId,
                    })}
                    type="button"
                  >
                    {t('settings.pluginRollback')}
                  </button>
                </div>
              ) : null}

              {resolution?.status === 'disabled' && resolution.reason === 'quarantined' ? (
                <div className="plugin-settings-resolution">
                  <span>{t('settings.pluginQuarantineHint')}</span>
                  <button
                    className="secondary-button"
                    disabled={busy || libraryId === undefined}
                    onClick={() => void execute({
                      type: 'plugin-manager.clear-quarantine',
                      libraryId: libraryId!,
                      pluginId,
                      packageHash: resolution.packageHash,
                    })}
                    type="button"
                  >
                    {t('settings.pluginReenable')}
                  </button>
                </div>
              ) : null}

              {resolution?.status === 'conflict' ? (
                <div className="plugin-settings-resolution">
                  <span>{t('settings.pluginConflictHint')}</span>
                  {resolution.candidates.map((candidate) => (
                    <button
                      className="secondary-button"
                      disabled={busy || libraryId === undefined}
                      key={`${candidate.scope}:${candidate.packageHash}`}
                      onClick={() => void execute({
                        type: 'plugin-manager.resolve',
                        libraryId: libraryId!,
                        pluginId,
                        selection: candidate.scope === 'user' ? 'use-global' : 'use-library',
                        packageHash: candidate.packageHash,
                      })}
                      type="button"
                    >
                      {candidateLabel(candidate, t)}
                    </button>
                  ))}
                  <button
                    className="secondary-button"
                    disabled={busy || libraryId === undefined}
                    onClick={() => void execute({
                      type: 'plugin-manager.resolve',
                      libraryId: libraryId!,
                      pluginId,
                      selection: 'disabled',
                    })}
                    type="button"
                  >
                    {t('settings.pluginDisable')}
                  </button>
                </div>
              ) : null}

              {resolution?.status === 'requires-confirmation' ? (
                <div className="plugin-settings-resolution">
                  <span>{t('settings.pluginUpdateNeedsConfirmation')}</span>
                  {resolution.candidate === undefined ? null : (
                    <button
                      className="secondary-button"
                      disabled={busy || libraryId === undefined}
                      onClick={() => void execute({
                        type: 'plugin-manager.resolve',
                        libraryId: libraryId!,
                        pluginId,
                        selection: resolution.candidate!.scope === 'user' ? 'use-global' : 'use-library',
                        packageHash: resolution.candidate!.packageHash,
                      })}
                      type="button"
                    >
                      {candidateLabel(resolution.candidate, t)}
                    </button>
                  )}
                  <button
                    className="secondary-button"
                    disabled={busy || libraryId === undefined}
                    onClick={() => void execute({
                      type: 'plugin-manager.resolve',
                      libraryId: libraryId!,
                      pluginId,
                      selection: 'disabled',
                    })}
                    type="button"
                  >
                    {t('settings.pluginDisable')}
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </section>
    );
  };

  const libraryInstallDisabled = installScope === 'library' && !canUseLibraryScope;

  return (
    <div className="plugin-settings-page">
      <section className="app-settings-card plugin-settings-overview">
        <div className="app-settings-action-row plugin-settings-overview-header">
          <div className="app-settings-row-copy">
            <strong>{t('settings.pluginsTitle')}</strong>
            <span>{t('settings.pluginsHint')}</span>
          </div>
          <button
            className="secondary-button"
            disabled={busy || api === undefined}
            onClick={openInstallDialog}
            type="button"
          >
            {t('settings.pluginInstall')}
          </button>
        </div>
        <label className="app-settings-toggle-row plugin-settings-safe-mode">
          <span className="app-settings-row-copy">
            <strong>{t('settings.pluginSafeMode')}</strong>
            <span>{t('settings.pluginSafeModeHint')}</span>
          </span>
          <span className="app-settings-toggle-control">
            <input
              checked={snapshot?.safeMode ?? false}
              disabled={busy || api === undefined}
              onChange={(event) => void execute({
                type: 'plugin-manager.safe-mode',
                enabled: event.target.checked,
              })}
              type="checkbox"
            />
            <span aria-hidden="true" className="app-settings-toggle-track" />
          </span>
        </label>
      </section>

      {error === undefined ? null : <p className="plugin-settings-error" role="status">{error}</p>}
      {loading ? <p className="app-settings-hint">{t('settings.pluginLoading')}</p> : null}

      {renderInstallCard('user')}
      {renderInstallCard('library')}

      {installOpen ? (
        <div
          className="dialog-backdrop plugin-install-dialog-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget && !busy) closeInstallDialog();
          }}
          role="presentation"
        >
          <div
            aria-labelledby="plugin-install-dialog-title"
            aria-modal="true"
            className="create-dialog plugin-install-dialog"
            role="dialog"
          >
            <div className="dialog-heading">
              <div>
                <h2 id="plugin-install-dialog-title">{t('settings.pluginInstall')}</h2>
              </div>
              <button
                className="dialog-close"
                disabled={busy}
                onClick={closeInstallDialog}
                type="button"
              >
                <Icon name="close" size={16} />
                <span className="visually-hidden">{t('common.cancel')}</span>
              </button>
            </div>

            <label className="plugin-install-scope-field">
              <span className="micro-label">{t('settings.pluginInstallScope')}</span>
              <select
                className="text-field"
                disabled={busy}
                onChange={(event) => setInstallScope(event.target.value as InstallScope)}
                title={scopeHoverTip(installScope)}
                value={installScope}
              >
                <option title={scopeHoverTip('user')} value="user">
                  {t('settings.pluginScopeUser')}
                </option>
                <option
                  disabled={!canUseLibraryScope}
                  title={
                    canUseLibraryScope
                      ? scopeHoverTip('library')
                      : t('settings.pluginLibraryClosedHint')
                  }
                  value="library"
                >
                  {t('settings.pluginScopeLibrary')}
                </option>
              </select>
            </label>
            {scopeHoverTip(installScope) ? (
              <p className="app-settings-hint">{scopeHoverTip(installScope)}</p>
            ) : null}
            {libraryInstallDisabled ? (
              <p className="app-settings-hint">{t('settings.pluginLibraryClosedHint')}</p>
            ) : null}

            {installError === undefined ? null : (
              <p className="plugin-settings-error" role="status">{installError}</p>
            )}

            <div className="plugin-settings-install-local">
              <button
                className="secondary-button"
                disabled={busy || api === undefined || libraryInstallDisabled}
                onClick={() => void installScoped({
                  type: 'plugin-manager.install-local',
                  scope: installScope,
                  ...(installScope === 'library' && libraryId !== undefined ? { libraryId } : {}),
                })}
                type="button"
              >
                {t('settings.pluginInstallLocal')}
              </button>
            </div>

            <div className="plugin-settings-install-github">
              <input
                aria-label={t('settings.pluginGitHubRepository')}
                className="text-field"
                disabled={busy || api === undefined || libraryInstallDisabled}
                onChange={(event) => setGithubRepository(event.target.value)}
                placeholder={t('settings.pluginGitHubPlaceholder')}
                type="url"
                value={githubRepository}
              />
              <button
                aria-label={t('settings.pluginInstallGitHub')}
                className="secondary-button plugin-settings-github-button"
                disabled={
                  busy
                  || githubRepository.trim() === ''
                  || api === undefined
                  || libraryInstallDisabled
                }
                onClick={() => void installScoped({
                  type: 'plugin-manager.install-github',
                  scope: installScope,
                  ...(installScope === 'library' && libraryId !== undefined ? { libraryId } : {}),
                  repository: githubRepository.trim(),
                })}
                title={t('settings.pluginInstallGitHub')}
                type="button"
              >
                <Icon name="github" size={16} />
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
