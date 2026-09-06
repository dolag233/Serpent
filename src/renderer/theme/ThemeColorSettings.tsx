import { useRef, type ReactNode } from 'react';

import { useT } from '../i18n';
import { SettingsDisclosure } from '../ui/patterns';
import { Button, Slider, TextField } from '../ui/primitives';
import { useTheme } from './ThemeProvider';

const CUSTOM_THEME_EDITOR_FIELDS = [
  { token: '--ui-action-accent', labelKey: 'settings.customThemeAccent', light: '#3b82f6', dark: '#3b82f6' },
  { token: '--ui-content-secondary', labelKey: 'settings.customThemeSecondary', light: '#5a5f5a', dark: '#a9ada9' },
  { token: '--ui-content-primary', labelKey: 'settings.customThemePrimary', light: '#1c1e1c', dark: '#f1f2ef' },
  { token: '--ui-surface-canvas', labelKey: 'settings.customThemeCanvas', light: '#ebeceb', dark: '#252729' },
  { token: '--ui-surface-pane', labelKey: 'settings.customThemePane', light: '#f4f5f3', dark: '#2c2e31' },
  { token: '--ui-surface-raised', labelKey: 'settings.customThemeRaised', light: '#f2f4f0', dark: '#35383b' },
  { token: '--ui-status-danger', labelKey: 'settings.customThemeDanger', light: '#dc2626', dark: '#e76b7a' },
] as const;

export function ThemeColorSettings(): ReactNode {
  const t = useT();
  const {
    customTheme,
    resetCustomTheme,
    resolved,
    setCustomTheme,
  } = useTheme();
  const editStartValues = useRef<
    Partial<Record<(typeof CUSTOM_THEME_EDITOR_FIELDS)[number]['token'], string>>
  >({});

  function setCustomColor(
    token: (typeof CUSTOM_THEME_EDITOR_FIELDS)[number]['token'],
    value: string,
  ) {
    if (!/^#[0-9a-f]{6}$/iu.test(value)) return;
    setCustomTheme({
      ...customTheme,
      [resolved]: {
        ...customTheme[resolved],
        [token]: value,
      },
    });
  }

  return (
    <SettingsDisclosure
      title={t('settings.advancedColors')}
    >
      <div className="app-settings-custom-theme-grid">
        {CUSTOM_THEME_EDITOR_FIELDS.map((field) => {
          const current = customTheme[resolved][field.token] ?? field[resolved];
          return (
            <label className="app-settings-custom-theme-row" key={field.token}>
              <span className="app-settings-custom-theme-label">
                {t(field.labelKey)}
              </span>
              <input
                aria-label={t(field.labelKey)}
                className="app-settings-custom-theme-swatch"
                onChange={(event) => setCustomColor(field.token, event.target.value)}
                onFocus={() => {
                  editStartValues.current[field.token] = current;
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Escape') return;
                  const original = editStartValues.current[field.token];
                  if (original !== undefined) setCustomColor(field.token, original);
                  event.currentTarget.blur();
                }}
                onBlur={() => {
                  delete editStartValues.current[field.token];
                }}
                type="color"
                value={current}
              />
            </label>
          );
        })}
      </div>
      <div className="app-settings-theme-actions">
        <Button
          className="app-settings-theme-reset"
          onClick={resetCustomTheme}
          size="sm"
        >
          {t('settings.customThemeReset')}
        </Button>
      </div>
      <div
        aria-label={t('settings.customThemePreview')}
        className="app-settings-theme-preview"
      >
        <div className="app-settings-theme-preview-heading">
          {t('settings.customThemePreview')}
        </div>
        <div className="theme-preview-inspector-shell">
          <div className="theme-preview-inspector-rail" aria-hidden="true">
            <span className="theme-preview-rail-line is-active" />
            <span className="theme-preview-rail-line" />
          </div>
          <div className="theme-preview-inspector-main">
            <div className="theme-preview-asset-card">
              <div className="theme-preview-asset-placeholder" />
              <div className="theme-preview-asset-caption">
                <strong>{t('settings.themePreviewAssetPlaceholder')}</strong>
                <span>{t('settings.themePreviewAssetMeta')}</span>
              </div>
            </div>
            <div className="theme-preview-inspector-panel">
              <div className="theme-preview-inspector-heading">
                <strong>{t('settings.themePreviewInspector')}</strong>
                <span>{t('settings.themePreviewTextSecondary')}</span>
              </div>
              <div className="theme-preview-inspector-selected">
                {t('settings.themePreviewSelected')}
              </div>
              <div className="theme-preview-inspector-fields">
                <div className="theme-preview-inspector-field">
                  <span className="theme-preview-inspector-field-label">
                    {t('settings.themePreviewDescription')}
                  </span>
                  <span className="theme-preview-inspector-field-value">
                    {t('settings.themePreviewDescriptionValue')}
                  </span>
                </div>
                <div className="theme-preview-inspector-field">
                  <span className="theme-preview-inspector-field-label">
                    {t('settings.themePreviewAuthor')}
                  </span>
                  <span className="theme-preview-inspector-field-value">
                    {t('settings.themePreviewAuthorValue')}
                  </span>
                </div>
                <div className="theme-preview-inspector-field">
                  <span className="theme-preview-inspector-field-label">
                    {t('settings.themePreviewTags')}
                  </span>
                  <span className="theme-preview-inspector-tag">
                    {t('settings.themePreviewTagsValue')}
                  </span>
                </div>
              </div>
              <div className="theme-preview-inspector-actions">
                <Button size="sm" variant="primary">
                  {t('settings.themePreviewPrimary')}
                </Button>
                <Button size="sm" variant="danger">
                  {t('settings.themePreviewDanger')}
                </Button>
              </div>
              <TextField
                aria-label={t('settings.themePreviewInput')}
                label={t('settings.themePreviewInput')}
                onChange={() => undefined}
                readOnly
                value={t('settings.themePreviewInput')}
                wrapperClassName="theme-preview-input"
              />
              <Slider
                aria-label={t('settings.themePreviewSlider')}
                className="theme-preview-slider"
                disabled
                max={100}
                min={0}
                value={60}
              />
            </div>
          </div>
        </div>
      </div>
    </SettingsDisclosure>
  );
}
