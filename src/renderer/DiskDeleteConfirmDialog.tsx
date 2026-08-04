import React, { useState } from "react";
import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";
import { DialogShell } from "./ui/patterns";

export type DiskDeleteBodyKey =
  | "dialog.diskDelete.body"
  | "dialog.diskDelete.libraryBody"
  | "dialog.diskDelete.assetBody"
  | "dialog.diskDelete.selectionBody";

export interface DiskDeleteConfirmDialogProps {
  /** Folder / library / subject display name for name-based bodies. */
  subjectName?: string;
  /** Asset count for `dialog.diskDelete.assetBody`. */
  assetCount?: number;
  /** Override body copy; defaults to folder disk-delete wording. */
  bodyKey?: DiskDeleteBodyKey;
  onCancel: () => void;
  onConfirm: (dontShowAgain: boolean) => void;
}

/**
 * Irreversible "delete from disk" confirmation (clarification #7).
 * Shared by managed/linked-child folder delete, library delete (Serpent-9i8),
 * and managed asset delete (Serpent-9zc).
 */
export function DiskDeleteConfirmDialog({
  subjectName = "",
  assetCount = 0,
  bodyKey = "dialog.diskDelete.body",
  onCancel,
  onConfirm,
}: DiskDeleteConfirmDialogProps) {
  const t = useT();
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const bodyParams: Readonly<Record<string, string | number>> =
    bodyKey === "dialog.diskDelete.assetBody" ||
    bodyKey === "dialog.diskDelete.selectionBody"
      ? { count: assetCount }
      : { name: subjectName };
  return (
    <div className="dialog-backdrop" role="presentation">
      <DialogShell
        className="create-dialog"
        dialogId="disk-delete-confirm-dialog"
        headerActions={
          <button
            className="dialog-close"
            onClick={onCancel}
            type="button"
            {...iconActionAttrs(t("common.cancel"))}
          >
            <Icon name="close" size={16} />
          </button>
        }
        style={{ padding: 0 }}
        title={t("dialog.diskDelete.title")}
      >
        <p className="dialog-body-copy">
          {t(bodyKey, bodyParams)}
        </p>
        <label className="dialog-checkbox-row is-centered field-help">
          <input
            checked={dontShowAgain}
            onChange={(event) => setDontShowAgain(event.target.checked)}
            type="checkbox"
          />
          {t("dialog.diskDelete.dontShowAgain")}
        </label>
        <div className="dialog-actions">
          <button
            className="secondary-button"
            onClick={onCancel}
            type="button"
          >
            {t("common.cancel")}
          </button>
          <button
            className="primary-button"
            onClick={() => onConfirm(dontShowAgain)}
            type="button"
          >
            {t("dialog.diskDelete.submit")}
          </button>
        </div>
      </DialogShell>
    </div>
  );
}
