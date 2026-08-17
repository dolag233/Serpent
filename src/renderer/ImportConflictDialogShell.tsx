import type { ReactNode } from "react";

import { useT } from "./i18n";
import { DialogShell } from "./ui/patterns";

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
  /** Optional rich examples block (e.g. content-duplicate previews). */
  examplesContent?: ReactNode;
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
  examplesContent,
  confirmLabel,
  onCancel,
  onConfirm,
}: ImportConflictDialogShellProps): ReactNode {
  const t = useT();
  const preview =
    examplesContent ??
    (examples.length === 0
      ? null
      : examples.length === 1
        ? examples[0]
        : t("dialog.conflicts.examplesMore", {
            name: examples[0]!,
            count: examples.length - 1,
          }));
  const dialogId = titleId.endsWith("-title")
    ? titleId.slice(0, -"-title".length)
    : titleId;

  return (
    <div className="dialog-backdrop" role="presentation">
      <DialogShell
        className="conflict-dialog conflict-dialog-compact"
        dialogId={dialogId}
        style={{ padding: 0 }}
        title={title}
      >
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
          examplesContent ? (
            <div className="conflict-examples-block">{examplesContent}</div>
          ) : (
            <p className="conflict-examples-line" title={examples.join(", ")}>
              {preview}
            </p>
          )
        ) : null}
        <div className="dialog-actions">
          <button className="secondary-button" onClick={onCancel} type="button">
            {t("dialog.conflicts.cancelImport")}
          </button>
          <button className="primary-button" onClick={onConfirm} type="button">
            {confirmLabel}
          </button>
        </div>
      </DialogShell>
    </div>
  );
}
