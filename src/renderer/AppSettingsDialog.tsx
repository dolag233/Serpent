import type { ReactNode } from "react";
import {
  APP_SETTINGS_CANVAS_FIELD_OPTIONS,
  APP_SETTINGS_LOCALE_OPTIONS,
  APP_SETTINGS_THEME_OPTIONS,
} from "./app-settings-sections";
import type { CanvasPreferences } from "./canvas-preferences";
import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useLocale } from "./i18n";
import { useTheme } from "./theme";

export interface AppSettingsDialogProps {
  open: boolean;
  onClose: () => void;
  canvasPrefs: CanvasPreferences;
  onSetViewMode: (mode: CanvasPreferences["viewMode"]) => void;
  onToggleField: (field: keyof CanvasPreferences["fields"]) => void;
}

/**
 * REQ-PREF-001 / Serpent-97l: app-level preferences (theme, language, canvas
 * card fields). Opened from the gear beside the library switcher. Theme and
 * language are no longer in the library dropdown — this dialog is the only
 * settings surface. Esc and backdrop click dismiss; no footer Close button.
 */
export function AppSettingsDialog({
  open,
  onClose,
  canvasPrefs,
  onSetViewMode,
  onToggleField,
}: AppSettingsDialogProps): ReactNode {
  const { t, preference: localePreference, setLocale } = useLocale();
  const { preference: themePreference, setTheme } = useTheme();

  if (!open) return null;

  return (
    <div
      className="dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        aria-modal="true"
        className="create-dialog app-settings-dialog"
        role="dialog"
      >
        <div className="dialog-heading">
          <div>
            <h2>{t("settings.title")}</h2>
          </div>
          <button
            className="dialog-close"
            onClick={onClose}
            type="button"
            {...iconActionAttrs(t("common.close"))}
          >
            <Icon name="close" size={16} />
          </button>
        </div>

        <section className="app-settings-section">
          <div className="micro-label">{t("shell.theme")}</div>
          <p className="app-settings-hint">{t("settings.themeHint")}</p>
          <div
            aria-label={t("shell.theme")}
            className="app-settings-option-group"
            role="radiogroup"
          >
            {APP_SETTINGS_THEME_OPTIONS.map((option) => (
              <button
                aria-checked={themePreference === option.value}
                className="app-settings-option"
                key={option.value}
                onClick={() => setTheme(option.value)}
                role="radio"
                type="button"
              >
                {t(option.labelKey)}
              </button>
            ))}
          </div>
        </section>

        <section className="app-settings-section">
          <div className="micro-label">{t("shell.language")}</div>
          <p className="app-settings-hint">{t("settings.languageHint")}</p>
          <div
            aria-label={t("shell.language")}
            className="app-settings-option-group"
            role="radiogroup"
          >
            {APP_SETTINGS_LOCALE_OPTIONS.map((option) => (
              <button
                aria-checked={localePreference === option.value}
                className="app-settings-option"
                key={option.value}
                onClick={() => setLocale(option.value)}
                role="radio"
                type="button"
              >
                {t(option.labelKey)}
              </button>
            ))}
          </div>
        </section>

        <section className="app-settings-section">
          <div className="micro-label">{t("toolbar.canvasSettings")}</div>
          <p className="app-settings-hint">{t("settings.canvasHint")}</p>
          <div
            aria-label={t("settings.viewMode")}
            className="app-settings-option-group"
            role="radiogroup"
          >
            <button
              aria-checked={canvasPrefs.viewMode === "grid"}
              className="app-settings-option"
              onClick={() => onSetViewMode("grid")}
              role="radio"
              type="button"
            >
              {t("toolbar.gridView")}
            </button>
            <button
              aria-checked={canvasPrefs.viewMode === "masonry"}
              className="app-settings-option"
              onClick={() => onSetViewMode("masonry")}
              role="radio"
              type="button"
            >
              {t("toolbar.masonryView")}
            </button>
          </div>
          <div className="micro-label app-settings-sublabel">
            {t("settings.cardFields")}
          </div>
          <p className="app-settings-hint">{t("settings.cardFieldsHint")}</p>
          <div className="app-settings-check-row-group">
            {APP_SETTINGS_CANVAS_FIELD_OPTIONS.map((option) => (
              <label
                className="ai-config-check-row ai-config-check-row-top"
                key={option.field}
              >
                <input
                  checked={canvasPrefs.fields[option.field]}
                  onChange={() => onToggleField(option.field)}
                  type="checkbox"
                />
                <span className="app-settings-check-copy">
                  <span>{t(option.labelKey)}</span>
                  <span className="app-settings-field-hint">
                    {t(option.descriptionKey)}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
