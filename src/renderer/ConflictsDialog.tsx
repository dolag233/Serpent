import { Icon } from "./Icons";
import type { ImportConflictPlan } from "../shared/protocol/responses";

export interface ConflictsDialogProps {
  conflicts: ImportConflictPlan;
  duplicateDecision: "skip" | "merge" | "create-copy";
  nameDecision: "keep-both" | "replace" | "skip";
  onDuplicateDecisionChange: (
    value: "skip" | "merge" | "create-copy",
  ) => void;
  onNameDecisionChange: (value: "keep-both" | "replace" | "skip") => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConflictsDialog({
  conflicts,
  duplicateDecision,
  nameDecision,
  onDuplicateDecisionChange,
  onNameDecisionChange,
  onCancel,
  onConfirm,
}: ConflictsDialogProps) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <div
        aria-labelledby="conflict-dialog-title"
        aria-modal="true"
        className="conflict-dialog"
        role="dialog"
      >
        <div className="dialog-heading">
          <div>
            <span className="eyebrow">IMPORT REVIEW</span>
            <h2 id="conflict-dialog-title">处理导入冲突</h2>
          </div>
        </div>
        <div className="conflict-summary">
          <div>
            <strong>{conflicts.fileCount}</strong>
            <span>待导入文件</span>
          </div>
          <div>
            <strong>{conflicts.suspectedDuplicateCount}</strong>
            <span>疑似重复</span>
          </div>
          <div>
            <strong>{conflicts.nameConflictCount}</strong>
            <span>同名冲突</span>
          </div>
        </div>
        <label className="decision-field">
          <span>疑似重复</span>
          <select
            autoFocus
            value={duplicateDecision}
            onChange={(event) =>
              onDuplicateDecisionChange(
                event.target.value as typeof duplicateDecision,
              )
            }
          >
            <option value="skip">跳过</option>
            <option value="merge">合并到已有资产</option>
            <option value="create-copy">创建副本</option>
          </select>
        </label>
        <label className="decision-field">
          <span>同名冲突</span>
          <select
            value={nameDecision}
            onChange={(event) =>
              onNameDecisionChange(event.target.value as typeof nameDecision)
            }
          >
            <option value="keep-both">保留两者</option>
            <option value="replace">替换现有资产</option>
            <option value="skip">跳过</option>
          </select>
        </label>
        {conflicts.examples.length > 0 && (
          <div className="conflict-examples">
            {conflicts.examples.map((item, index) => (
              <span key={`${item.displayName}-${index}`}>
                <Icon name="file" size={13} />
                {item.displayName}
              </span>
            ))}
          </div>
        )}
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
            应用并导入
          </button>
        </div>
      </div>
    </div>
  );
}
