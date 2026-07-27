import { type FormEvent } from "react";

import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";

export interface ImageSequenceDialogProps {
  count: number;
  error?: string | null;
  fps: number;
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
  onCancel,
  onFpsChange,
  onSubmit,
  open,
  submitting = false,
}: ImageSequenceDialogProps) {
  const t = useT();
  if (!open) return null;
  const valid = Number.isFinite(fps) && fps >= 1 && fps <= 240;

  return (
    <div className="dialog-backdrop" role="presentation">
      <form
        aria-labelledby="image-sequence-dialog-title"
        aria-modal="true"
        className="create-dialog image-sequence-dialog"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          if (valid && !submitting) onSubmit();
        }}
        role="dialog"
      >
        <div className="dialog-heading">
          <div>
            <h2 id="image-sequence-dialog-title">
              {t("dialog.imageSequence.title")}
            </h2>
            <p className="field-help">
              {t("dialog.imageSequence.summary", { count })}
            </p>
          </div>
          <button
            className="dialog-close"
            disabled={submitting}
            onClick={onCancel}
            type="button"
            {...iconActionAttrs(t("common.cancel"))}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
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
              ? t("dialog.imageSequence.creating")
              : t("dialog.imageSequence.create")}
          </button>
        </div>
      </form>
    </div>
  );
}
