import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { parsePluginReadmeMarkdown } from '../plugins/plugin-community-readme';
import { resolvePluginDisplayCopy } from '../plugins/plugin-localized-copy';
import type {
  PluginCommunityPluginSummary,
  PluginCommunityReadmeSnapshot,
  SerpentPluginManagerApi,
} from '../shared/plugin-manager-api';
import { Icon } from './Icons';
import { useLocale, useT } from './i18n';
import { PluginReadmeView } from './PluginReadmeView';

type RendererShellApi = {
  openExternalUrl(url: string): Promise<{ ok: boolean }>;
};

type PluginCommunityDetailPageProps = {
  readonly api: SerpentPluginManagerApi | undefined;
  readonly plugin: PluginCommunityPluginSummary;
  readonly action: ReactNode;
};

function shellApi(): RendererShellApi | undefined {
  return (window as Window & { serpent?: { shell?: RendererShellApi } }).serpent?.shell;
}

export function PluginCommunityDetailPage({
  api,
  plugin,
  action,
}: PluginCommunityDetailPageProps): ReactNode {
  const t = useT();
  const { locale } = useLocale();
  const [readme, setReadme] = useState<PluginCommunityReadmeSnapshot | null | undefined>();
  const [readmeError, setReadmeError] = useState<string | undefined>();

  const copy = resolvePluginDisplayCopy({
    locale,
    fallbackName: plugin.name.en,
    fallbackDescription: plugin.description.en,
    catalog: plugin,
  });

  useEffect(() => {
    if (api === undefined) return undefined;
    let cancelled = false;
    const timer = globalThis.setTimeout(() => {
      if (cancelled) return;
      setReadme(undefined);
      setReadmeError(undefined);
      void api.request({
        type: 'plugin-manager.community-readme',
        pluginId: plugin.pluginId,
        locale,
      }).then((response) => {
        if (cancelled) return;
        if (!response.ok) {
          setReadme(null);
          setReadmeError(t('settings.pluginCommunityReadmeUnavailable'));
          return;
        }
        if (!('readme' in response)) {
          setReadme(null);
          setReadmeError(t('settings.pluginCommunityReadmeUnavailable'));
          return;
        }
        setReadme(response.readme);
      }).catch(() => {
        if (cancelled) return;
        setReadme(null);
        setReadmeError(t('settings.pluginCommunityReadmeUnavailable'));
      });
    }, 0);
    return () => {
      cancelled = true;
      globalThis.clearTimeout(timer);
    };
  }, [api, locale, plugin.pluginId, t]);

  const openUrl = useCallback((href: string) => {
    void shellApi()?.openExternalUrl(href);
  }, []);

  const blocks = useMemo(() => {
    if (readme === undefined || readme === null) return [];
    return parsePluginReadmeMarkdown(readme.markdown, {
      repositoryUrl: plugin.repository,
      releaseTag: plugin.releaseTag,
    });
  }, [plugin.releaseTag, plugin.repository, readme]);

  const runtimeLabel = plugin.runtimeMode === 'unrestricted'
    ? t('settings.pluginRuntimeTrusted')
    : t('settings.pluginRuntimeStandard');

  return (
    <div className="plugin-community-card plugin-community-detail">
      <div className="plugin-community-detail-header">
        <span className={`plugin-community-badge plugin-community-badge--${plugin.tier}`}>
          {plugin.tier === 'first-party'
            ? t('settings.pluginCommunityOfficial')
            : t('settings.pluginCommunityCertified')}
        </span>
        {action}
      </div>
      <p className="plugin-settings-package-description">{copy.description}</p>
      <dl className="metadata-list plugin-community-meta">
        <div>
          <dt>{t('settings.pluginCommunityAuthor')}</dt>
          <dd>{plugin.author}</dd>
        </div>
        <div>
          <dt>{t('settings.pluginCommunityVersion')}</dt>
          <dd>{`v${plugin.version}`}</dd>
        </div>
        <div>
          <dt>{t('settings.pluginCommunityRepository')}</dt>
          <dd>
            <button
              className="plugin-community-readme-link"
              onClick={() => openUrl(plugin.repository)}
              type="button"
            >
              {plugin.repository.replace(/^https:\/\/github\.com\//u, '')}
              <Icon name="external-link" size={12} />
            </button>
          </dd>
        </div>
        <div>
          <dt>{t('settings.pluginCommunityRuntime')}</dt>
          <dd>{runtimeLabel}</dd>
        </div>
        <div>
          <dt>{t('settings.pluginCommunityPlatforms')}</dt>
          <dd>{plugin.platforms.join(' · ')}</dd>
        </div>
      </dl>
      <section className="plugin-community-readme-section" aria-labelledby="plugin-community-readme-heading">
        <h4 id="plugin-community-readme-heading">{t('settings.pluginCommunityReadme')}</h4>
        {api === undefined ? (
          <p className="app-settings-hint" role="status">{t('settings.pluginUnavailable')}</p>
        ) : readme === undefined ? (
          <p className="app-settings-hint">{t('settings.pluginCommunityReadmeLoading')}</p>
        ) : readmeError !== undefined ? (
          <p className="app-settings-hint" role="status">{readmeError}</p>
        ) : readme === null ? (
          <p className="app-settings-hint">{t('settings.pluginCommunityReadmeMissing')}</p>
        ) : (
          <PluginReadmeView
            blocks={blocks}
            empty={t('settings.pluginCommunityReadmeMissing')}
            imageLabel={t('settings.pluginCommunityReadmeImage')}
            onOpenUrl={openUrl}
          />
        )}
      </section>
    </div>
  );
}
