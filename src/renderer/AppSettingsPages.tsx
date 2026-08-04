import { useState, type ReactNode } from "react";

import {
  APP_SETTINGS_CANVAS_BADGE_FIELD_OPTIONS,
  APP_SETTINGS_CANVAS_CAPTION_FIELD_OPTIONS,
  APP_SETTINGS_LOCALE_OPTIONS,
  APP_SETTINGS_THEME_OPTIONS,
} from "./app-settings-sections";
import type { AiUiPreferences } from "./ai-ui-preferences";
import type { CanvasPreferences } from "./canvas-preferences";
import {
  isDiskDeletePromptEnabled,
  setDiskDeletePromptEnabled,
} from "./disk-delete-confirm-preferences";
import { useElevation } from "./ElevationProvider";
import { useInspectorCardFeel } from "./InspectorCardFeelProvider";
import {
  clearImportConflictPreferences,
  hasRememberedImportConflictPreferences,
} from "./import-conflict-preferences";
import { useLocale, useT } from "./i18n";
import {
  SHADOW_LEVEL_MAX,
  SHADOW_LEVEL_MIN,
  clampShadowLevel,
} from "./shadow-preferences";
import { useMenuAcrylic } from "./MenuAcrylicProvider";
import {
  MENU_ACRYLIC_LEVEL_MAX,
  MENU_ACRYLIC_LEVEL_MIN,
  clampMenuAcrylicLevel,
} from "./menu-acrylic-preferences";
import { useTheme } from "./theme";
import { SettingsCard, SettingsDisclosure } from "./ui/patterns";
import { Button, Slider, Switch, TextField } from "./ui/primitives";
import {
  ACCENT_PRESET_HEX,
  DEFAULT_ACCENT_HEX,
  normalizeAccentHex,
} from "./theme/accent-preferences";
import { BackgroundSettings, ThemeProfilePicker } from "./theme/ThemeAppearanceControls";

const SHADOW_LEVEL_TICKS = [0, 1, 2, 3] as const;
const MENU_ACRYLIC_LEVEL_TICKS = [0, 1, 2, 3] as const;
const CUSTOM_THEME_EDITOR_FIELDS = [
  { token: "--ui-surface-canvas", labelKey: "settings.customThemeCanvas", light: "#ebeceb", dark: "#252729" },
  { token: "--ui-surface-pane", labelKey: "settings.customThemePane", light: "#f4f5f3", dark: "#2c2e31" },
  { token: "--ui-surface-raised", labelKey: "settings.customThemeRaised", light: "#f2f4f0", dark: "#35383b" },
  { token: "--ui-content-primary", labelKey: "settings.customThemePrimary", light: "#1c1e1c", dark: "#f1f2ef" },
  { token: "--ui-content-secondary", labelKey: "settings.customThemeSecondary", light: "#5a5f5a", dark: "#a9ada9" },
  { token: "--ui-action-accent", labelKey: "settings.customThemeAccent", light: "#3b82f6", dark: "#3b82f6" },
  { token: "--ui-status-danger", labelKey: "settings.customThemeDanger", light: "#dc2626", dark: "#e76b7a" },
] as const;

type SettingsToggleRowProps = {
  checked: boolean;
  hint: string;
  label: string;
  onChange: () => void;
};

function SettingsToggleRow({
  checked,
  hint,
  label,
  onChange,
}: SettingsToggleRowProps): ReactNode {
  return (
    <label className="app-settings-toggle-row">
      <span className="app-settings-row-copy">
        <strong>{label}</strong>
        <span>{hint}</span>
      </span>
      <Switch
        aria-label={label}
        checked={checked}
        onCheckedChange={onChange}
      />
    </label>
  );
}

export function GeneralSettingsPage({ onOpenAppLog }: { onOpenAppLog?: () => void } = {}): ReactNode {
  const { t, preference: localePreference, setLocale } = useLocale();
  return (
    <>
      <SettingsCard>
        <div className="app-settings-row app-settings-row-stack">
          <div className="app-settings-row-copy">
            <strong>{t("shell.language")}</strong>
            <span>{t("settings.languageHint")}</span>
          </div>
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
        </div>
      </SettingsCard>
      {onOpenAppLog ? (
        <SettingsCard>
          <div className="app-settings-action-row">
            <div className="app-settings-row-copy">
              <strong>{t("settings.diagnosticsTitle")}</strong>
              <span>{t("settings.diagnosticsHint")}</span>
            </div>
            <button className="secondary-button" onClick={onOpenAppLog} type="button">
              {t("settings.viewDiagnostics")}
            </button>
          </div>
        </SettingsCard>
      ) : null}
      <SettingsCard>
        <div className="app-settings-row app-settings-row-stack">
          <div className="app-settings-row-copy">
            <strong>{t("settings.browserExtensionTitle")}</strong>
            <span>{t("settings.browserExtensionIntro")}</span>
          </div>
          <ol className="app-settings-help-list">
            <li>{t("settings.browserExtensionStepBuild")}</li>
            <li>{t("settings.browserExtensionStepLoad")}</li>
            <li>{t("settings.browserExtensionStepUse")}</li>
          </ol>
          <p className="app-settings-help-note">
            {t("settings.browserExtensionNote")}
          </p>
        </div>
      </SettingsCard>
    </>
  );
}

export function AppearanceSettingsPage(): ReactNode {
  const t = useT();
  const {
    preference: themePreference,
    setTheme,
    customTheme,
    resetCustomTheme,
    resolved,
    setCustomTheme,
    accentHex,
    setAccentHex,
  } = useTheme();
  const { preferences: shadowPrefs, setLevel: setShadowLevel } = useElevation();
  const { preferences: menuAcrylicPrefs, setLevel: setMenuAcrylicLevel } =
    useMenuAcrylic();
  const { enabled: inspectorCardFeelEnabled, toggle: toggleInspectorCardFeel } =
    useInspectorCardFeel();
  const [accentDraft, setAccentDraft] = useState(accentHex);

  function selectAccent(hex: string) {
    setAccentHex(hex);
    setAccentDraft(hex);
  }

  function setCustomColor(token: (typeof CUSTOM_THEME_EDITOR_FIELDS)[number]["token"], value: string) {
    const normalized = normalizeAccentHex(value);
    if (!normalized) return;
    setCustomTheme({
      ...customTheme,
      [resolved]: {
        ...customTheme[resolved],
        [token]: normalized,
      },
    });
  }

  return (
    <SettingsCard>
      <div className="app-settings-row app-settings-row-stack">
      <div className="app-settings-row-copy">
        <strong>{t("shell.theme")}</strong>
        <span>{t("settings.themeHint")}</span>
      </div>
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
      </div>
      <div className="app-settings-card-divider" />
      <div className="app-settings-row-copy">
        <strong>{t("settings.themeProfiles")}</strong>
        <span>{t("settings.themeProfilesHint")}</span>
      </div>
      <ThemeProfilePicker />
      <div className="app-settings-card-divider" />
      <SettingsDisclosure
        hint={t("settings.backgroundSectionHint")}
        title={t("settings.backgroundSection")}
      >
        <BackgroundSettings />
      </SettingsDisclosure>
      <div className="app-settings-card-divider" />
      <SettingsDisclosure
        hint={t("settings.customThemeHint")}
        title={t("settings.customTheme")}
      >
        <div className="app-settings-custom-theme-grid">
          {CUSTOM_THEME_EDITOR_FIELDS.map((field) => {
            const current = customTheme[resolved][field.token] ?? field[resolved];
            return (
              <TextField
                aria-label={t(field.labelKey)}
                key={field.token}
                label={t(field.labelKey)}
                onChange={(event) => setCustomColor(field.token, event.target.value)}
                type="color"
                value={current}
              />
            );
          })}
        </div>
        <Button onClick={resetCustomTheme}>{t("settings.customThemeReset")}</Button>
      </SettingsDisclosure>
      <div className="app-settings-card-divider" />
      <div className="app-settings-row-copy">
        <strong>{t("settings.accentColor")}</strong>
        <span>{t("settings.accentHint")}</span>
      </div>
      <div className="app-settings-accent-presets" role="list">
        {ACCENT_PRESET_HEX.map((hex) => (
          <button
            aria-label={hex}
            aria-pressed={accentHex === hex}
            className={`app-settings-accent-swatch${accentHex === hex ? " is-active" : ""}`}
            key={hex}
            onClick={() => selectAccent(hex)}
            style={{ backgroundColor: hex }}
            type="button"
          />
        ))}
      </div>
      <div className="app-settings-accent-custom">
        <TextField
          aria-label={t("settings.accentCustom")}
          className="text-field"
          onBlur={() => {
            const normalized = normalizeAccentHex(accentDraft);
            if (normalized) selectAccent(normalized);
            else setAccentDraft(accentHex);
          }}
          onChange={(event) => setAccentDraft(event.target.value)}
          placeholder="#3b82f6"
          type="text"
          value={accentDraft}
          wrapperClassName="ui-field--inline"
        />
        <Button
          onClick={() => selectAccent(DEFAULT_ACCENT_HEX)}
        >
          {t("settings.accentReset")}
        </Button>
      </div>
      <div className="app-settings-card-divider" />
      <div className="app-settings-row-copy">
        <strong>{t("settings.elevationSection")}</strong>
        <span>{t("settings.elevationHint")}</span>
      </div>
      <div className="app-settings-elevation-scale">
        <div className="app-settings-elevation-rail">
          <Slider
            aria-label={t("settings.elevationSection")}
            className="app-settings-elevation-slider"
            max={SHADOW_LEVEL_MAX}
            min={SHADOW_LEVEL_MIN}
            onValueChange={(value) => setShadowLevel(clampShadowLevel(value))}
            step={1}
            value={shadowPrefs.level}
          />
          <div aria-hidden="true" className="app-settings-elevation-ticks">
            {SHADOW_LEVEL_TICKS.map((tick) => (
              <button
                className={
                  shadowPrefs.level === tick
                    ? "app-settings-elevation-tick is-active"
                    : "app-settings-elevation-tick"
                }
                key={tick}
                onClick={() => setShadowLevel(tick)}
                type="button"
              >
                <span className="app-settings-elevation-tick-mark" />
                <span className="app-settings-elevation-tick-label">
                  {tick}
                </span>
              </button>
            ))}
          </div>
        </div>
        <div aria-hidden="true" className="app-settings-elevation-ends">
          <span>{t("settings.elevationOff")}</span>
          <span>{t("settings.elevationStrong")}</span>
        </div>
      </div>
      <div className="app-settings-card-divider" />
      <div className="app-settings-row-copy">
        <strong>{t("settings.menuAcrylicSection")}</strong>
        <span>{t("settings.menuAcrylicHint")}</span>
      </div>
      <div className="app-settings-elevation-scale">
        <div className="app-settings-elevation-rail">
          <Slider
            aria-label={t("settings.menuAcrylicSection")}
            className="app-settings-elevation-slider"
            max={MENU_ACRYLIC_LEVEL_MAX}
            min={MENU_ACRYLIC_LEVEL_MIN}
            onValueChange={(value) => setMenuAcrylicLevel(clampMenuAcrylicLevel(value))}
            step={1}
            value={menuAcrylicPrefs.level}
          />
          <div aria-hidden="true" className="app-settings-elevation-ticks">
            {MENU_ACRYLIC_LEVEL_TICKS.map((tick) => (
              <button
                className={
                  menuAcrylicPrefs.level === tick
                    ? "app-settings-elevation-tick is-active"
                    : "app-settings-elevation-tick"
                }
                key={tick}
                onClick={() => setMenuAcrylicLevel(tick)}
                type="button"
              >
                <span className="app-settings-elevation-tick-mark" />
                <span className="app-settings-elevation-tick-label">
                  {t(`settings.menuAcrylicLevel${tick}` as const)}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="app-settings-card-divider" />
      <SettingsToggleRow
        checked={inspectorCardFeelEnabled}
        hint={t("settings.inspectorCardFeelHint")}
        label={t("settings.inspectorCardFeel")}
        onChange={toggleInspectorCardFeel}
      />
    </SettingsCard>
  );
}

export type BrowseSettingsPageProps = {
  canvasPrefs: CanvasPreferences;
  onSetViewMode: (mode: CanvasPreferences["viewMode"]) => void;
  onToggleField: (field: keyof CanvasPreferences["fields"]) => void;
};

export function BrowseSettingsPage({
  canvasPrefs,
  onSetViewMode,
  onToggleField,
}: BrowseSettingsPageProps): ReactNode {
  const t = useT();
  return (
    <SettingsCard>
      <div className="app-settings-row app-settings-row-stack">
        <div className="app-settings-row-copy">
          <strong>{t("settings.viewMode")}</strong>
          <span>{t("settings.canvasHint")}</span>
        </div>
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
      </div>
      <div className="app-settings-card-divider" />
      <div className="app-settings-row-copy">
        <strong>{t("settings.cardFields")}</strong>
        <span>{t("settings.cardFieldsHint")}</span>
      </div>
      <div className="app-settings-inline-checks">
        {APP_SETTINGS_CANVAS_CAPTION_FIELD_OPTIONS.map((option) => (
          <label className="app-settings-inline-check" key={option.field}>
            <input
              checked={canvasPrefs.fields[option.field]}
              onChange={() => onToggleField(option.field)}
              type="checkbox"
            />
            <span>{t(option.labelKey)}</span>
          </label>
        ))}
      </div>
      <div className="app-settings-card-divider" />
      <div className="app-settings-row-copy">
        <strong>{t("settings.cardBadges")}</strong>
        <span>{t("settings.cardBadgesHint")}</span>
      </div>
      <div className="app-settings-inline-checks">
        {APP_SETTINGS_CANVAS_BADGE_FIELD_OPTIONS.map((option) => (
          <label className="app-settings-inline-check" key={option.field}>
            <input
              checked={canvasPrefs.fields[option.field]}
              onChange={() => onToggleField(option.field)}
              type="checkbox"
            />
            <span>{t(option.labelKey)}</span>
          </label>
        ))}
      </div>
    </SettingsCard>
  );
}

export type AiSettingsPageProps = {
  aiUiPrefs: AiUiPreferences;
  aiConfigPanel: ReactNode;
  onToggleShowAiBadges: () => void;
};

export function AiSettingsPage({
  aiUiPrefs,
  aiConfigPanel,
  onToggleShowAiBadges,
}: AiSettingsPageProps): ReactNode {
  const t = useT();
  return (
    <SettingsCard>
      {aiConfigPanel}
      <div className="app-settings-card-divider" />
      <SettingsToggleRow
        checked={aiUiPrefs.showAiBadges}
        hint={t("settings.showAiBadgesHint")}
        label={t("settings.showAiBadges")}
        onChange={onToggleShowAiBadges}
      />
    </SettingsCard>
  );
}

export function SafetySettingsPage(): ReactNode {
  const t = useT();
  const [diskDeletePromptEnabled, setDiskDeletePromptEnabledState] = useState(
    () => isDiskDeletePromptEnabled(),
  );
  const [importConflictRemembered, setImportConflictRemembered] = useState(() =>
    hasRememberedImportConflictPreferences(),
  );
  return (
    <SettingsCard>
      <SettingsToggleRow
        checked={diskDeletePromptEnabled}
        hint={t("settings.diskDeleteConfirmHint")}
        label={t("settings.diskDeleteConfirm")}
        onChange={() => {
          const next = !diskDeletePromptEnabled;
          setDiskDeletePromptEnabled(next);
          setDiskDeletePromptEnabledState(next);
        }}
      />
      <div className="app-settings-card-divider" />
      <div className="app-settings-action-row">
        <div className="app-settings-row-copy">
          <strong>{t("settings.importConflictRemember")}</strong>
          <span>
            {importConflictRemembered
              ? t("settings.importConflictRememberActive")
              : t("settings.importConflictRememberEmpty")}
          </span>
        </div>
        <button
          className="secondary-button"
          disabled={!importConflictRemembered}
          onClick={() => {
            clearImportConflictPreferences();
            setImportConflictRemembered(false);
          }}
          type="button"
        >
          {t("settings.importConflictRememberReset")}
        </button>
      </div>
    </SettingsCard>
  );
}
