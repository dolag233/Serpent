import { type FormEvent, useEffect, useRef } from "react";
import { Icon } from "./Icons";

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

function organizationNoun(kind: RenameDialogProps["kind"]) {
  return kind === "collection" ? "合集" : "智能合集";
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

  const noun = organizationNoun(kind);
  const idPrefix = isAsset ? "rename-asset" : "rename-organization";
  const title = isAsset ? "重命名文件" : `重命名${noun}`;
  const fieldLabel = isAsset ? "文件名" : `${noun}名称`;
  const submitLabel = isAsset ? "重命名" : "保存名称";
  const fieldHelp = isAsset
    ? fileExtension
      ? `重命名会直接修改磁盘上的文件名，扩展名 ${fileExtension} 将保留不变。`
      : "重命名会直接修改磁盘上的文件名。"
    : "名称仅影响资源库中的组织方式，不会修改资产文件。";

  return (
    <div className="dialog-backdrop" role="presentation">
      <form
        aria-labelledby={`${idPrefix}-title`}
        aria-modal="true"
        className="create-dialog"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          onSave();
        }}
        role="dialog"
      >
        <div className="dialog-heading">
          <div>
            <h2 id={`${idPrefix}-title`}>{title}</h2>
          </div>
          <button
            aria-label="取消"
            className="dialog-close"
            onClick={onCancel}
            type="button"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
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
            取消
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
    </div>
  );
}
