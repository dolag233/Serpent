import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useLocale } from "./i18n";

export type SmartCollectionSettingsTarget = {
  collectionId: string;
  name: string;
};

export type SmartCollectionSettingsDialogProps = {
  target: SmartCollectionSettingsTarget;
  onClose: () => void;
  onRename: (collectionId: string, name: string) => Promise<void>;
  onSaveCurrentQuery: (collectionId: string) => Promise<void>;
};

/**
 * Serpent-era / SMART-007: after inline create, open this dialog so the user
 * can name the collection and attach the current discovery filters — instead
 * of blocking create when no condition is set yet.
 *
 * Remount with `key={collectionId}` from App when the target changes so name
 * state resets without a setState-in-effect sync.
 */
export function SmartCollectionSettingsDialog({
  target,
  onClose,
  onRename,
  onSaveCurrentQuery,
}: SmartCollectionSettingsDialogProps): ReactNode {
  const { t } = useLocale();
  const [name, setName] = useState(target.name);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busy) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
      role="presentation"
    >
      <div
        aria-modal="true"
        className="create-dialog smart-collection-settings-dialog"
        role="dialog"
      >
        <div className="dialog-heading">
          <div>
            <h2>{t("smartEdit.settingsTitle")}</h2>
            <p className="app-settings-hint">{t("smartEdit.settingsHint")}</p>
          </div>
          <button
            className="dialog-close"
            disabled={busy}
            onClick={onClose}
            type="button"
            {...iconActionAttrs(t("common.close"))}
          >
            <Icon name="close" size={16} />
          </button>
        </div>

        <label className="field">
          <span className="micro-label">{t("smartEdit.nameLabel")}</span>
          <input
            className="text-field"
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
        </label>

        <div className="dialog-actions">
          <button
            className="secondary-button"
            disabled={busy || name.trim().length === 0}
            onClick={() =>
              void run(async () => {
                if (name.trim() !== target.name) {
                  await onRename(target.collectionId, name.trim());
                }
                onClose();
              })
            }
            type="button"
          >
            {t("smartEdit.saveName")}
          </button>
          <button
            className="primary-button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if (name.trim().length > 0 && name.trim() !== target.name) {
                  await onRename(target.collectionId, name.trim());
                }
                await onSaveCurrentQuery(target.collectionId);
                onClose();
              })
            }
            type="button"
          >
            {t("smartEdit.saveCurrentQuery")}
          </button>
        </div>
      </div>
    </div>
  );
}
