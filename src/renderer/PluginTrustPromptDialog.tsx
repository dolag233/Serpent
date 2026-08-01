import { Icon } from './Icons';
import { iconActionAttrs } from './icon-action-attrs';
import { useT } from './i18n';
import type { PendingLibraryPluginTrust } from './plugin-trust-prompt';

export type PluginTrustPromptDialogProps = {
  plugins: readonly PendingLibraryPluginTrust[];
  busy: boolean;
  onTrustAll: () => void;
  onLater: () => void;
  onOpenSettings: () => void;
};

export function PluginTrustPromptDialog({
  plugins,
  busy,
  onTrustAll,
  onLater,
  onOpenSettings,
}: PluginTrustPromptDialogProps) {
  const t = useT();
  if (plugins.length === 0) return null;

  return (
    <div className="dialog-backdrop" role="presentation">
      <div
        aria-labelledby="plugin-trust-prompt-title"
        aria-modal="true"
        className="create-dialog plugin-trust-prompt-dialog"
        role="dialog"
      >
        <div className="dialog-heading">
          <div>
            <h2 id="plugin-trust-prompt-title">{t('dialog.pluginTrustPrompt.title')}</h2>
          </div>
          <button
            className="dialog-close"
            disabled={busy}
            onClick={onLater}
            type="button"
            {...iconActionAttrs(t('dialog.pluginTrustPrompt.later'))}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <p className="dialog-body-copy">
          {t('dialog.pluginTrustPrompt.body', { count: plugins.length })}
        </p>
        <ul className="dialog-body-list plugin-trust-prompt-list">
          {plugins.map((plugin) => (
            <li key={`${plugin.pluginId}:${plugin.packageHash}`}>
              <strong>{plugin.name}</strong>
              <span>
                {plugin.version}
                {' · '}
                {plugin.runtimeMode === 'trusted'
                  ? t('settings.pluginRuntimeTrusted')
                  : t('settings.pluginRuntimeStandard')}
              </span>
              <span className="app-settings-hint">
                {plugin.permissions.length > 0
                  ? plugin.permissions.join(', ')
                  : t('settings.pluginNoPermissions')}
              </span>
              {plugin.runtimeMode === 'trusted' ? (
                <span className="app-settings-hint">
                  {t('settings.pluginTrustTrustedConfirmHint')}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="dialog-actions">
          <button
            className="secondary-button"
            disabled={busy}
            onClick={onOpenSettings}
            type="button"
          >
            {t('dialog.pluginTrustPrompt.openSettings')}
          </button>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={onLater}
            type="button"
          >
            {t('dialog.pluginTrustPrompt.later')}
          </button>
          <button
            className="primary-button"
            disabled={busy}
            onClick={onTrustAll}
            type="button"
          >
            {t('dialog.pluginTrustPrompt.trustAll')}
          </button>
        </div>
      </div>
    </div>
  );
}
