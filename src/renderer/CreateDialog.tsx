import { type FormEvent } from "react";
import { Icon } from "./Icons";

export interface CreateDialogProps {
  open: boolean;
  value: string;
  onValueChange: (val: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

/**
 * Library-creation dialog. Folder creation used to share this dialog until
 * REQ-FOLDER-007 moved 新建文件夹/重命名 to inline editing in the directory
 * tree; what remains here is the local-library name prompt only.
 */
export function CreateDialog({
  open,
  value,
  onValueChange,
  onSubmit,
  onCancel,
}: CreateDialogProps) {
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
            <span className="eyebrow">NEW LOCAL LIBRARY</span>
            <h2 id="create-dialog-title">创建资源库</h2>
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
        <label className="field-label" htmlFor="dialog-name">
          名称
        </label>
        <input
          autoFocus
          className="text-field"
          id="dialog-name"
          maxLength={255}
          onChange={(event) => onValueChange(event.target.value)}
          value={value}
        />
        <p className="field-help">下一步由系统选择本地保存位置。</p>
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
            disabled={!value.trim()}
            type="submit"
          >
            创建
          </button>
        </div>
      </form>
    </div>
  );
}
