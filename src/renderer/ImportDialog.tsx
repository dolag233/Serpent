import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";
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
  const t = useT();
  if (!open || !validated) return null;

  return (
    <div className="dialog-backdrop" role="presentation">
      <div aria-modal="true" className="create-dialog" role="dialog">
        <div className="dialog-heading">
          <div>
            <h2>{t("dialog.importLibrary.title")}</h2>
          </div>
          <button
            className="dialog-close"
            onClick={onClose}
            type="button"
            {...iconActionAttrs(t("common.cancel"))}
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
          {t("dialog.importLibrary.validated", {
            name: validated.displayName,
          })}
        </p>
        <div className="dialog-actions">
          <button
            className="secondary-button"
            disabled={importing}
            onClick={onClose}
            type="button"
          >
            {t("common.cancel")}
          </button>
          <button
            className="secondary-button"
            disabled={importing}
            onClick={onImportOpenInPlace}
            type="button"
          >
            {t("dialog.importLibrary.openInPlace")}
          </button>
          <button
            className="secondary-button"
            disabled={importing}
            onClick={onImportZip}
            type="button"
          >
            {t("dialog.importLibrary.importZip")}
          </button>
          <button
            className="primary-button"
            disabled={importing}
            onClick={onImportCopy}
            type="button"
          >
            {t("dialog.importLibrary.copyToNew")}
          </button>
        </div>
      </div>
    </div>
  );
}
