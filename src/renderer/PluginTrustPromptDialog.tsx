import { Icon } from './Icons';
import { iconActionAttrs } from './icon-action-attrs';
import { useT } from './i18n';
import { pluginRequiresTrustedCssDisclosure } from '../plugins/plugin-themes';
import type { PendingLibraryPluginTrust } from './plugin-trust-prompt';
import { DialogShell } from './ui/patterns';

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
      <DialogShell
        className="create-dialog plugin-trust-prompt-dialog"
        dialogId="plugin-trust-prompt"
        headerActions={
          <button
            className="dialog-close"
            disabled={busy}
            onClick={onLater}
            type="button"
            {...iconActionAttrs(t('dialog.pluginTrustPrompt.later'))}
          >
            <Icon name="close" size={16} />
          </button>
        }
        onRequestClose={busy ? undefined : onLater}
        style={{ padding: 0 }}
        title={t('dialog.pluginTrustPrompt.title')}
      >
        <p className="dialog-body-copy">
          {t('dialog.pluginTrustPrompt.body', { count: plugins.length })}
        </p>
        <ul className="dialog-body-list plugin-trust-prompt-list">
          {plugins.map((plugin) => (
            <li key={`${plugin.pluginId}:${plugin.packageHash}`}>
              <strong>{plugin.name}</strong>
              <span className={plugin.runtimeMode === 'unrestricted' ? 'plugin-runtime-mode-unrestricted' : undefined}>
                {plugin.version}
                {' · '}
                {plugin.runtimeMode === 'unrestricted'
                  ? t('settings.pluginRuntimeTrusted')
                  : t('settings.pluginRuntimeStandard')}
              </span>
              <span className="app-settings-hint">
                {plugin.permissions.length > 0
                  ? plugin.permissions.join(', ')
                  : t('settings.pluginNoPermissions')}
              </span>
              {plugin.runtimeMode === 'unrestricted' ? (
                <span className="app-settings-hint plugin-runtime-mode-unrestricted-hint">
                  {t('settings.pluginTrustTrustedConfirmHint')}
                </span>
              ) : null}
              {pluginRequiresTrustedCssDisclosure(plugin.permissions) ? (
                <span className="app-settings-hint">
                  {t('settings.pluginThemeTrustedCssTrustHint')}
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
      </DialogShell>
    </div>
  );
}
