import { Icon } from "./Icons";

export interface RestoreDialogProps {
  assetIds: string[];
  folders: Array<{
    folderId: string;
    relativePath: string;
  }>;
  target: "original" | "root" | string;
  conflictStrategy: "keep-both" | "replace" | "skip";
  onTargetChange: (target: "original" | "root" | string) => void;
  onStrategyChange: (strategy: "keep-both" | "replace" | "skip") => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function RestoreDialog({
  assetIds,
  folders,
  target,
  conflictStrategy,
  onTargetChange,
  onStrategyChange,
  onConfirm,
  onCancel,
}: RestoreDialogProps) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <div
        aria-labelledby="restore-dialog-title"
        aria-modal="true"
        className="create-dialog"
        role="dialog"
      >
        <div className="dialog-heading">
          <div>
            <h2 id="restore-dialog-title">
              恢复 {assetIds.length} 项资产
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
        <label className="field-label" htmlFor="restore-target">
          恢复位置
        </label>
        <select
          className="text-field"
          id="restore-target"
          onChange={(event) =>
            onTargetChange(
              event.target.value as "original" | "root" | string,
            )
          }
          value={target}
        >
          <option value="original">
            原位置（原文件夹不存在时使用根目录）
          </option>
          <option value="root">资源库根目录</option>
          {folders.map((folder) => (
            <option key={folder.folderId} value={folder.folderId}>
              {folder.relativePath}
            </option>
          ))}
        </select>
        <label
          className="field-label"
          htmlFor="restore-conflict"
          style={{ marginTop: 12 }}
        >
          同名冲突
        </label>
        <select
          className="text-field"
          id="restore-conflict"
          onChange={(event) =>
            onStrategyChange(
              event.target.value as "keep-both" | "replace" | "skip",
            )
          }
          value={conflictStrategy}
        >
          <option value="keep-both">保留两者（自动编号）</option>
          <option value="replace">用回收站资产替换现有资产</option>
          <option value="skip">跳过冲突资产</option>
        </select>
        {conflictStrategy === "replace" && (
          <p className="field-help">
            替换会删除冲突资产的 Serpent
            记录及其托管文件，恢复资产会保留原有 ID 和元数据。
          </p>
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
            确认恢复
          </button>
        </div>
      </div>
    </div>
  );
}
