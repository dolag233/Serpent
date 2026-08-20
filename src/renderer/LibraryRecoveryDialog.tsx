import { type ReactNode } from "react";

import type { RendererLibrarySummary } from "../shared/protocol/responses";
import { useT } from "./i18n";
import { DialogShell } from "./ui/patterns";

export type LibraryRecoveryDialogProps = {
  open: boolean;
  recovery: NonNullable<RendererLibrarySummary["recovery"]>;
  onClose: () => void;
  onRevealReport: () => void;
};

/**
 * 资源库从备份/抢救恢复后的确认弹窗（替代原常驻 banner，2026-08-20 用户
 * 反馈：banner 类型 UI 破坏界面一体性）。正文复用 library.recovery* 文案。
 */
export function LibraryRecoveryDialog({
  open,
  recovery,
  onClose,
  onRevealReport,
}: LibraryRecoveryDialogProps): ReactNode {
  const t = useT();
  if (!open) return null;

  const message =
    recovery.mode === "backup-1"
      ? t("library.recoveryBackup1")
      : recovery.mode === "backup-2"
        ? t("library.recoveryBackup2")
        : t("library.recoveryRescue");

  return (
    <div
      className="dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <DialogShell
        className="library-recovery-dialog"
        dialogId="library-recovery-dialog"
        onRequestClose={onClose}
        title={t("dialog.libraryRecovery.title")}
      >
        <p>{message}</p>
        {recovery.mode === "rescue" &&
        recovery.recoveredAssetCount !== undefined ? (
          <p className="field-help">
            {t("library.recoveryRescueDetails", {
              count: recovery.recoveredAssetCount,
            })}
          </p>
        ) : null}
        {recovery.reportAvailable ? (
          <p className="field-help">{t("library.recoveryReportAvailable")}</p>
        ) : null}
        <div className="dialog-actions">
          {recovery.reportAvailable ? (
            <button
              className="secondary-button"
              onClick={onRevealReport}
              type="button"
            >
              {t("library.recoveryOpenReport")}
            </button>
          ) : null}
          <button
            className="primary-button"
            data-dialog-default-action="true"
            onClick={onClose}
            type="button"
          >
            {t("common.confirm")}
          </button>
        </div>
      </DialogShell>
    </div>
  );
}
