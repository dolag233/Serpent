import { Icon } from "./Icons";

export interface UndoMoveDialogProps {
  open: boolean;
  conflictStrategy: "keep-both" | "replace" | "skip";
  onConflictStrategyChange: (
    strategy: "keep-both" | "replace" | "skip",
  ) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function UndoMoveDialog({
  open,
  conflictStrategy,
  onConflictStrategyChange,
  onConfirm,
  onCancel,
}: UndoMoveDialogProps) {
  if (!open) return null;

  return (
    <div className="dialog-backdrop" role="presentation">
      <div
        aria-labelledby="undo-move-dialog-title"
        aria-modal="true"
        className="create-dialog"
        role="dialog"
      >
        <div className="dialog-heading">
          <div>
            <span className="eyebrow">UNDO MOVE CONFLICT</span>
            <h2 id="undo-move-dialog-title">原位置已有新内容</h2>
          </div>
          <button
            aria-label="取消撤销"
            className="dialog-close"
            onClick={onCancel}
            type="button"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <p className="field-help">
          Serpent 没有覆盖原位置。请选择明确的冲突处理方式后再撤销。
        </p>
        <label className="field-label" htmlFor="undo-move-conflict">
          冲突处理
        </label>
        <select
          className="text-field"
          id="undo-move-conflict"
          onChange={(event) =>
            onConflictStrategyChange(
              event.target.value as "keep-both" | "replace" | "skip",
            )
          }
          value={conflictStrategy}
        >
          <option value="keep-both">保留两者（撤回资产自动编号）</option>
          <option value="replace">替换原位置的新内容</option>
          <option value="skip">跳过冲突资产</option>
        </select>
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
            onClick={onConfirm}
            type="button"
          >
            按所选策略撤销
          </button>
        </div>
      </div>
    </div>
  );
}
