import { type FormEvent, useEffect, useRef, useState } from "react";
import { Icon } from "./Icons";

export interface FolderRenameTarget {
  folderId: string;
  name: string;
}

export interface FolderRenameDialogProps {
  /** The folder being renamed; the dialog preselects its current name. */
  target: FolderRenameTarget;
  /**
   * Submits the trimmed new name. Resolves to null on success (the parent
   * closes the dialog) or to the inline error message on failure (the dialog
   * stays open and shows it).
   */
  onSubmit: (folderId: string, newName: string) => Promise<string | null>;
  onCancel: () => void;
}

export function FolderRenameDialog({
  target,
  onSubmit,
  onCancel,
}: FolderRenameDialogProps) {
  const [value, setValue] = useState(target.name);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Preselect the current name so typing replaces it immediately (same
  // convention as the asset rename dialog).
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  async function handleSave() {
    if (submitting) return;
    const newName = value.trim();
    if (!newName) return;
    setSubmitting(true);
    setError(null);
    const failure = await onSubmit(target.folderId, newName);
    // null means the parent closed the dialog after a successful rename.
    if (failure === null) return;
    setSubmitting(false);
    setError(failure);
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <form
        aria-labelledby="rename-folder-title"
        aria-modal="true"
        className="create-dialog"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void handleSave();
        }}
        role="dialog"
      >
        <div className="dialog-heading">
          <div>
            <span className="eyebrow">MANAGED FOLDER</span>
            <h2 id="rename-folder-title">重命名文件夹</h2>
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
        <label className="field-label" htmlFor="rename-folder-name">
          文件夹名称
        </label>
        <input
          autoFocus
          className="text-field"
          id="rename-folder-name"
          maxLength={80}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
          ref={inputRef}
          value={value}
        />
        <p className="field-help">重命名会直接修改磁盘上的文件夹名称。</p>
        {error ? (
          <div className="inline-error" role="alert">
            <Icon name="warning" size={14} />
            <div>
              <p>{error}</p>
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
            disabled={!value.trim() || submitting}
            type="submit"
          >
            重命名
          </button>
        </div>
      </form>
    </div>
  );
}
