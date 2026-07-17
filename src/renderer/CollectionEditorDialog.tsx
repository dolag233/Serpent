import { Icon } from "./Icons";

export interface CollectionEditorDialogProps {
  open: boolean;
  description: string;
  coverAssetId: string;
  assetOptions: Array<{ assetId: string; displayName: string }>;
  onDescriptionChange: (d: string) => void;
  onCoverAssetChange: (id: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

export function CollectionEditorDialog({
  open,
  description,
  coverAssetId,
  assetOptions,
  onDescriptionChange,
  onCoverAssetChange,
  onSave,
  onCancel,
}: CollectionEditorDialogProps) {
  if (!open) return null;

  return (
    <div className="dialog-backdrop" role="presentation">
      <div
        aria-labelledby="collection-editor-title"
        aria-modal="true"
        className="create-dialog"
        role="dialog"
      >
        <div className="dialog-heading">
          <div>
            <h2 id="collection-editor-title">编辑合集详情</h2>
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
        <label className="field-label" htmlFor="collection-description">
          描述
        </label>
        <textarea
          className="text-field"
          id="collection-description"
          maxLength={10000}
          onChange={(event) => onDescriptionChange(event.target.value)}
          rows={4}
          value={description}
        />
        <label
          className="field-label"
          htmlFor="collection-cover"
          style={{ marginTop: 12 }}
        >
          封面资产
        </label>
        <select
          className="text-field"
          id="collection-cover"
          onChange={(event) => onCoverAssetChange(event.target.value)}
          value={coverAssetId}
        >
          <option value="">无封面</option>
          {coverAssetId &&
            !assetOptions.some((a) => a.assetId === coverAssetId) && (
              <option value={coverAssetId}>
                当前封面（不在本页）
              </option>
            )}
          {assetOptions.map((asset) => (
            <option key={asset.assetId} value={asset.assetId}>
              {asset.displayName}
            </option>
          ))}
        </select>
        <p className="field-help">
          可从当前页面资产中选择封面；合集树支持同级拖拽排序。
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
            onClick={onSave}
            type="button"
          >
            保存详情
          </button>
        </div>
      </div>
    </div>
  );
}
