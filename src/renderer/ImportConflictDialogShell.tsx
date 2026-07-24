import type { ReactNode } from "react";

import { useT } from "./i18n";

export type ImportConflictDialogShellProps = {
  titleId: string;
  title: string;
  summary: ReactNode;
  decisionLabel: string;
  decisionControlId: string;
  decision: ReactNode;
  rememberId: string;
  remember: boolean;
  rememberLabel: string;
  onRememberChange: (value: boolean) => void;
  examples: readonly string[];
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
};

/**
 * Shared compact chrome for name-conflict / content-duplicate import dialogs
 * (Serpent-79c7). Keeps both flows visually identical.
 */
export function ImportConflictDialogShell({
  titleId,
  title,
  summary,
  decisionLabel,
  decisionControlId,
  decision,
  rememberId,
  remember,
  rememberLabel,
  onRememberChange,
  examples,
  confirmLabel,
  onCancel,
  onConfirm,
}: ImportConflictDialogShellProps): ReactNode {
  const t = useT();
  const preview =
    examples.length === 0
      ? null
      : examples.length === 1
        ? examples[0]
        : t("dialog.conflicts.examplesMore", {
            name: examples[0]!,
            count: examples.length - 1,
          });

  return (
    <div className="dialog-backdrop" role="presentation">
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className="conflict-dialog conflict-dialog-compact"
        role="dialog"
      >
        <div className="dialog-heading">
          <h2 id={titleId}>{title}</h2>
        </div>
        <p className="conflict-summary-line">{summary}</p>
        <label className="decision-field" htmlFor={decisionControlId}>
          <span>{decisionLabel}</span>
          {decision}
        </label>
        <label className="conflict-remember-row" htmlFor={rememberId}>
          <input
            checked={remember}
            id={rememberId}
            onChange={(event) => onRememberChange(event.target.checked)}
            type="checkbox"
          />
          <span>{rememberLabel}</span>
        </label>
        {preview ? (
          <p className="conflict-examples-line" title={examples.join(", ")}>
            {preview}
          </p>
        ) : null}
        <div className="dialog-actions">
          <button className="secondary-button" onClick={onCancel} type="button">
            {t("dialog.conflicts.cancelImport")}
          </button>
          <button className="primary-button" onClick={onConfirm} type="button">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
