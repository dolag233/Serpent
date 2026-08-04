import {
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type ReactNode,
} from 'react';

import { Icon } from '../Icons';
import { useT } from '../i18n';
import { Button, Progress } from '../ui/primitives';
import { cx } from '../ui/primitives/cx';
import { formatBackgroundBytes } from './background-image-compression';
import type { BackgroundImageSource } from './background-preferences';

export type BackgroundImagePanelProps = {
  /** Current wallpaper data URL, or null when no image is configured. */
  readonly imageDataUrl: string | null;
  /** Provenance of the stored wallpaper; absent for legacy/empty state. */
  readonly imageSource: BackgroundImageSource | null;
  /** Exact CSS the app shell uses to render the backdrop. */
  readonly previewStyle: CSSProperties;
  /** True while a picked file is being compressed. */
  readonly busy: boolean;
  /** Validation/storage error to surface near the picker. */
  readonly error: string | null;
  /** One-time success notes (auto-compression result, GIF flattening). */
  readonly notices: readonly string[];
  /** Called with a user-picked file; the parent compresses and persists. */
  readonly onSelectFile: (file: File) => void;
  /** Remove the wallpaper, keeping color/mode/opacity untouched. */
  readonly onRemove: () => void;
};

/**
 * The wallpaper picker: a 16:9 stage that shows the real backdrop effect,
 * doubles as a drag-and-drop target, and hosts the replace/remove actions
 * when an image is configured. The hidden file input stays out of the a11y
 * tree; the dropzone button is the focusable trigger.
 */
export function BackgroundImagePanel({
  imageDataUrl,
  imageSource,
  previewStyle,
  busy,
  error,
  notices,
  onSelectFile,
  onRemove,
}: BackgroundImagePanelProps): ReactNode {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function openPicker() {
    if (!busy) inputRef.current?.click();
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (busy) return;
    event.preventDefault();
    setDragging(true);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (busy) return;
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) onSelectFile(file);
  }

  const hasImage = imageDataUrl !== null;

  return (
    <div className="app-settings-background-image">
      <div
        className={cx(
          'app-settings-background-stage',
          hasImage && 'has-image',
          dragging && 'is-dragging',
          busy && 'is-busy',
        )}
        onDragLeave={() => setDragging(false)}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        // Without an image the stage shows the neutral pane color (the CSS
        // default) so the dashed dropzone stays legible; the real backdrop —
        // including the configured color — renders on the image itself.
        style={hasImage ? previewStyle : undefined}
      >
        {busy ? (
          <div className="app-settings-background-busy">
            <Progress
              aria-label={t('settings.backgroundProcessing')}
              indeterminate
              label={t('settings.backgroundProcessing')}
            />
          </div>
        ) : null}
        {hasImage ? (
          <div className="app-settings-background-stage-actions">
            <Button iconName="refresh" onClick={openPicker} size="sm" variant="secondary">
              {t('settings.backgroundReplaceImage')}
            </Button>
            <Button iconName="trash" onClick={onRemove} size="sm" variant="quiet">
              {t('settings.backgroundRemoveImage')}
            </Button>
          </div>
        ) : (
          <button
            className="app-settings-background-dropzone"
            onClick={openPicker}
            type="button"
          >
            <Icon name="upload" size={22} />
            <strong>{t('settings.backgroundDropHint')}</strong>
            <span>{t('settings.backgroundFormatsHint')}</span>
          </button>
        )}
        <input
          accept="image/avif,image/bmp,image/gif,image/jpeg,image/png,image/webp"
          className="app-settings-background-file-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) onSelectFile(file);
          }}
          ref={inputRef}
          tabIndex={-1}
          type="file"
        />
      </div>
      {imageSource ? (
        <p className="app-settings-background-meta">
          {`${imageSource.fileName} · ${imageSource.width}×${imageSource.height}`}
          {imageSource.encodedBytes < imageSource.originalBytes
            ? ` · ${t('settings.backgroundCompressedNote', {
                size: formatBackgroundBytes(imageSource.encodedBytes),
                original: formatBackgroundBytes(imageSource.originalBytes),
              })}`
            : null}
        </p>
      ) : null}
      {notices.length > 0 ? (
        <p className="app-settings-background-notice">
          {notices.map((notice, index) => (
            <span key={index}>{notice}</span>
          ))}
        </p>
      ) : null}
      {error ? (
        <p className="app-settings-background-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
