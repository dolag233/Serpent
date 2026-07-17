import { useState } from "react";

import { Icon } from "./Icons";
import { useT } from "./i18n";

export interface ExportDialogProps {
  open: boolean;
  exporting: boolean;
  onClose: () => void;
  onExportFolder: (includeLinkedContent: boolean) => void;
  onExportZip: (includeLinkedContent: boolean) => void;
}

export function ExportDialog({
  open,
  exporting,
  onClose,
  onExportFolder,
  onExportZip,
}: ExportDialogProps) {
  const t = useT();
  const [exportFormat, setExportFormat] = useState<"folder" | "zip">("folder");
  const [includeLinkedContent, setIncludeLinkedContent] = useState(false);

  if (!open) return null;

  return (
    <div className="dialog-backdrop" role="presentation">
      <div aria-modal="true" className="create-dialog" role="dialog">
        <div className="dialog-heading">
          <div>
            <h2>{t("toolbar.exportLibrary")}</h2>
          </div>
          <button
            aria-label={t("common.cancel")}
            className="dialog-close"
            onClick={onClose}
            type="button"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <p
          style={{
            color: "var(--secondary)",
            fontSize: 12,
            lineHeight: 1.6,
          }}
        >
          {t("dialog.export.help")}
        </p>
        <fieldset
          style={{
            border: "none",
            padding: 0,
            marginTop: 14,
            display: "flex",
            gap: 16,
          }}
        >
          <legend
            style={{ fontSize: 11, color: "var(--tertiary)", marginBottom: 6 }}
          >
            {t("dialog.export.format")}
          </legend>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              color: "var(--text)",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            <input
              checked={exportFormat === "folder"}
              onChange={() => setExportFormat("folder")}
              type="radio"
              name="export-format"
            />
            {t("dialog.export.formatFolder")}
          </label>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              color: "var(--text)",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            <input
              checked={exportFormat === "zip"}
              onChange={() => setExportFormat("zip")}
              type="radio"
              name="export-format"
            />
            {t("dialog.export.formatZip")}
            {exportFormat === "zip" && (
              <span style={{ fontSize: 10, color: "var(--tertiary)" }}>
                {t("dialog.export.zipLimitHint")}
              </span>
            )}
          </label>
        </fieldset>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 10,
            color: "var(--text)",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          <input
            checked={includeLinkedContent}
            onChange={(e) => setIncludeLinkedContent(e.target.checked)}
            type="checkbox"
          />
          {t("dialog.export.includeLinked")}
        </label>
        <div className="dialog-actions">
          <button
            className="secondary-button"
            onClick={onClose}
            type="button"
          >
            {t("common.cancel")}
          </button>
          <button
            className="primary-button"
            disabled={exporting}
            onClick={() => {
              if (exportFormat === "zip") {
                onExportZip(includeLinkedContent);
              } else {
                onExportFolder(includeLinkedContent);
              }
            }}
            type="button"
          >
            {exportFormat === "zip"
              ? t("dialog.export.zip")
              : t("dialog.export.folder")}
          </button>
        </div>
      </div>
    </div>
  );
}
