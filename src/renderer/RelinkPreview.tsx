import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";
import type { RelinkBatchPreviewResult } from "../shared/library-api";

export interface BatchRelinkPreviewSession {
  preview: RelinkBatchPreviewResult;
  priorRestoredCount: number;
  priorRestoredExamples: Array<{ relativeFilePath: string; matched: boolean }>;
}

export function formatRelinkExamplePath(relativeFilePath: string): string {
  const segments = relativeFilePath.split("/");
  return segments.slice(-2).join("/") || relativeFilePath;
}

export interface RelinkPreviewProps {
  session: BatchRelinkPreviewSession | null;
  keepMetadata: boolean;
  onKeepMetadataChange: (value: boolean) => void;
  onApply: () => void;
  onCancel: () => void;
}

export function RelinkPreview({
  session,
  keepMetadata,
  onKeepMetadataChange,
  onApply,
  onCancel,
}: RelinkPreviewProps) {
  const t = useT();
  if (!session) return null;

  const { preview, priorRestoredCount, priorRestoredExamples } = session;
  const totalCount = preview.totalCount + priorRestoredCount;
  const restoredCount = preview.matchedCount + priorRestoredCount;
  const unmatchedCount = preview.unmatchedCount;
  const examples = [...priorRestoredExamples, ...preview.examples].slice(0, 8);

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
            className="dialog-close"
            onClick={onCancel}
            type="button"
            {...iconActionAttrs(t("common.cancel"))}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="conflict-summary">
          <div>
            <strong>{totalCount}</strong>
            <span>{t("dialog.relinkPreview.totalMissing")}</span>
          </div>
          <div>
            <strong>{restoredCount}</strong>
            <span>{t("dialog.relinkPreview.matched")}</span>
          </div>
          <div>
            <strong>{unmatchedCount}</strong>
            <span>{t("dialog.relinkPreview.notFound")}</span>
          </div>
        </div>
        {examples.length > 0 && (
          <div className="conflict-examples">
            {examples.map((item, index) => (
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
        <label className="conflict-remember-row" htmlFor="relink-keep-metadata">
          <input
            checked={keepMetadata}
            id="relink-keep-metadata"
            onChange={(e) => onKeepMetadataChange(e.target.checked)}
            type="checkbox"
          />
          <span>{t("dialog.relinkPreview.keepMetadata")}</span>
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
