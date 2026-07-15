import { type FormEvent } from "react";
import { Icon } from "./Icons";

export interface RenameDialogProps {
  open: boolean;
  kind: "tag" | "collection" | "smart";
  currentName: string;
  onNameChange: (name: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

function organizationNoun(kind: RenameDialogProps["kind"]) {
  return kind === "tag"
    ? "标签"
    : kind === "collection"
      ? "合集"
      : "智能合集";
}

export function RenameDialog({
  open,
  kind,
  currentName,
  onNameChange,
  onSave,
  onCancel,
}: RenameDialogProps) {
  if (!open) return null;

  const noun = organizationNoun(kind);

  return (
    <div className="dialog-backdrop" role="presentation">
      <form
        aria-labelledby="rename-organization-title"
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
            <span className="eyebrow">ORGANIZE LIBRARY</span>
            <h2 id="rename-organization-title">重命名{noun}</h2>
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
        <label className="field-label" htmlFor="rename-organization-name">
          {noun}名称
        </label>
        <input
          autoFocus
          className="text-field"
          id="rename-organization-name"
          onChange={(event) => onNameChange(event.target.value)}
          value={currentName}
        />
        <p className="field-help">
          名称仅影响资源库中的组织方式，不会修改资产文件。
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
            disabled={!currentName.trim()}
            type="submit"
          >
            保存名称
          </button>
        </div>
      </form>
    </div>
  );
}
