import { Icon } from './Icons';
import { iconActionAttrs } from './icon-action-attrs';
import { useT } from './i18n';
import { DialogShell } from './ui/patterns';

export type PluginUninstallDialogProps = {
  readonly pluginName: string;
  readonly scopeLabel: string;
  readonly version: string;
  readonly busy?: boolean;
  readonly error?: string;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
};

/** Confirmation gate for removing one installed plugin package. */
export function PluginUninstallDialog({
  pluginName,
  scopeLabel,
  version,
  busy = false,
  error,
  onCancel,
  onConfirm,
}: PluginUninstallDialogProps) {
  const t = useT();

  return (
    <div
      className="dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
      role="presentation"
    >
      <DialogShell
        className="create-dialog plugin-uninstall-dialog"
        dialogId="plugin-uninstall-dialog"
        headerActions={(
          <button
            className="dialog-close"
            disabled={busy}
            onClick={onCancel}
            type="button"
            {...iconActionAttrs(t('common.cancel'))}
          >
            <Icon name="close" size={16} />
          </button>
        )}
        onRequestClose={busy ? undefined : onCancel}
        style={{ padding: 0 }}
        title={t('settings.pluginUninstallTitle')}
      >
        <p className="dialog-body-copy">
          {t('settings.pluginUninstallConfirm', {
            plugin: pluginName,
            scope: scopeLabel,
            version,
          })}
        </p>
        {error === undefined ? null : (
          <p className="plugin-settings-error" role="status">{error}</p>
        )}
        <div className="dialog-actions">
          <button
            className="secondary-button"
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            {t('common.cancel')}
          </button>
          <button
            className="primary-button"
            data-dialog-default-action="true"
            disabled={busy}
            onClick={onConfirm}
            type="button"
          >
            {t('settings.pluginUninstall')}
          </button>
        </div>
      </DialogShell>
    </div>
  );
}
