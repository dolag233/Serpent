import { Icon } from "./Icons";

export interface ConvertLinkedDialogProps {
  folderName: string;
  targetFolderId: string;
  folders: { folderId: string; relativePath: string }[];
  onCancel: () => void;
  onTargetChange: (targetFolderId: string) => void;
  onConfirm: () => void;
}

export function ConvertLinkedDialog({
  folderName,
  targetFolderId,
  folders,
  onCancel,
  onTargetChange,
  onConfirm,
}: ConvertLinkedDialogProps) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <div aria-modal="true" className="create-dialog" role="dialog">
        <div className="dialog-heading">
          <div>
            <h2>{`转换"${folderName}"`}</h2>
          </div>
          <button
            aria-label="取消转换"
            className="dialog-close"
            onClick={onCancel}
            type="button"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <p className="field-help">
          复制过滤后的内容并保留资产信息；外部源目录不会删除或移动。
        </p>
        <select
          className="text-field"
          onChange={(event) => onTargetChange(event.target.value)}
          value={targetFolderId}
        >
          <option value="">资源库根目录</option>
          {folders.map((folder) => (
            <option key={folder.folderId} value={folder.folderId}>
              {folder.relativePath}
            </option>
          ))}
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
            onClick={() => void onConfirm()}
            type="button"
          >
            确认复制并转换
          </button>
        </div>
      </div>
    </div>
  );
}
