import { useRef, useState, type CSSProperties, type ReactNode } from 'react';

import { useT } from '../i18n';
import { Button, Select, Slider, TextField } from '../ui/primitives';
import { BackgroundImagePanel } from './BackgroundImageControls';
import {
  BACKGROUND_DISPLAY_MODES,
  isSafeBackgroundImageDataUrl,
  normalizeBackgroundColor,
  type BackgroundDisplayMode,
} from './background-preferences';
import { compressBackgroundImage, formatBackgroundBytes } from './background-image-compression';
import { useTheme } from './ThemeProvider';
import {
  THEME_PROFILE_IDS,
  THEME_PROFILE_PRESETS,
  type ThemeProfileId,
} from './theme-profiles';

const PROFILE_LABELS = {
  'vscode-dark': 'settings.themeProfileVscodeDark',
  'serpent-dark': 'settings.themeProfileSerpentDark',
  'serpent-light': 'settings.themeProfileSerpentLight',
  'soft-light': 'settings.themeProfileSoftLight',
} as const;

const BACKGROUND_MODE_LABELS = {
  cover: 'settings.backgroundModeCover',
  tile: 'settings.backgroundModeTile',
} as const;

function asPreviewStyle(profile: ThemeProfileId): CSSProperties {
  const tokens = THEME_PROFILE_PRESETS[profile].tokens;
  return {
    '--theme-preview-canvas': tokens['--ui-surface-canvas'],
    '--theme-preview-pane': tokens['--ui-surface-pane'],
    '--theme-preview-raised': tokens['--ui-surface-raised'],
    '--theme-preview-accent': tokens['--ui-action-accent'],
    '--theme-preview-text': tokens['--ui-content-primary'],
  } as CSSProperties;
}

function colorInputValue(value: string): string {
  if (/^#[0-9a-f]{6}$/iu.test(value)) return value;
  if (/^#[0-9a-f]{8}$/iu.test(value)) return value.slice(0, 7);
  if (/^#[0-9a-f]{3,4}$/iu.test(value)) {
    const digits = value.slice(1, 4);
    return `#${digits.split('').map((digit) => `${digit}${digit}`).join('')}`;
  }
  return '#000000';
}

export function ThemeProfilePicker(): ReactNode {
  const t = useT();
  const { themeProfile, setThemeProfile } = useTheme();
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = Math.max(0, THEME_PROFILE_IDS.indexOf(themeProfile.preset));

  function moveSelection(index: number) {
    const nextIndex = (index + THEME_PROFILE_IDS.length) % THEME_PROFILE_IDS.length;
    setThemeProfile(THEME_PROFILE_IDS[nextIndex]!);
    requestAnimationFrame(() => buttonRefs.current[nextIndex]?.focus());
  }

  return (
    <div
      aria-label={t('settings.themeProfiles')}
      className="app-settings-theme-profiles"
      role="radiogroup"
    >
      {THEME_PROFILE_IDS.map((profile) => {
        const selected = themeProfile.preset === profile;
        return (
          <button
            aria-checked={selected}
            className={`app-settings-theme-profile${selected ? ' is-active' : ''}`}
            key={profile}
            onClick={() => setThemeProfile(profile)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                event.preventDefault();
                moveSelection(THEME_PROFILE_IDS.indexOf(profile) + 1);
              } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                event.preventDefault();
                moveSelection(THEME_PROFILE_IDS.indexOf(profile) - 1);
              } else if (event.key === 'Home') {
                event.preventDefault();
                moveSelection(0);
              } else if (event.key === 'End') {
                event.preventDefault();
                moveSelection(THEME_PROFILE_IDS.length - 1);
              }
            }}
            role="radio"
            style={asPreviewStyle(profile)}
            tabIndex={THEME_PROFILE_IDS.indexOf(profile) === selectedIndex ? 0 : -1}
            type="button"
            ref={(element) => {
              buttonRefs.current[THEME_PROFILE_IDS.indexOf(profile)] = element;
            }}
          >
            <span aria-hidden="true" className="app-settings-theme-profile-preview">
              <span className="app-settings-theme-profile-preview-sidebar" />
              <span className="app-settings-theme-profile-preview-content">
                <span className="app-settings-theme-profile-preview-line is-long" />
                <span className="app-settings-theme-profile-preview-line" />
                <span className="app-settings-theme-profile-preview-card" />
              </span>
            </span>
            <span className="app-settings-theme-profile-label">
              {t(PROFILE_LABELS[profile])}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function BackgroundSettings(): ReactNode {
  const t = useT();
  const { backgroundPreferences, setBackgroundPreferences, resetBackgroundPreferences } = useTheme();
  const [error, setError] = useState<string | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  function update(next: Partial<typeof backgroundPreferences>) {
    setError(null);
    const saved = setBackgroundPreferences({ ...backgroundPreferences, ...next });
    if (!saved) setError(t('settings.backgroundSaveError'));
  }

  /**
   * Any raster file is accepted; oversized payloads are re-encoded in the
   * browser (downscale + WebP/JPEG ladder) instead of rejecting the file.
   */
  async function handleSelectFile(file: File) {
    setError(null);
    setNotices([]);
    if (!file.type.startsWith('image/')) {
      setError(t('settings.backgroundImageUnsupported'));
      return;
    }
    setBusy(true);
    try {
      const result = await compressBackgroundImage(file);
      if (!isSafeBackgroundImageDataUrl(result.dataUrl)) {
        setError(t('settings.backgroundImageUnsupported'));
        return;
      }
      const saved = setBackgroundPreferences({
        ...backgroundPreferences,
        imageDataUrl: result.dataUrl,
        imageSource: {
          fileName: file.name,
          width: result.width,
          height: result.height,
          originalBytes: result.originalBytes,
          encodedBytes: result.encodedBytes,
        },
      });
      if (!saved) {
        setError(t('settings.backgroundSaveError'));
        return;
      }
      if (result.compressed) {
        const notes = [
          t('settings.backgroundCompressedNote', {
            size: formatBackgroundBytes(result.encodedBytes),
            original: formatBackgroundBytes(result.originalBytes),
          }),
        ];
        if (result.animationLost) notes.push(t('settings.backgroundAnimatedNote'));
        setNotices(notes);
      }
    } catch {
      setError(t('settings.backgroundImageUnsupported'));
    } finally {
      setBusy(false);
    }
  }

  const previewStyle = {
    backgroundColor: backgroundPreferences.color,
    backgroundImage: backgroundPreferences.imageDataUrl
      ? `linear-gradient(color-mix(in srgb, var(--ui-surface-canvas) calc(var(--ui-background-overlay-opacity) * 100%), transparent), color-mix(in srgb, var(--ui-surface-canvas) calc(var(--ui-background-overlay-opacity) * 100%), transparent)), url(${backgroundPreferences.imageDataUrl})`
      : undefined,
    backgroundPosition: 'center',
    backgroundRepeat: backgroundPreferences.mode === 'tile' ? 'repeat' : 'no-repeat',
    backgroundSize: backgroundPreferences.mode === 'tile' ? 'auto' : backgroundPreferences.mode,
  } satisfies CSSProperties;

  return (
    <div className="app-settings-background-settings">
      <BackgroundImagePanel
        busy={busy}
        error={error}
        imageDataUrl={backgroundPreferences.imageDataUrl}
        imageSource={backgroundPreferences.imageSource}
        notices={notices}
        onRemove={() => update({ imageDataUrl: null, imageSource: null })}
        onSelectFile={(file) => void handleSelectFile(file)}
        previewStyle={previewStyle}
      />
      <div className="app-settings-background-row">
        <TextField
          aria-label={t('settings.backgroundColor')}
          label={t('settings.backgroundColor')}
          onChange={(event) => {
            const color = normalizeBackgroundColor(event.target.value);
            if (color) update({ color });
          }}
          type="color"
          value={colorInputValue(backgroundPreferences.color)}
        />
        <Select
          aria-label={t('settings.backgroundMode')}
          label={t('settings.backgroundMode')}
          onValueChange={(value) => update({ mode: value as BackgroundDisplayMode })}
          options={BACKGROUND_DISPLAY_MODES.map((mode) => ({
            value: mode,
            label: t(BACKGROUND_MODE_LABELS[mode]),
          }))}
          value={backgroundPreferences.mode}
        />
      </div>
      <div className="app-settings-background-opacity">
        <div className="app-settings-row-copy">
          <strong>{t('settings.backgroundOverlay')}</strong>
          <span>{t('settings.backgroundOverlayHint')}</span>
        </div>
        <Slider
          aria-label={t('settings.backgroundOverlay')}
          max={1}
          min={0}
          onValueChange={(value) => update({ overlayOpacity: value })}
          showValue
          step={0.05}
          value={backgroundPreferences.overlayOpacity}
          valueText={`${Math.round(backgroundPreferences.overlayOpacity * 100)}%`}
        />
      </div>
      <Button onClick={() => {
        resetBackgroundPreferences();
        setError(null);
        setNotices([]);
      }} variant="quiet">
        {t('settings.backgroundReset')}
      </Button>
      <p className="app-settings-help-note">{t('settings.backgroundStorageHint')}</p>
    </div>
  );
}
