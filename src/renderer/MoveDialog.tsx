import { Icon } from "./Icons";

export interface MoveDialogProps {
  assetIds: string[];
  folders: Array<{
    folderId: string;
    name: string;
    relativePath: string;
  }>;
  targetFolderId: string | null;
  conflictStrategy: "keep-both" | "replace" | "skip";
  onTargetChange: (folderId: string | null) => void;
  onStrategyChange: (strategy: "keep-both" | "replace" | "skip") => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function MoveDialog({
  assetIds,
  folders,
  targetFolderId,
  conflictStrategy,
  onTargetChange,
  onStrategyChange,
  onConfirm,
  onCancel,
}: MoveDialogProps) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <div
        aria-labelledby="move-dialog-title"
        aria-modal="true"
        className="create-dialog"
        role="dialog"
      >
        <div className="dialog-heading">
          <div>
            <h2 id="move-dialog-title">
              移动 {assetIds.length} 项托管资产
            </h2>
          </div>
          <button
            aria-label="取消移动"
            className="dialog-close"
            onClick={onCancel}
            type="button"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <label className="field-label" htmlFor="move-target">
          目标文件夹
        </label>
        <select
          className="text-field"
          id="move-target"
          onChange={(event) =>
            onTargetChange(event.target.value || null)
          }
          value={targetFolderId ?? ""}
        >
          <option value="">资源库根目录</option>
          {folders.map((folder) => (
            <option key={folder.folderId} value={folder.folderId}>
              {folder.relativePath}
            </option>
          ))}
        </select>
        <label
          className="field-label"
          htmlFor="move-conflict"
          style={{ marginTop: 12 }}
        >
          同名冲突
        </label>
        <select
          className="text-field"
          id="move-conflict"
          onChange={(event) =>
            onStrategyChange(
              event.target.value as MoveDialogProps["conflictStrategy"],
            )
          }
          value={conflictStrategy}
        >
          <option value="keep-both">保留两者（自动编号）</option>
          <option value="replace">替换目标资产</option>
          <option value="skip">跳过冲突资产</option>
        </select>
        <p className="field-help">
          移动不会改变资产 ID、标签、合集、人工元数据、AI
          内容或源链接；完成后可撤销一次。
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
            onClick={onConfirm}
            type="button"
          >
            确认移动
          </button>
        </div>
      </div>
    </div>
  );
}
