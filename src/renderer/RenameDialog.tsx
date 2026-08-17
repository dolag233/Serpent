import { type FormEvent, useEffect, useRef } from "react";
import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";
import { DialogShell } from "./ui/patterns";

export interface RenameDialogProps {
  open: boolean;
  kind: "collection" | "smart" | "asset";
  currentName: string;
  onNameChange: (name: string) => void;
  onSave: () => void;
  onCancel: () => void;
  /**
   * kind "asset" only: the preserved extension (leading dot included, e.g.
   * ".png") shown as static text beside the editable base-name field.
   */
  fileExtension?: string;
  /**
   * kind "asset" only: typed rename failure shown inline. The dialog stays
   * open while this is set so the user can fix the name and retry.
   */
  errorMessage?: string | null;
  /** kind "asset" only: true while a rename request is in flight. */
  submitting?: boolean;
}

export function RenameDialog({
  open,
  kind,
  currentName,
  onNameChange,
  onSave,
  onCancel,
  fileExtension = "",
  errorMessage = null,
  submitting = false,
}: RenameDialogProps) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const isAsset = kind === "asset";

  // Asset rename preselects the current base name so typing replaces it
  // immediately; organization dialogs keep their plain autofocus behavior.
  useEffect(() => {
    if (!open || !isAsset) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [open, isAsset]);

  if (!open) return null;

  const noun =
    kind === "collection"
      ? t("dialog.rename.nounCollection")
      : t("dialog.rename.nounSmartCollection");
  const idPrefix = isAsset ? "rename-asset" : "rename-organization";
  const title = isAsset
    ? t("dialog.rename.fileTitle")
    : t("dialog.rename.title", { noun });
  const fieldLabel = isAsset
    ? t("dialog.rename.fileName")
    : t("dialog.rename.nameField", { noun });
  const submitLabel = isAsset
    ? t("dialog.rename.submitFile")
    : t("dialog.rename.submitName");
  const fieldHelp = isAsset
    ? fileExtension
      ? t("dialog.rename.helpWithExt", { ext: fileExtension })
      : t("dialog.rename.helpFile")
    : t("dialog.rename.helpOrg");

  return (
    <div className="dialog-backdrop" role="presentation">
      <DialogShell
        className="create-dialog"
        dialogId={`${idPrefix}-dialog`}
        headerActions={
          <button
            className="dialog-close"
            onClick={onCancel}
            type="button"
            {...iconActionAttrs(t("common.cancel"))}
          >
            <Icon name="close" size={16} />
          </button>
        }
        style={{ padding: 0 }}
        title={title}
      >
        <form
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            onSave();
          }}
        >
          <label className="field-label" htmlFor={`${idPrefix}-name`}>
            {fieldLabel}
          </label>
          {isAsset ? (
            <div className="rename-file-field">
              <input
                autoFocus
                className="text-field"
                id={`${idPrefix}-name`}
                onChange={(event) => onNameChange(event.target.value)}
                ref={inputRef}
                value={currentName}
              />
              {fileExtension ? (
                <span className="rename-file-extension">{fileExtension}</span>
              ) : null}
            </div>
          ) : (
            <input
              autoFocus
              className="text-field"
              id={`${idPrefix}-name`}
              onChange={(event) => onNameChange(event.target.value)}
              value={currentName}
            />
          )}
          <p className="field-help">{fieldHelp}</p>
          {isAsset && errorMessage ? (
            <div className="inline-error" role="alert">
              <Icon name="warning" size={14} />
              <div>
                <p>{errorMessage}</p>
              </div>
            </div>
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
              disabled={!currentName.trim() || submitting}
              type="submit"
            >
              {submitLabel}
            </button>
          </div>
        </form>
      </DialogShell>
    </div>
  );
}
