import { Icon } from "./Icons";
import type { ImportValidatedResult } from "../shared/library-api";

export interface ImportDialogProps {
  open: boolean;
  validated: ImportValidatedResult | null;
  importing: boolean;
  onClose: () => void;
  onImportCopy: () => void;
  onImportOpenInPlace: () => void;
  onImportZip: () => void;
}

export function ImportDialog({
  open,
  validated,
  importing,
  onClose,
  onImportCopy,
  onImportOpenInPlace,
  onImportZip,
}: ImportDialogProps) {
  if (!open || !validated) return null;

  return (
    <div className="dialog-backdrop" role="presentation">
      <div aria-modal="true" className="create-dialog" role="dialog">
        <div className="dialog-heading">
          <div>
            <h2>导入资源库</h2>
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
          资源库 <strong>{validated.displayName}</strong>{" "}
          验证通过。请选择导入方式：
        </p>
        <div className="dialog-actions">
          <button
            className="secondary-button"
            disabled={importing}
            onClick={onClose}
            type="button"
          >
            取消
          </button>
          <button
            className="secondary-button"
            disabled={importing}
            onClick={onImportOpenInPlace}
            type="button"
          >
            原地打开（不复制）
          </button>
          <button
            className="secondary-button"
            disabled={importing}
            onClick={onImportZip}
            type="button"
          >
            导入 ZIP
          </button>
          <button
            className="primary-button"
            disabled={importing}
            onClick={onImportCopy}
            type="button"
          >
            复制到新位置
          </button>
        </div>
      </div>
    </div>
  );
}
