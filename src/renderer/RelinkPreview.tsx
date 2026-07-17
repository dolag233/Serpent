import { Icon } from "./Icons";
import { useT } from "./i18n";
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
  const t = useT();
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
            <h2 id="batch-relink-dialog-title">
              {t("dialog.relinkPreview.title")}
            </h2>
          </div>
          <button
            aria-label={t("common.cancel")}
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
            <span>{t("dialog.relinkPreview.totalMissing")}</span>
          </div>
          <div>
            <strong>{preview.matchedCount}</strong>
            <span>{t("dialog.relinkPreview.matched")}</span>
          </div>
          <div>
            <strong>{preview.unmatchedCount}</strong>
            <span>{t("dialog.relinkPreview.notFound")}</span>
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
            color: "var(--secondary)",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          <input
            checked={keepMetadata}
            onChange={(e) => onKeepMetadataChange(e.target.checked)}
            type="checkbox"
          />
          {t("dialog.relinkPreview.keepMetadata")}
        </label>
        <div className="dialog-actions">
          <button
            className="secondary-button"
            onClick={onCancel}
            type="button"
          >
            {t("common.cancel")}
          </button>
          <button
            className="primary-button"
            disabled={preview.matchedCount === 0}
            onClick={onApply}
            type="button"
          >
            {t("dialog.relinkPreview.apply")}
          </button>
        </div>
      </div>
    </div>
  );
}
