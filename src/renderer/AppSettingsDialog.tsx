import type { ReactNode } from "react";
import type { CanvasPreferences } from "./canvas-preferences";
import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useLocale, type LocalePreference } from "./i18n";
import { useTheme, type ThemePreference } from "./theme";

const THEME_OPTIONS: readonly {
  readonly value: ThemePreference;
  readonly labelKey: "shell.themeDark" | "shell.themeLight" | "shell.themeSystem";
}[] = [
  { value: "dark", labelKey: "shell.themeDark" },
  { value: "light", labelKey: "shell.themeLight" },
  { value: "system", labelKey: "shell.themeSystem" },
];

const LOCALE_OPTIONS: readonly {
  readonly value: LocalePreference;
  readonly labelKey: "shell.languageSystem" | "shell.languageZh" | "shell.languageEn";
}[] = [
  { value: "system", labelKey: "shell.languageSystem" },
  { value: "zh-CN", labelKey: "shell.languageZh" },
  { value: "en", labelKey: "shell.languageEn" },
];

const CANVAS_FIELD_OPTIONS: readonly {
  readonly field: keyof CanvasPreferences["fields"];
  readonly labelKey: "toolbar.showFileName" | "toolbar.showFileSize" | "toolbar.showModifiedDate";
}[] = [
  { field: "name", labelKey: "toolbar.showFileName" },
  { field: "size", labelKey: "toolbar.showFileSize" },
  { field: "date", labelKey: "toolbar.showModifiedDate" },
];

export interface AppSettingsDialogProps {
  open: boolean;
  onClose: () => void;
  canvasPrefs: CanvasPreferences;
  onSetViewMode: (mode: CanvasPreferences["viewMode"]) => void;
  onToggleField: (field: keyof CanvasPreferences["fields"]) => void;
}

/**
 * REQ-PREF-001: general settings entry point surfaced in the browse-area
 * workspace toolbar (gear icon next to "more tools"). Theme and language
 * already live in the library-name dropdown (LibrarySwitcher); this dialog
 * is a parallel entry point onto the same `useTheme`/`useLocale` state, not
 * a second source of truth, so both surfaces stay in sync automatically.
 *
 * Canvas display (view mode + field toggles) is included per the backlog's
 * "evaluate other preferences" ask: the state already lives in App.tsx and
 * has an existing toolbar surface, so this is a second entry point onto the
 * same preference, not a new decision. "Confirmation behavior" (also named
 * in the backlog) is intentionally NOT included: it depends on clarification
 * queue item #7 (delete confirmation semantics for managed vs linked
 * assets), which is unresolved — adding a toggle here would invent a product
 * decision that hasn't been made.
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
    <div className="dialog-backdrop" role="presentation">
      <div aria-modal="true" className="create-dialog app-settings-dialog" role="dialog">
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
          <div
            aria-label={t("shell.theme")}
            className="app-settings-option-group"
            role="radiogroup"
          >
            {THEME_OPTIONS.map((option) => (
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
          <div
            aria-label={t("shell.language")}
            className="app-settings-option-group"
            role="radiogroup"
          >
            {LOCALE_OPTIONS.map((option) => (
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
          <div className="app-settings-check-row-group">
            {CANVAS_FIELD_OPTIONS.map((option) => (
              <label className="ai-config-check-row" key={option.field}>
                <input
                  checked={canvasPrefs.fields[option.field]}
                  onChange={() => onToggleField(option.field)}
                  type="checkbox"
                />
                {t(option.labelKey)}
              </label>
            ))}
          </div>
        </section>

        <div className="dialog-actions">
          <button
            className="primary-button"
            onClick={onClose}
            type="button"
          >
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
