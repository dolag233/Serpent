import type { ReactNode } from "react";

import { Progress } from "./ui/primitives";
import { DialogShell } from "./ui/patterns";

export type BlockingProgressOverlayProps = {
  readonly title: string;
  readonly detail?: string;
  readonly value?: number;
  readonly max?: number;
  readonly indeterminate?: boolean;
  readonly cancelLabel?: string;
  readonly onCancel?: () => void;
  /** Library identity transitions hide the old navigation model completely. */
  readonly solidBackdrop?: boolean;
  readonly kind?: "import" | "library-loading" | "delete" | "export";
};

/**
 * Shared full-window progress surface for long library/asset operations.
 * Import, library open, export, and bulk delete all reuse this chrome.
 */
export function BlockingProgressOverlay({
  title,
  detail,
  value,
  max,
  indeterminate = false,
  cancelLabel,
  onCancel,
  solidBackdrop = false,
  kind = "import",
}: BlockingProgressOverlayProps): ReactNode {
  const determinate = !indeterminate && (max ?? 0) > 0;
  const cancelable = Boolean(onCancel && cancelLabel);

  return (
    <div
      className={
        solidBackdrop
          ? "dialog-backdrop library-loading-backdrop"
          : "dialog-backdrop"
      }
      data-blocking-progress-overlay="true"
      data-import-progress-overlay={kind === "import" ? "true" : undefined}
      data-library-loading-overlay={kind === "library-loading" ? "true" : undefined}
      data-delete-progress-overlay={kind === "delete" ? "true" : undefined}
      data-export-progress-overlay={kind === "export" ? "true" : undefined}
      role="presentation"
    >
      <DialogShell
        className="blocking-progress-dialog"
        contentClassName="blocking-progress-content"
        description={detail}
        dialogId="blocking-progress-dialog"
        footer={
          cancelable ? (
            <button className="secondary-button" onClick={onCancel} type="button">
              {cancelLabel}
            </button>
          ) : undefined
        }
        onRequestClose={cancelable ? onCancel : undefined}
        title={title}
      >
        <Progress
          aria-label={detail ?? title}
          indeterminate={!determinate}
          max={determinate ? max : undefined}
          showValue={determinate}
          value={determinate ? value : undefined}
        />
      </DialogShell>
    </div>
  );
}
