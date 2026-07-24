import React from "react";
import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";

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
      <div
        aria-describedby="ai-connection-failure-body"
        aria-labelledby="ai-connection-failure-title"
        aria-modal="true"
        className="create-dialog"
        role="dialog"
      >
        <div className="dialog-heading">
          <div>
            <h2 id="ai-connection-failure-title">
              {t("dialog.aiConnectionFailure.title")}
            </h2>
          </div>
          <button
            className="dialog-close"
            onClick={onAbort}
            type="button"
            {...iconActionAttrs(t("dialog.aiConnectionFailure.abort"))}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <p className="dialog-body-copy" id="ai-connection-failure-body">
          {t("dialog.aiConnectionFailure.body", {
            count: String(Math.max(1, failedCount)),
          })}
        </p>
        <div className="dialog-actions">
          <button className="secondary-button" onClick={onAbort} type="button">
            {t("dialog.aiConnectionFailure.abort")}
          </button>
          <button className="primary-button" onClick={onRetry} type="button">
            {t("dialog.aiConnectionFailure.retry")}
          </button>
        </div>
      </div>
    </div>
  );
}
