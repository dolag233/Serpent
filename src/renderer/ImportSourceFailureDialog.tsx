import { useState, type ReactNode } from "react";

import type { ImportSourceFailurePlan } from "../shared/protocol/responses";
import { shouldShowApplyToRest } from "./image-sequence-import-dialog";
import { useT } from "./i18n";
import { DialogShell } from "./ui/patterns";

export type ImportSourceFailureDialogProps = {
  plan: ImportSourceFailurePlan | null;
  open: boolean;
  submitting?: boolean;
  onCancel(): void;
  onConfirm(input: { applyToRest: boolean }): void;
};

export function ImportSourceFailureDialog({
  plan,
  open,
  submitting = false,
  onCancel,
  onConfirm,
}: ImportSourceFailureDialogProps): ReactNode {
  const t = useT();
  const [applyToRest, setApplyToRest] = useState(false);
  if (!open || !plan) return null;

  const showApplyToRest = shouldShowApplyToRest(0, plan.remainingCount + 1);
  const summary =
    plan.remainingCount > 0
      ? t("dialog.sourceFailure.summary", {
          count: plan.failedCount,
          remaining: plan.remainingCount,
        })
      : t("dialog.sourceFailure.summaryNoneRemaining", {
          count: plan.failedCount,
        });
  const preview =
    plan.examples.length === 0
      ? null
      : plan.examples.length === 1
        ? plan.examples[0]!.displayName
        : t("dialog.conflicts.examplesMore", {
            name: plan.examples[0]!.displayName,
            count: plan.examples.length - 1,
          });

  return (
    <div className="dialog-backdrop" role="presentation">
      <DialogShell
        className="conflict-dialog conflict-dialog-compact"
        dialogId="import-source-failure-dialog"
        style={{ padding: 0 }}
        title={t("dialog.sourceFailure.title")}
      >
        <p className="conflict-summary-line">{summary}</p>
        {showApplyToRest ? (
          <label className="dialog-checkbox-row field-help">
            <input
              checked={applyToRest}
              disabled={submitting}
              onChange={(event) => setApplyToRest(event.currentTarget.checked)}
              type="checkbox"
            />
            <span>{t("dialog.sourceFailure.applyToRest")}</span>
          </label>
        ) : null}
        {preview ? (
          <p className="conflict-examples-line" title={plan.examples.map((item) => item.displayName).join(", ")}>
            {preview}
          </p>
        ) : null}
        <div className="dialog-actions">
          <button
            className="secondary-button"
            disabled={submitting}
            onClick={onCancel}
            type="button"
          >
            {t("dialog.conflicts.cancelImport")}
          </button>
          <button
            className="primary-button"
            disabled={submitting}
            onClick={() => onConfirm({ applyToRest })}
            type="button"
          >
            {submitting
              ? t("dialog.conflicts.continuing")
              : t("dialog.conflicts.confirmSkip")}
          </button>
        </div>
      </DialogShell>
    </div>
  );
}
