import { Icon } from "./Icons";
import type { RelinkBatchPreviewResult } from "../shared/library-api";

export interface RelinkPreviewProps {
  preview: RelinkBatchPreviewResult | null;
  keepMetadata: boolean;
  onKeepMetadataChange: (value: boolean) => void;
  onApply: () => void;
  onCancel: () => void;
}

export function RelinkPreview({
  preview,
  keepMetadata,
  onKeepMetadataChange,
  onApply,
  onCancel,
}: RelinkPreviewProps) {
  if (!preview) return null;

  return (
    <div className="dialog-backdrop" role="presentation">
      <div
        aria-labelledby="batch-relink-dialog-title"
        aria-modal="true"
        className="conflict-dialog"
        role="dialog"
      >
        <div className="dialog-heading">
          <div>
            <h2 id="batch-relink-dialog-title">批量重新定位预览</h2>
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
        <div
          className="conflict-summary"
          style={{ gridTemplateColumns: "repeat(3, 1fr)" }}
        >
          <div>
            <strong>{preview.totalCount}</strong>
            <span>总计丢失</span>
          </div>
          <div>
            <strong>{preview.matchedCount}</strong>
            <span>新位置匹配</span>
          </div>
          <div>
            <strong>{preview.unmatchedCount}</strong>
            <span>未找到</span>
          </div>
        </div>
        {preview.examples.length > 0 && (
          <div className="conflict-examples">
            {preview.examples.map((item, index) => (
              <span
                key={`${item.relativeFilePath}-${index}`}
                style={{
                  color: item.matched ? "var(--accent)" : "var(--warning)",
                }}
              >
                <Icon name={item.matched ? "file" : "warning"} size={13} />
                {item.relativeFilePath}
              </span>
            ))}
          </div>
        )}
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 14,
            color: "#c7cac7",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          <input
            checked={keepMetadata}
            onChange={(e) => onKeepMetadataChange(e.target.checked)}
            type="checkbox"
          />
          沿用原资产信息（保留标签、描述、评分、合集等人工元数据）
        </label>
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
            disabled={preview.matchedCount === 0}
            onClick={onApply}
            type="button"
          >
            应用批量重新定位
          </button>
        </div>
      </div>
    </div>
  );
}
