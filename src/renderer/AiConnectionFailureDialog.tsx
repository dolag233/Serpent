import React from "react";
import { aiConnectionFailureBodyKey } from "./ai-connection-failure";
import { FatalAlertDialog } from "./FatalAlertDialog";
import { useT } from "./i18n";

export interface AiConnectionFailureDialogProps {
  open: boolean;
  failedCount: number;
  /** Dominant connection-class code for this wave; drives cause copy. */
  failureCode?: string | null;
  onRetry: () => void;
  onAbort: () => void;
}

/**
 * Blocking Retry/Abort after AI connection-class errors exhaust worker retries
 * (Serpent-kdnm / Serpent-c7d64e). Same surface as other blocking alerts.
 */
export function AiConnectionFailureDialog({
  open,
  failedCount,
  failureCode = null,
  onRetry,
  onAbort,
}: AiConnectionFailureDialogProps) {
  const t = useT();
  if (!open) return null;

  const bodyKey = aiConnectionFailureBodyKey(failureCode);
  return (
    <FatalAlertDialog
      cancelLabel={t("dialog.aiConnectionFailure.abort")}
      confirmLabel={t("dialog.aiConnectionFailure.retry")}
      message={t(`dialog.aiConnectionFailure.${bodyKey}`, {
        count: String(Math.max(1, failedCount)),
      })}
      title={t("dialog.aiConnectionFailure.title")}
      onCancel={onAbort}
      onConfirm={onRetry}
      onDismiss={onAbort}
    />
  );
}
