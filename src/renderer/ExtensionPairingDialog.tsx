import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";

export interface ExtensionPairingDialogProps {
  open: boolean;
  token: string;
  error: string | null;
  onClose: () => void;
  onRotate: () => void;
  onCopy: () => void;
}

export function ExtensionPairingDialog({
  open,
  token,
  error,
  onClose,
  onRotate,
  onCopy,
}: ExtensionPairingDialogProps) {
  const t = useT();
  if (!open) return null;

  return (
    <div className="dialog-backdrop" role="presentation">
      <div
        aria-labelledby="extension-pairing-title"
        aria-modal="true"
        className="create-dialog"
        role="dialog"
      >
        <div className="dialog-heading">
          <div>
            <h2 id="extension-pairing-title">
              {t("dialog.extensionPairing.title")}
            </h2>
          </div>
          <button
            className="dialog-close"
            onClick={onClose}
            type="button"
            {...iconActionAttrs(t("dialog.extensionPairing.closeAria"))}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <p className="dialog-body-copy">
          {t("dialog.extensionPairing.help")}
        </p>
        {error ? (
          <p className="dialog-alert-warning" role="alert">
            {error}
          </p>
        ) : (
          <>
            <label
              className="field-label"
              htmlFor="extension-pairing-token"
            >
              {t("dialog.extensionPairing.tokenLabel")}
            </label>
            <input
              className="text-field text-field-mono"
              id="extension-pairing-token"
              onFocus={(event) => event.currentTarget.select()}
              readOnly
              spellCheck={false}
              value={token || t("dialog.extensionPairing.reading")}
            />
            <p className="field-help">{t("dialog.extensionPairing.rotateHelp")}</p>
          </>
        )}
        <div className="dialog-actions">
          <button
            className="secondary-button"
            disabled={!token}
            onClick={() => void onRotate()}
            type="button"
          >
            {t("dialog.extensionPairing.rotate")}
          </button>
          <button
            className="primary-button"
            disabled={!token}
            onClick={() => void onCopy()}
            type="button"
          >
            {t("dialog.extensionPairing.copy")}
          </button>
        </div>
      </div>
    </div>
  );
}
