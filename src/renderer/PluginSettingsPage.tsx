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
import { useT } from './i18n';

type PluginSettingsPageProps = {
  readonly api: SerpentPluginManagerApi | undefined;
  readonly libraryId: string | undefined;
};

type PluginSnapshot = Extract<
  Awaited<ReturnType<SerpentPluginManagerApi['request']>>,
  { ok: true }
>;

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
    case 'disabled': return resolution.reason === 'safe-mode'
      ? t('settings.pluginStatusSafeMode')
      : t('settings.pluginStatusDisabled');
    case 'not-installed': return t('settings.pluginStatusNotInstalled');
  }
}

function candidateLabel(candidate: PluginManagerResolutionCandidate, t: ReturnType<typeof useT>): string {
  return candidate.scope === 'user'
    ? t('settings.pluginUseUserVersion', { version: candidate.version })
    : t('settings.pluginUseLibraryVersion', { version: candidate.version });
}

export function PluginSettingsPage({ api, libraryId }: PluginSettingsPageProps): ReactNode {
  const t = useT();
  const [snapshot, setSnapshot] = useState<PluginSnapshot | undefined>();
  const [scope, setScope] = useState<'user' | 'library'>('user');
  const [githubRepository, setGithubRepository] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

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
    // Defer the initial bridge read beyond the effect commit. This avoids a
    // synchronous render cascade while still refreshing whenever the active
    // library or the narrowly exposed preload API changes.
    const timer = globalThis.setTimeout(() => void load(), 0);
    return () => globalThis.clearTimeout(timer);
  }, [load]);

  const execute = useCallback(async (request: PluginManagerRequest): Promise<void> => {
    if (api === undefined) {
      setError(t('settings.pluginUnavailable'));
      return;
    }
    setBusy(true);
    try {
      const response = await api.request(request);
      if (!response.ok) {
        if (response.code !== 'selection-cancelled') {
          setError(t('settings.pluginOperationFailed', { code: response.code }));
        }
        return;
      }
      setError(undefined);
      await load();
    } catch {
      setError(t('settings.pluginOperationFailed', { code: 'bridge-unavailable' }));
    } finally {
      setBusy(false);
    }
  }, [api, load, t]);

  const scopedFields = useMemo(() => ({
    scope,
    ...(scope === 'library' && libraryId !== undefined ? { libraryId } : {}),
  }), [libraryId, scope]);
  const resolutionByPluginId = useMemo(
    () => new Map(snapshot?.resolutions.map((resolution) => [resolution.pluginId, resolution]) ?? []),
    [snapshot],
  );

  const canUseLibraryScope = libraryId !== undefined;
  const packageGroups = useMemo(() => {
    const groups = new Map<string, PluginManagerPackageSummary[]>();
    for (const item of snapshot?.packages ?? []) {
      const group = groups.get(item.pluginId) ?? [];
      group.push(item);
      groups.set(item.pluginId, group);
    }
    return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [snapshot]);

  return (
    <div className="plugin-settings-page">
      <section className="app-settings-card plugin-settings-overview">
        <div className="app-settings-row-copy">
          <strong>{t('settings.pluginsTitle')}</strong>
          <span>{t('settings.pluginsHint')}</span>
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

      <section className="app-settings-card plugin-settings-install">
        <div className="app-settings-row-copy">
          <strong>{t('settings.pluginInstall')}</strong>
          <span>{t('settings.pluginInstallHint')}</span>
        </div>
        <div aria-label={t('settings.pluginInstallScope')} className="app-settings-option-group plugin-settings-scope" role="radiogroup">
          <button
            aria-checked={scope === 'user'}
            className="app-settings-option"
            onClick={() => setScope('user')}
            role="radio"
            type="button"
          >
            {t('settings.pluginScopeUser')}
          </button>
          <button
            aria-checked={scope === 'library'}
            className="app-settings-option"
            disabled={!canUseLibraryScope}
            onClick={() => setScope('library')}
            role="radio"
            type="button"
          >
            {t('settings.pluginScopeLibrary')}
          </button>
        </div>
        {scope === 'library' ? <p className="app-settings-hint">{t('settings.pluginLibraryTrustHint')}</p> : null}
        <div className="plugin-settings-install-actions">
          <button
            className="secondary-button"
            disabled={busy || api === undefined || (scope === 'library' && !canUseLibraryScope)}
            onClick={() => void execute({ type: 'plugin-manager.install-local', ...scopedFields })}
            type="button"
          >
            {t('settings.pluginInstallLocal')}
          </button>
          <div className="plugin-settings-github-field">
            <input
              aria-label={t('settings.pluginGitHubRepository')}
              className="text-field"
              disabled={busy || api === undefined}
              onChange={(event) => setGithubRepository(event.target.value)}
              placeholder={t('settings.pluginGitHubPlaceholder')}
              type="url"
              value={githubRepository}
            />
            <button
              className="secondary-button"
              disabled={busy || githubRepository.trim() === '' || api === undefined || (scope === 'library' && !canUseLibraryScope)}
              onClick={() => void execute({
                type: 'plugin-manager.install-github',
                ...scopedFields,
                repository: githubRepository.trim(),
              })}
              type="button"
            >
              {t('settings.pluginInstallGitHub')}
            </button>
          </div>
        </div>
      </section>

      {error === undefined ? null : <p className="plugin-settings-error" role="status">{error}</p>}
      {loading ? <p className="app-settings-hint">{t('settings.pluginLoading')}</p> : null}
      {!loading && packageGroups.length === 0 ? <p className="app-settings-hint">{t('settings.pluginEmpty')}</p> : null}

      {packageGroups.map(([pluginId, packages]) => {
        const resolution = resolutionByPluginId.get(pluginId);
        const selectedScope = resolution?.status === 'resolved'
          ? resolution.selection === 'use-global' ? 'user' : 'library'
          : undefined;
        const canRollback = selectedScope !== undefined
          && packages.filter((pluginPackage) => pluginPackage.scope === selectedScope).length > 1;
        return (
          <section className="app-settings-card plugin-settings-package" key={pluginId}>
            <div className="plugin-settings-package-header">
              <div className="app-settings-row-copy">
                <strong>{packages[0]?.name ?? pluginId}</strong>
                <span>{packages[0]?.description ?? pluginId}</span>
              </div>
              <span className="plugin-settings-status">{resolutionLabel(resolution, t)}</span>
            </div>
            {packages.map((pluginPackage) => (
              <div className="plugin-settings-package-version" key={`${pluginPackage.scope}:${pluginPackage.packageHash}`}>
                <div className="plugin-settings-package-meta">
                  <strong>{pluginPackage.version} · {pluginPackage.scope === 'user' ? t('settings.pluginScopeUser') : t('settings.pluginScopeLibrary')}</strong>
                  <span>{sourceLabel(pluginPackage, t)}</span>
                  <span>{pluginPackage.runtimeMode === 'trusted' ? t('settings.pluginRuntimeTrusted') : t('settings.pluginRuntimeStandard')} · {pluginPackage.permissions.join(', ') || t('settings.pluginNoPermissions')}</span>
                  {pluginPackage.status === 'invalid' ? <span>{t('settings.pluginInvalid', { code: pluginPackage.errorCode ?? 'unknown' })}</span> : null}
                </div>
                <div className="plugin-settings-package-actions">
                  {pluginPackage.scope === 'library' && pluginPackage.status === 'valid' && pluginPackage.trust !== 'trusted' ? (
                    <>
                      <button
                        className="secondary-button"
                        disabled={busy}
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
                        disabled={busy}
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
            {resolution?.status === 'conflict' ? (
              <div className="plugin-settings-resolution">
                <span>{t('settings.pluginConflictHint')}</span>
                {resolution.candidates.map((candidate) => (
                  <button
                    className="secondary-button"
                    disabled={busy}
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
                  disabled={busy}
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
                    disabled={busy}
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
                  disabled={busy}
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
          </section>
        );
      })}
    </div>
  );
}
