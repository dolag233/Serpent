import { type FormEvent } from "react";

import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";
import { DialogShell } from "./ui/patterns";

export interface ImageSequenceDialogProps {
  count: number;
  error?: string | null;
  fps: number;
  mode?: "create" | "update";
  onCancel(): void;
  onFpsChange(fps: number): void;
  onSubmit(): void;
  open: boolean;
  submitting?: boolean;
}

export function ImageSequenceDialog({
  count,
  error,
  fps,
  mode = "create",
  onCancel,
  onFpsChange,
  onSubmit,
  open,
  submitting = false,
}: ImageSequenceDialogProps) {
  const t = useT();
  if (!open) return null;
  const valid = Number.isFinite(fps) && fps >= 1 && fps <= 240;
  const isUpdate = mode === "update";

  return (
    <div className="dialog-backdrop" role="presentation">
      <DialogShell
        className="create-dialog image-sequence-dialog"
        dialogId="image-sequence-dialog"
        headerActions={
          <button
            className="dialog-close"
            disabled={submitting}
            onClick={onCancel}
            type="button"
            {...iconActionAttrs(t("common.cancel"))}
          >
            <Icon name="close" size={16} />
          </button>
        }
        style={{ padding: 0 }}
        title={t(
          isUpdate
            ? "dialog.imageSequence.updateTitle"
            : "dialog.imageSequence.title",
        )}
        description={
          <span className="field-help">
            {t(
              isUpdate
                ? "dialog.imageSequence.updateSummary"
                : "dialog.imageSequence.summary",
              { count },
            )}
          </span>
        }
      >
        <form
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            if (valid && !submitting) onSubmit();
          }}
        >
          <label className="field-label" htmlFor="image-sequence-fps">
            {t("dialog.imageSequence.fps")}
          </label>
          <input
            autoFocus
            className="text-field"
            disabled={submitting}
            id="image-sequence-fps"
            max={240}
            min={1}
            onChange={(event) => onFpsChange(Number(event.currentTarget.value))}
            step={1}
            type="number"
            value={fps}
          />
          <p className="field-help">{t("dialog.imageSequence.help")}</p>
          {error ? <p className="field-error" role="alert">{error}</p> : null}
          <div className="dialog-actions">
            <button
              className="secondary-button"
              disabled={submitting}
              onClick={onCancel}
              type="button"
            >
              {t("common.cancel")}
            </button>
            <button
              className="primary-button"
              disabled={!valid || submitting}
              type="submit"
            >
              {submitting
                ? t(
                    isUpdate
                      ? "dialog.imageSequence.updating"
                      : "dialog.imageSequence.creating",
                  )
                : t(
                    isUpdate
                      ? "dialog.imageSequence.update"
                      : "dialog.imageSequence.create",
                  )}
            </button>
          </div>
        </form>
      </DialogShell>
    </div>
  );
}
