import { useRef, useState, type CSSProperties, type ReactNode } from 'react';

import { useT } from '../i18n';
import { Select, Slider } from '../ui/primitives';
import { BackgroundImagePanel } from './BackgroundImageControls';
import {
  BACKGROUND_DISPLAY_MODES,
  isSafeBackgroundImageDataUrl,
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
  fill: 'settings.backgroundModeFill',
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
  const { backgroundPreferences, setBackgroundPreferences } = useTheme();
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

  // Reference the real backdrop token set so the stage previews exactly what
  // the app shell renders (single source of truth in tokens.css).
  const previewStyle = {
    backgroundImage: 'var(--ui-backdrop-image, none)',
    backgroundPosition: 'var(--ui-backdrop-position, center)',
    backgroundRepeat: 'var(--ui-backdrop-repeat, no-repeat)',
    backgroundSize: 'var(--ui-backdrop-size, cover)',
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
        <Slider
          aria-label={t('settings.backgroundOpacity')}
          label={t('settings.backgroundOpacity')}
          max={1}
          min={0}
          onValueChange={(value) => update({ imageOpacity: value })}
          showValue
          step={0.05}
          value={backgroundPreferences.imageOpacity}
          valueText={`${Math.round(backgroundPreferences.imageOpacity * 100)}%`}
        />
      </div>
    </div>
  );
}
