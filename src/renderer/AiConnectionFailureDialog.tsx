import React from "react";
import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";
import { DialogShell } from "./ui/patterns";

export interface AiConnectionFailureDialogProps {
  open: boolean;
  failedCount: number;
  onRetry: () => void;
  onAbort: () => void;
}

/**
 * Fatal modal after AI connection-class errors exhaust worker retries
 * (Serpent-kdnm). Retry requeues failed AI jobs; Abort cancels the rest.
 */
export function AiConnectionFailureDialog({
  open,
  failedCount,
  onRetry,
  onAbort,
}: AiConnectionFailureDialogProps) {
  const t = useT();
  if (!open) return null;

  return (
    <div className="dialog-backdrop" role="presentation">
      <DialogShell
        className="create-dialog"
        dialogId="ai-connection-failure"
        headerActions={
          <button
            className="dialog-close"
            onClick={onAbort}
            type="button"
            {...iconActionAttrs(t("dialog.aiConnectionFailure.abort"))}
          >
            <Icon name="close" size={16} />
          </button>
        }
        title={t("dialog.aiConnectionFailure.title")}
        description={
          <span className="dialog-body-copy">
            {t("dialog.aiConnectionFailure.body", {
              count: String(Math.max(1, failedCount)),
            })}
          </span>
        }
        style={{ padding: 0 }}
      >
        <div className="dialog-actions">
          <button className="secondary-button" onClick={onAbort} type="button">
            {t("dialog.aiConnectionFailure.abort")}
          </button>
          <button className="primary-button" onClick={onRetry} type="button">
            {t("dialog.aiConnectionFailure.retry")}
          </button>
        </div>
      </DialogShell>
    </div>
  );
}
