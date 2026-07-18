import { type FormEvent } from "react";
import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";

export interface CreateDialogProps {
  open: boolean;
  value: string;
  onValueChange: (val: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

/**
 * Library-creation dialog. Folder creation used to share this dialog until
 * REQ-FOLDER-007 moved folder create/rename to inline editing in the directory
 * tree; what remains here is the local-library name prompt only.
 */
export function CreateDialog({
  open,
  value,
  onValueChange,
  onSubmit,
  onCancel,
}: CreateDialogProps) {
  const t = useT();
  if (!open) return null;

  return (
    <div className="dialog-backdrop" role="presentation">
      <form
        aria-labelledby="create-dialog-title"
        aria-modal="true"
        className="create-dialog"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          if (!value.trim()) return;
          onSubmit();
        }}
        role="dialog"
      >
        <div className="dialog-heading">
          <div>
            {/* REQ-SHELL-009: no decorative English caption in the Chinese
                UI — the library-only dialog goes straight to the title. */}
            <h2 id="create-dialog-title">{t("dialog.createLibrary.title")}</h2>
          </div>
          <button
            className="dialog-close"
            onClick={onCancel}
            type="button"
            {...iconActionAttrs(t("common.cancel"))}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <label className="field-label" htmlFor="dialog-name">
          {t("dialog.createLibrary.name")}
        </label>
        <input
          autoFocus
          className="text-field"
          id="dialog-name"
          maxLength={255}
          onChange={(event) => onValueChange(event.target.value)}
          value={value}
        />
        {t("dialog.createLibrary.help").trim() ? (
          <p className="field-help">{t("dialog.createLibrary.help")}</p>
        ) : null}
        <div className="dialog-actions">
          <button
            className="secondary-button"
            onClick={onCancel}
            type="button"
          >
            {t("common.cancel")}
          </button>
          <button
            className="primary-button"
            disabled={!value.trim()}
            type="submit"
          >
            {t("dialog.createLibrary.submit")}
          </button>
        </div>
      </form>
    </div>
  );
}
