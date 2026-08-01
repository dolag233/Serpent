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
import { iconActionAttrs } from './icon-action-attrs';
import { useT } from './i18n';
import { pluginRequiresTrustedCssDisclosure } from '../plugins/plugin-themes';

type PluginSettingsPageProps = {
  readonly api: SerpentPluginManagerApi | undefined;
  readonly libraryId: string | undefined;
  readonly onOpenPluginSettings?: (pluginId: string) => void;
};

type PluginSnapshot = Extract<
  Awaited<ReturnType<SerpentPluginManagerApi['request']>>,
  { ok: true; packages: unknown }
>;

type InstallScope = 'user' | 'library';

type RendererShellApi = {
  openExternalUrl(url: string): Promise<{ ok: boolean }>;
};

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

function shellApi(): RendererShellApi | undefined {
  return (window as unknown as { serpent?: { shell?: RendererShellApi } }).serpent?.shell;
}

export function PluginSettingsPage({
  api,
  libraryId,
  onOpenPluginSettings,
}: PluginSettingsPageProps): ReactNode {
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
        setError(formatPluginManagerFailure(response, t));
        return;
      }
      if (!('packages' in response)) {
        setError(t('settings.pluginOperationFailed', { code: 'unexpected-response' }));
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
          setError(formatPluginManagerFailure(response, t));
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
          setInstallError(formatPluginManagerFailure(response, t));
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
          {scope === 'library' && grouped.length > 0 ? (
            <span>{t('settings.pluginScopeLibraryHint')}</span>
          ) : null}
        </div>
        {scopeDisabled ? <p className="app-settings-hint">{t('settings.pluginLibraryClosedHint')}</p> : null}

        {grouped.length === 0 && !scopeDisabled ? (
          <p className="app-settings-hint">{t('settings.pluginEmpty')}</p>
        ) : null}

        {grouped.map(([pluginId, pluginPackages], groupIndex) => {
          const resolution = resolutionByPluginId.get(pluginId);
          const newest = pluginPackages[0];
          if (newest === undefined) return null;
          const enabled = isPluginEnabledForScope(resolution, scope);
          const toggleEnabled = canTogglePluginEnabled(resolution, libraryId)
            && newest.status === 'valid';
          const canRollback = enabled
            && libraryId !== undefined
            && pluginPackages.length > 1;
          const showSettingsAction = newest.status === 'valid'
            && newest.hasSettingsUi
            && onOpenPluginSettings !== undefined;
          const githubRepository = newest.source.kind === 'github' ? newest.source.repository : undefined;
          const permissionsTip = newest.permissions.length > 0
            ? t('settings.pluginPermissionsTip', {
              permissions: newest.permissions.join(', '),
            })
            : undefined;

          return (
            <div
              className={`plugin-settings-package${groupIndex > 0 ? ' has-divider' : ''}`}
              key={`${scope}:${pluginId}`}
            >
              <div className="plugin-settings-package-header">
                <div className="plugin-settings-package-title-row">
                  <div className="plugin-settings-package-title">
                    <span className="plugin-settings-package-name">
                      {newest.name}
                      <span className="plugin-settings-package-version-inline">{` - v${newest.version}`}</span>
                    </span>
                    <div className="plugin-settings-package-source-actions">
                      {githubRepository !== undefined ? (
                        <button
                          className="plugin-settings-icon-action"
                          disabled={busy}
                          onClick={() => { void shellApi()?.openExternalUrl(githubRepository); }}
                          type="button"
                          {...iconActionAttrs(t('settings.pluginOpenGitHubSource'))}
                        >
                          <Icon name="github" size={14} />
                        </button>
                      ) : (
                        <button
                          className="plugin-settings-icon-action"
                          disabled={busy || (newest.scope === 'library' && libraryId === undefined)}
                          onClick={() => void execute({
                            type: 'plugin-manager.reveal-package',
                            scope: newest.scope,
                            ...(newest.scope === 'library' && libraryId !== undefined ? { libraryId } : {}),
                            pluginId,
                            version: newest.version,
                          })}
                          type="button"
                          {...iconActionAttrs(t('settings.pluginRevealPackage'))}
                        >
                          <Icon name="folder" size={14} />
                        </button>
                      )}
                      {permissionsTip !== undefined ? (
                        <span
                          aria-label={permissionsTip}
                          className="plugin-settings-permissions-info"
                          data-hover-tip={permissionsTip}
                          role="img"
                        >
                          <Icon name="alert-circle" size={14} />
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="plugin-settings-package-controls">
                    <button
                      className="plugin-settings-icon-action"
                      disabled={busy || api === undefined}
                      onClick={() => void execute({
                        type: 'plugin-manager.reload',
                        ...(libraryId === undefined ? {} : { libraryId }),
                      })}
                      type="button"
                      {...iconActionAttrs(t('settings.pluginReload'))}
                    >
                      <Icon name="refresh" size={14} />
                    </button>
                    {showSettingsAction ? (
                      <button
                        className="plugin-settings-icon-action"
                        disabled={busy}
                        onClick={() => onOpenPluginSettings(pluginId)}
                        type="button"
                        {...iconActionAttrs(t('settings.pluginOpenSettings'))}
                      >
                        <Icon name="settings" size={14} />
                      </button>
                    ) : null}
                    <button
                      className="plugin-settings-icon-action"
                      disabled={busy || (newest.scope === 'library' && libraryId === undefined)}
                      onClick={() => void execute({
                        type: 'plugin-manager.uninstall',
                        scope: newest.scope,
                        ...(newest.scope === 'library' && libraryId !== undefined ? { libraryId } : {}),
                        pluginId,
                        version: newest.version,
                      })}
                      type="button"
                      {...iconActionAttrs(t('settings.pluginUninstall'))}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                    <label
                      className="app-settings-toggle-row plugin-settings-enable-toggle"
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
                <p className="plugin-settings-package-description">{newest.description ?? pluginId}</p>
                {newest.source.kind === 'github' && newest.availableUpdate !== undefined ? (
                  <div className="plugin-settings-update-row">
                    <span className="plugin-settings-update-available">
                      {t('settings.pluginUpdateAvailable', { version: newest.availableUpdate.version })}
                    </span>
                    <button
                      className="secondary-button"
                      disabled={busy || (newest.scope === 'library' && libraryId === undefined)}
                      onClick={() => void execute({
                        type: 'plugin-manager.update-github',
                        scope: newest.scope,
                        ...(newest.scope === 'library' && libraryId !== undefined ? { libraryId } : {}),
                        pluginId,
                        packageHash: newest.packageHash,
                      })}
                      type="button"
                    >
                      {t('settings.pluginUpdateNow')}
                    </button>
                  </div>
                ) : null}
                {newest.source.kind === 'github' && newest.status === 'valid' ? (
                  <label className="app-settings-toggle-row plugin-settings-auto-update">
                    <span className="app-settings-row-copy">
                      <strong>{t('settings.pluginAutoUpdate')}</strong>
                      <span>{t('settings.pluginAutoUpdateHint')}</span>
                    </span>
                    <span className="app-settings-toggle-control">
                      <input
                        checked={newest.autoUpdate === true}
                        disabled={busy}
                        onChange={(event) => {
                          if (event.target.checked) {
                            const confirmed = globalThis.confirm(t('settings.pluginAutoUpdateRisk'));
                            if (!confirmed) return;
                          }
                          void execute({
                            type: 'plugin-manager.set-auto-update',
                            pluginId,
                            sourceFingerprint: newest.sourceFingerprint,
                            enabled: event.target.checked,
                          });
                        }}
                        type="checkbox"
                      />
                      <span aria-hidden="true" className="app-settings-toggle-track" />
                    </span>
                  </label>
                ) : null}
                {newest.scope === 'library'
                  && newest.status === 'valid'
                  && newest.trust !== 'trusted'
                  && newest.runtimeMode === 'unrestricted'
                  ? (
                    <p className="plugin-settings-unrestricted-warning">
                      <Icon name="warning" size={14} />
                      <span>{t('settings.pluginTrustTrustedConfirmHint')}</span>
                    </p>
                  )
                  : null}
                {newest.status === 'valid'
                  && pluginRequiresTrustedCssDisclosure(newest.permissions)
                  ? <p className="app-settings-hint">{t('settings.pluginThemeTrustedCssHint')}</p>
                  : null}
                {newest.runtimeMode === 'unrestricted' ? (
                  <p className="plugin-settings-unrestricted-warning">
                    <Icon name="warning" size={14} />
                    <span>{t('settings.pluginRuntimeTrustedHint')}</span>
                  </p>
                ) : null}
                {newest.status === 'invalid'
                  ? <p className="plugin-settings-error">{t('settings.pluginInvalid', { code: newest.errorCode ?? 'unknown' })}</p>
                  : null}
                {newest.scope === 'library'
                  && newest.status === 'valid'
                  && newest.trust !== 'trusted' ? (
                    <div className="plugin-settings-resolution">
                      <button
                        className="secondary-button"
                        disabled={busy || libraryId === undefined}
                        onClick={() => void execute({
                          type: 'plugin-manager.trust',
                          scope: 'library',
                          libraryId: libraryId!,
                          pluginId,
                          packageHash: newest.packageHash,
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
                          packageHash: newest.packageHash,
                          decision: 'denied',
                        })}
                        type="button"
                      >
                        {t('settings.pluginDeny')}
                      </button>
                    </div>
                  ) : null}
              </div>

              {canRollback ? (
                <div className="plugin-settings-resolution">
                  <span>{t('settings.pluginRollbackHint')}</span>
                  <button
                    className="secondary-button"
                    disabled={busy || libraryId === undefined}
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

              {resolution?.status === 'awaiting-trust' ? (
                <p className="app-settings-hint">
                  {resolution.reason === 'denied'
                    ? t('settings.pluginStatusDenied')
                    : t('settings.pluginStatusAwaitingTrust')}
                </p>
              ) : null}

              {resolution?.status === 'disabled' && resolution.reason === 'safe-mode' ? (
                <p className="app-settings-hint">{t('settings.pluginStatusSafeMode')}</p>
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
