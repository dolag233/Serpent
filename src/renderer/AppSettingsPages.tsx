import { useState, type ReactNode } from "react";

import {
  APP_SETTINGS_CANVAS_BADGE_FIELD_OPTIONS,
  APP_SETTINGS_CANVAS_CAPTION_FIELD_OPTIONS,
  APP_SETTINGS_CAPTION_ALIGN_OPTIONS,
  APP_SETTINGS_LOCALE_OPTIONS,
} from "./app-settings-sections";
import type { AiUiPreferences } from "./ai-ui-preferences";
import type { CanvasCaptionAlign, CanvasPreferences } from "./canvas-preferences";
import { useElevation } from "./ElevationProvider";
import { useInspectorCardFeel } from "./InspectorCardFeelProvider";
import {
  loadImportConflictPreferences,
  saveImportConflictPreferences,
} from "./import-conflict-preferences";
import {
  loadTaskCompletionSoundPreferences,
  saveTaskCompletionSoundPreferences,
} from "./task-completion-sound-preferences";
import type {
  ImportConflictPreferences,
  RememberedDuplicateDecision,
  RememberedNameConflictDecision,
} from "./import-conflict-preferences";
import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
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
import { SettingsCard, SettingsDisclosure } from "./ui/patterns";
import { Slider, Switch } from "./ui/primitives";
import {
  BackgroundSettings,
  ThemeModePicker,
  ThemeProfilePicker,
} from "./theme/ThemeAppearanceControls";
import { ThemeColorSettings } from "./theme/ThemeColorSettings";

const SHADOW_LEVEL_TICKS = [0, 1, 2, 3] as const;
const MENU_ACRYLIC_LEVEL_TICKS = [0, 1, 2, 3] as const;

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

export function GeneralSettingsPage({
  onOpenAppLog,
  onOpenExtensionReleases,
}: {
  onOpenAppLog?: () => void;
  onOpenExtensionReleases?: () => void;
} = {}): ReactNode {
  const { t, preference: localePreference, setLocale } = useLocale();
  const [taskCompletionSoundEnabled, setTaskCompletionSoundEnabled] = useState(
    () => loadTaskCompletionSoundPreferences().enabled,
  );

  function toggleTaskCompletionSound(): void {
    const enabled = !taskCompletionSoundEnabled;
    saveTaskCompletionSoundPreferences({ version: 1, enabled });
    setTaskCompletionSoundEnabled(enabled);
  }

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
      <SettingsCard>
        <SettingsToggleRow
          checked={taskCompletionSoundEnabled}
          hint={t("settings.taskCompletionSoundHint")}
          label={t("settings.taskCompletionSound")}
          onChange={toggleTaskCompletionSound}
        />
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
          {onOpenExtensionReleases ? (
            <button
              className="secondary-button app-settings-download-button"
              onClick={onOpenExtensionReleases}
              type="button"
            >
              {t("settings.browserExtensionDownload")}
            </button>
          ) : null}
          <ol className="app-settings-help-list">
            <li>{t("settings.browserExtensionStepDownload")}</li>
            <li>{t("settings.browserExtensionStepExtract")}</li>
            <li>{t("settings.browserExtensionStepLoad")}</li>
            <li>{t("settings.browserExtensionFirefoxStepInstall")}</li>
          </ol>
          <p className="app-settings-help-note">
            {t("settings.browserExtensionNote")}
          </p>
        </div>
      </SettingsCard>
    </>
  );
}

type RememberedImportConflict = {
  key: "nameConflict" | "duplicate";
  label: string;
  value: string;
};

function rememberedImportConflictEntries(
  preferences: ImportConflictPreferences,
  t: ReturnType<typeof useT>,
): RememberedImportConflict[] {
  const entries: RememberedImportConflict[] = [];
  const nameDecisionLabels: Record<RememberedNameConflictDecision, string> = {
    "keep-both": t("dialog.conflicts.autoRename"),
    replace: t("dialog.conflicts.replace"),
    skip: t("dialog.conflicts.skip"),
  };
  const duplicateDecisionLabels: Record<RememberedDuplicateDecision, string> = {
    skip: t("dialog.conflicts.skip"),
    "create-copy": t("dialog.conflicts.importAnyway"),
    merge: t("dialog.conflicts.importAnyway"),
  };
  if (preferences.nameConflict !== null) {
    entries.push({
      key: "nameConflict",
      label: t("settings.importConflictRememberName"),
      value: nameDecisionLabels[preferences.nameConflict],
    });
  }
  if (preferences.duplicate !== null) {
    entries.push({
      key: "duplicate",
      label: t("settings.importConflictRememberDuplicate"),
      value: duplicateDecisionLabels[preferences.duplicate],
    });
  }
  return entries;
}

export function AssetsSettingsPage({
  autoDetectImageSequences = true,
  onToggleAutoDetectImageSequences,
}: {
  autoDetectImageSequences?: boolean;
  onToggleAutoDetectImageSequences?: () => void;
} = {}): ReactNode {
  const t = useT();
  const [importConflictPreferences, setImportConflictPreferences] = useState(() =>
    loadImportConflictPreferences(),
  );
  const rememberedEntries = rememberedImportConflictEntries(
    importConflictPreferences,
    t,
  );

  function clearRememberedPreference(
    key: RememberedImportConflict["key"],
  ): void {
    const next = {
      ...importConflictPreferences,
      [key]: null,
    } as ImportConflictPreferences;
    saveImportConflictPreferences(next);
    setImportConflictPreferences(next);
  }

  return (
    <>
      {onToggleAutoDetectImageSequences ? (
        <SettingsCard>
          <SettingsToggleRow
            checked={autoDetectImageSequences}
            hint={t("settings.imageSequenceAutoDetectHint")}
            label={t("settings.imageSequenceAutoDetect")}
            onChange={onToggleAutoDetectImageSequences}
          />
        </SettingsCard>
      ) : null}
      <SettingsCard>
        <div className="app-settings-row-copy">
          <strong>{t("settings.importConflictRemember")}</strong>
          <span>{t("settings.importConflictRememberHint")}</span>
        </div>
        {rememberedEntries.length > 0 ? (
          <div
            aria-label={t("settings.importConflictRemember")}
            className="app-settings-memory-chips"
            role="list"
          >
            {rememberedEntries.map((entry) => (
              <div className="app-settings-memory-chip" key={entry.key} role="listitem">
                <span className="app-settings-memory-chip-copy">
                  <span className="app-settings-memory-chip-label">{entry.label}</span>
                  <span className="app-settings-memory-chip-value">{entry.value}</span>
                </span>
                <button
                  className="app-settings-memory-chip-remove"
                  onClick={() => clearRememberedPreference(entry.key)}
                  type="button"
                  {...iconActionAttrs(t("settings.importConflictRememberClear"))}
                >
                  <Icon name="close" size={12} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <span className="app-settings-empty-hint">
            {t("settings.importConflictRememberEmpty")}
          </span>
        )}
      </SettingsCard>
    </>
  );
}

export function AppearanceSettingsPage(): ReactNode {
  const t = useT();
  const { preferences: shadowPrefs, setLevel: setShadowLevel } = useElevation();
  const { preferences: menuAcrylicPrefs, setLevel: setMenuAcrylicLevel } =
    useMenuAcrylic();
  const { enabled: inspectorCardFeelEnabled, toggle: toggleInspectorCardFeel } =
    useInspectorCardFeel();

  return (
    <SettingsCard className="app-settings-appearance-card">
      <div className="app-settings-theme-section">
        <div className="app-settings-theme-summary">
          <div className="app-settings-row-copy">
            <strong>{t("shell.theme")}</strong>
            <span>{t("settings.themeHint")}</span>
          </div>
          <ThemeModePicker />
        </div>
        <ThemeProfilePicker />
      </div>
      <div className="app-settings-card-divider" />
      <ThemeColorSettings />
      <div className="app-settings-card-divider" />
      <SettingsDisclosure
        hint={t("settings.backgroundSectionHint")}
        title={t("settings.backgroundSection")}
      >
        <BackgroundSettings />
      </SettingsDisclosure>
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
  onSetCaptionAlign: (align: CanvasCaptionAlign) => void;
  onToggleField: (field: keyof CanvasPreferences["fields"]) => void;
  onToggleHoverAudioPlay: () => void;
  onToggleHoverVideoSound: () => void;
};

export function BrowseSettingsPage({
  canvasPrefs,
  onSetViewMode,
  onSetCaptionAlign,
  onToggleField,
  onToggleHoverAudioPlay,
  onToggleHoverVideoSound,
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
      <div className="app-settings-row app-settings-row-stack">
        <div className="app-settings-row-copy">
          <strong>{t("settings.cardCaptionAlign")}</strong>
          <span>{t("settings.cardCaptionAlignHint")}</span>
        </div>
        <div
          aria-label={t("settings.cardCaptionAlign")}
          className="app-settings-option-group"
          role="radiogroup"
        >
          {APP_SETTINGS_CAPTION_ALIGN_OPTIONS.map((option) => (
            <button
              aria-checked={canvasPrefs.captionAlign === option.value}
              className="app-settings-option"
              key={option.value}
              onClick={() => onSetCaptionAlign(option.value)}
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
      <div className="app-settings-card-divider" />
      <SettingsToggleRow
        checked={canvasPrefs.hoverAudioPlay}
        hint={t("settings.hoverAudioPlayHint")}
        label={t("settings.hoverAudioPlay")}
        onChange={onToggleHoverAudioPlay}
      />
      <SettingsToggleRow
        checked={canvasPrefs.hoverVideoSound}
        hint={t("settings.hoverVideoSoundHint")}
        label={t("settings.hoverVideoSound")}
        onChange={onToggleHoverVideoSound}
      />
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
