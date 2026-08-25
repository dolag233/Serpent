import { type CSSProperties, type FormEvent, useState } from "react";

import { DEFAULT_IMAGE_SEQUENCE_FPS } from "../shared/image-sequence";
import type {
  ImageSequenceImportCandidate,
  ImageSequenceImportOffer,
} from "../shared/protocol/responses";
import { Icon } from "./Icons";
import { shouldShowApplyToRest } from "./image-sequence-import-dialog";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";
import { DialogShell } from "./ui/patterns";

export interface ImageSequenceImportDialogProps {
  error?: string | null;
  offer: ImageSequenceImportOffer | null;
  sequenceIndex?: number;
  onCancel(): void;
  onConfirm(input: {
    action: "import-sequence" | "import-selected";
    firstFrame: number;
    fps: number;
    lastFrame: number;
    sequenceIndex: number;
    applyToRest: boolean;
  }): void;
  open: boolean;
  submitting?: boolean;
}

function clampFrame(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function ImageSequenceImportDialog(props: ImageSequenceImportDialogProps) {
  const sequenceIndex = Math.min(
    props.sequenceIndex ?? 0,
    Math.max(0, (props.offer?.sequences.length ?? 1) - 1),
  );
  const sequence = props.offer?.sequences[sequenceIndex];
  if (!props.open || !props.offer || !sequence) return null;
  return (
    <ImageSequenceImportDialogForm
      {...props}
      key={`${props.offer.offerId ?? ""}:${sequenceIndex}:${sequence.displayName}:${sequence.firstFrame}:${sequence.lastFrame}`}
      offer={props.offer}
      sequence={sequence}
      sequenceIndex={sequenceIndex}
    />
  );
}

interface ImageSequenceImportDialogFormProps
  extends Omit<ImageSequenceImportDialogProps, "offer" | "open"> {
  offer: ImageSequenceImportOffer;
  sequence: ImageSequenceImportCandidate;
  sequenceIndex: number;
}

function ImageSequenceImportDialogForm({
  error,
  offer,
  onCancel,
  onConfirm,
  open,
  sequence,
  sequenceIndex,
  submitting = false,
}: ImageSequenceImportDialogFormProps & { open: boolean }) {
  const t = useT();
  const [firstFrame, setFirstFrame] = useState(sequence.firstFrame);
  const [lastFrame, setLastFrame] = useState(sequence.lastFrame);
  const [fps, setFps] = useState(offer.defaultFps ?? DEFAULT_IMAGE_SEQUENCE_FPS);
  const [applyToRest, setApplyToRest] = useState(false);

  if (!open || !offer || !sequence) return null;

  const span = Math.max(1, sequence.lastFrame - sequence.firstFrame);
  const firstPct =
    ((firstFrame - sequence.firstFrame) / span) * 100;
  const lastPct = ((lastFrame - sequence.firstFrame) / span) * 100;
  const frameCount = Math.max(0, lastFrame - firstFrame + 1);
  const rangeValid =
    Number.isInteger(firstFrame) &&
    Number.isInteger(lastFrame) &&
    firstFrame >= sequence.firstFrame &&
    lastFrame <= sequence.lastFrame &&
    firstFrame <= lastFrame &&
    frameCount >= 3;
  const fpsValid = Number.isFinite(fps) && fps >= 1 && fps <= 240;
  const valid = rangeValid && fpsValid;
  const showApplyToRest = shouldShowApplyToRest(
    sequenceIndex,
    offer.sequences.length,
  );

  const updateFirst = (raw: number) => {
    const next = clampFrame(raw, sequence.firstFrame, lastFrame);
    setFirstFrame(next);
  };
  const updateLast = (raw: number) => {
    const next = clampFrame(raw, firstFrame, sequence.lastFrame);
    setLastFrame(next);
  };

  return (
    <div className="dialog-backdrop" role="presentation">
      <DialogShell
        className="create-dialog image-sequence-dialog"
        dialogId="image-sequence-import-dialog"
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
        title={t("dialog.imageSequenceImport.title")}
        description={
          <span className="field-help">
            {offer.sequences.length > 1 ? (
              <>
                {t("dialog.imageSequenceImport.progress", {
                  current: sequenceIndex + 1,
                  total: offer.sequences.length,
                })}{" "}
              </>
            ) : null}
            {t("dialog.imageSequenceImport.summary", {
              name: sequence.displayName,
              count: sequence.frameCount,
              width: sequence.width ?? "—",
              height: sequence.height ?? "—",
            })}
          </span>
        }
      >
        <form
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            if (valid && !submitting) {
              onConfirm({
                action: "import-sequence",
                firstFrame,
                fps,
                lastFrame,
                sequenceIndex,
                applyToRest,
              });
            }
          }}
        >
          <div className="image-sequence-dialog-section">
          <label className="field-label" htmlFor="image-sequence-import-first">
            {t("dialog.imageSequenceImport.range")}
          </label>
          <div className="dialog-inline-fields">
            <input
              className="text-field"
              disabled={submitting}
              id="image-sequence-import-first"
              max={sequence.lastFrame}
              min={sequence.firstFrame}
              onChange={(event) =>
                updateFirst(Number(event.currentTarget.value))
              }
              step={1}
              type="number"
              value={firstFrame}
            />
            <span className="field-help" aria-hidden="true">
              ~
            </span>
            <input
              className="text-field"
              disabled={submitting}
              id="image-sequence-import-last"
              max={sequence.lastFrame}
              min={sequence.firstFrame}
              onChange={(event) =>
                updateLast(Number(event.currentTarget.value))
              }
              step={1}
              type="number"
              value={lastFrame}
            />
          </div>
          <div
            aria-hidden="true"
            className="image-sequence-range-track"
            style={
              {
                "--range-start": `${firstPct}%`,
                "--range-end": `${lastPct}%`,
              } as CSSProperties
            }
          >
            <input
              aria-label={t("dialog.imageSequenceImport.rangeStart")}
              className="image-sequence-range-thumb is-start"
              disabled={submitting}
              max={sequence.lastFrame}
              min={sequence.firstFrame}
              onChange={(event) =>
                updateFirst(Number(event.currentTarget.value))
              }
              step={1}
              type="range"
              value={firstFrame}
            />
            <input
              aria-label={t("dialog.imageSequenceImport.rangeEnd")}
              className="image-sequence-range-thumb is-end"
              disabled={submitting}
              max={sequence.lastFrame}
              min={sequence.firstFrame}
              onChange={(event) =>
                updateLast(Number(event.currentTarget.value))
              }
              step={1}
              type="range"
              value={lastFrame}
            />
          </div>
          <p className="field-help image-sequence-range-caption">
            {t("dialog.imageSequenceImport.rangeCaption", {
              first: firstFrame,
              last: lastFrame,
              count: frameCount,
            })}
          </p>
          </div>

          <div className="image-sequence-dialog-section">
          <label className="field-label" htmlFor="image-sequence-import-fps">
            {t("dialog.imageSequenceImport.fps")}
          </label>
          <input
            autoFocus
            className="text-field"
            disabled={submitting}
            id="image-sequence-import-fps"
            max={240}
            min={1}
            onChange={(event) => setFps(Number(event.currentTarget.value))}
            step={1}
            type="number"
            value={fps}
          />
          <p className="field-help">{t("dialog.imageSequenceImport.help")}</p>
          {showApplyToRest ? (
            <label className="dialog-checkbox-row field-help">
              <input
                checked={applyToRest}
                disabled={submitting}
                onChange={(event) => setApplyToRest(event.currentTarget.checked)}
                type="checkbox"
              />
              <span>{t("dialog.imageSequenceImport.applyToRest")}</span>
            </label>
          ) : null}
          </div>

          {error ? <p className="field-error" role="alert">{error}</p> : null}
          <div className="dialog-actions">
          <button
            className="secondary-button"
            disabled={submitting}
            onClick={() =>
              onConfirm({
                action: "import-selected",
                firstFrame: sequence.firstFrame,
                fps,
                lastFrame: sequence.lastFrame,
                sequenceIndex,
                applyToRest,
              })
            }
            type="button"
          >
            {t("dialog.imageSequenceImport.importSelected")}
          </button>
          <button
            className="primary-button"
            disabled={!valid || submitting}
            type="submit"
          >
            {submitting
              ? t("dialog.imageSequenceImport.importing")
              : t("dialog.imageSequenceImport.importSequence", {
                  count: frameCount,
                })}
          </button>
          </div>
        </form>
      </DialogShell>
    </div>
  );
}
