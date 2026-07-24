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
import { useTheme } from "./theme";
import {
  ACCENT_PRESET_HEX,
  DEFAULT_ACCENT_HEX,
  normalizeAccentHex,
} from "./theme/accent-preferences";

const SHADOW_LEVEL_TICKS = [0, 1, 2, 3] as const;

type SettingsCardProps = { children: ReactNode };

function SettingsCard({ children }: SettingsCardProps): ReactNode {
  return <section className="app-settings-card">{children}</section>;
}

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
      <span className="app-settings-toggle-control">
        <input checked={checked} onChange={onChange} type="checkbox" />
        <span aria-hidden="true" className="app-settings-toggle-track" />
      </span>
    </label>
  );
}

export function GeneralSettingsPage(): ReactNode {
  const { t, preference: localePreference, setLocale } = useLocale();
  return (
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
  );
}

export function AppearanceSettingsPage(): ReactNode {
  const t = useT();
  const {
    preference: themePreference,
    setTheme,
    accentHex,
    setAccentHex,
  } = useTheme();
  const { preferences: shadowPrefs, setLevel: setShadowLevel } = useElevation();
  const [accentDraft, setAccentDraft] = useState(accentHex);

  function selectAccent(hex: string) {
    setAccentHex(hex);
    setAccentDraft(hex);
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
        <input
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
        />
        <button
          className="secondary-button"
          onClick={() => selectAccent(DEFAULT_ACCENT_HEX)}
          type="button"
        >
          {t("settings.accentReset")}
        </button>
      </div>
      <div className="app-settings-card-divider" />
      <div className="app-settings-row-copy">
        <strong>{t("settings.elevationSection")}</strong>
        <span>{t("settings.elevationHint")}</span>
      </div>
      <div className="app-settings-elevation-scale">
        <div className="app-settings-elevation-rail">
          <input
            aria-label={t("settings.elevationSection")}
            aria-valuemax={SHADOW_LEVEL_MAX}
            aria-valuemin={SHADOW_LEVEL_MIN}
            aria-valuenow={shadowPrefs.level}
            aria-valuetext={t("settings.elevationLevelValue", {
              level: shadowPrefs.level,
            })}
            className="app-settings-elevation-slider"
            max={SHADOW_LEVEL_MAX}
            min={SHADOW_LEVEL_MIN}
            onChange={(event) =>
              setShadowLevel(clampShadowLevel(Number(event.target.value)))
            }
            step={1}
            type="range"
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
