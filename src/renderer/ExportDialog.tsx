import { useState } from "react";

import { Icon } from "./Icons";

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
  const [exportFormat, setExportFormat] = useState<"folder" | "zip">("folder");
  const [includeLinkedContent, setIncludeLinkedContent] = useState(false);

  if (!open) return null;

  return (
    <div className="dialog-backdrop" role="presentation">
      <div aria-modal="true" className="create-dialog" role="dialog">
        <div className="dialog-heading">
          <div>
            <span className="eyebrow">EXPORT LIBRARY</span>
            <h2>导出资源库</h2>
          </div>
          <button
            aria-label="取消"
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
          将资源库导出为完整文件夹或标准
          ZIP。导出内容包括所有托管资产、数据库、修订记录和回收站文件。
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
            style={{ fontSize: 11, color: "#6c6f6c", marginBottom: 6 }}
          >
            导出格式
          </legend>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              color: "#c7cac7",
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
            文件夹
          </label>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              color: "#c7cac7",
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
            标准 ZIP
            {exportFormat === "zip" && (
              <span style={{ fontSize: 10, color: "#6c6f6c" }}>
                （4&nbsp;GiB / 65534 条目以内）
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
            color: "#c7cac7",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          <input
            checked={includeLinkedContent}
            onChange={(e) => setIncludeLinkedContent(e.target.checked)}
            type="checkbox"
          />
          包含链接文件夹源内容
        </label>
        <div className="dialog-actions">
          <button
            className="secondary-button"
            onClick={onClose}
            type="button"
          >
            取消
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
              ? "选择保存位置并导出 ZIP"
              : "选择目标文件夹并导出"}
          </button>
        </div>
      </div>
    </div>
  );
}
