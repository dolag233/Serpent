import { type ReactNode } from "react";

import { AppSettingsNavigation } from "./AppSettingsNavigation";
import {
  AiSettingsPage,
  AppearanceSettingsPage,
  BrowseSettingsPage,
  GeneralSettingsPage,
  SafetySettingsPage,
} from "./AppSettingsPages";
import {
  APP_SETTINGS_CATEGORIES,
  type AppSettingsCategoryId,
} from "./app-settings-sections";
import type { AiUiPreferences } from "./ai-ui-preferences";
import type { CanvasPreferences } from "./canvas-preferences";
import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";

export interface AppSettingsDialogProps {
  open: boolean;
  activeCategory: AppSettingsCategoryId;
  onClose: () => void;
  onActiveCategoryChange: (category: AppSettingsCategoryId) => void;
  canvasPrefs: CanvasPreferences;
  onSetViewMode: (mode: CanvasPreferences["viewMode"]) => void;
  onToggleField: (field: keyof CanvasPreferences["fields"]) => void;
  aiUiPrefs: AiUiPreferences;
  aiConfigPanel: ReactNode;
  onToggleShowAiBadges: () => void;
  onOpenAppLog?: () => void;
}

/**
 * Consolidated application preferences. The category rail deliberately keeps
 * stable settings discoverable without turning direct-manipulation workspace
 * state (panel widths, tree expansion) into another configuration screen.
 */
export function AppSettingsDialog({
  open,
  activeCategory,
  onClose,
  onActiveCategoryChange,
  canvasPrefs,
  onSetViewMode,
  onToggleField,
  aiUiPrefs,
  aiConfigPanel,
  onToggleShowAiBadges,
  onOpenAppLog,
}: AppSettingsDialogProps): ReactNode {
  const t = useT();
  const activeCategoryDefinition = APP_SETTINGS_CATEGORIES.find(
    (category) => category.id === activeCategory,
  )!;

  function handleClose() {
    onClose();
  }

  if (!open) return null;

  return (
    <div
      className="dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) handleClose();
      }}
      role="presentation"
    >
      <div
        aria-labelledby="app-settings-dialog-title"
        aria-modal="true"
        className="create-dialog app-settings-dialog"
        role="dialog"
      >
        <div className="dialog-heading app-settings-heading">
          <h2 id="app-settings-dialog-title">{t("settings.title")}</h2>
          <button
            className="dialog-close"
            onClick={handleClose}
            type="button"
            {...iconActionAttrs(t("common.close"))}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="app-settings-frame">
          <AppSettingsNavigation
            activeCategory={activeCategory}
            onSelect={onActiveCategoryChange}
          />
          <main
            aria-labelledby={`app-settings-tab-${activeCategory}`}
            className="app-settings-content"
            id={`app-settings-page-${activeCategory}`}
            role="tabpanel"
          >
            <div className="app-settings-page-heading">
              <h3>{t(activeCategoryDefinition.labelKey)}</h3>
            </div>
            {activeCategory === "general" ? <GeneralSettingsPage onOpenAppLog={onOpenAppLog} /> : null}
            {activeCategory === "appearance" ? <AppearanceSettingsPage /> : null}
            {activeCategory === "browse" ? (
              <BrowseSettingsPage
                canvasPrefs={canvasPrefs}
                onSetViewMode={onSetViewMode}
                onToggleField={onToggleField}
              />
            ) : null}
            {activeCategory === "ai" ? (
              <AiSettingsPage
                aiUiPrefs={aiUiPrefs}
                aiConfigPanel={aiConfigPanel}
                onToggleShowAiBadges={onToggleShowAiBadges}
              />
            ) : null}
            {activeCategory === "safety" ? <SafetySettingsPage /> : null}
          </main>
        </div>
      </div>
    </div>
  );
}
