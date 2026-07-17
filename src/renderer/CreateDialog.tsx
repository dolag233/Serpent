import { type FormEvent } from "react";
import { Icon } from "./Icons";

export interface CreateDialogProps {
  open: boolean;
  kind: "library" | "folder";
  value: string;
  onValueChange: (val: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  folderName?: string;
}

export function CreateDialog({
  open,
  kind,
  value,
  onValueChange,
  onSubmit,
  onCancel,
  folderName,
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
            {/* REQ-SHELL-009: no decorative English caption in the Chinese UI.
                The folder branch keeps its eyebrow — folder dialogs are owned
                by the REQ-FOLDER-007 track. */}
            {kind === "folder" && (
              <span className="eyebrow">MANAGED FOLDER</span>
            )}
            <h2 id="create-dialog-title">
              {kind === "library" ? "创建资源库" : "新建文件夹"}
            </h2>
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
        <p className="field-help">
          {kind === "library"
            ? "下一步由系统选择本地保存位置。"
            : `将在"${folderName ?? "资源库根目录"}"内创建真实目录。`}
        </p>
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
