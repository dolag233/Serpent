import { type ReactNode, useMemo, useState } from "react";

import { AppSettingsNavigation } from "./AppSettingsNavigation";
import {
  AiSettingsPage,
  AppearanceSettingsPage,
  BrowseSettingsPage,
  GeneralSettingsPage,
  SafetySettingsPage,
} from "./AppSettingsPages";
import { PluginSettingsPage } from "./PluginSettingsPage";
import {
  PluginSettingsDetailPage,
  usePluginSettingsNavEntries,
} from "./plugin-settings-detail";
import {
  APP_SETTINGS_CATEGORIES,
  type AppSettingsCategoryId,
} from "./app-settings-sections";
import type { AiUiPreferences } from "./ai-ui-preferences";
import type { CanvasPreferences } from "./canvas-preferences";
import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";
import type { SerpentPluginManagerApi } from "../shared/plugin-manager-api";

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
  pluginApi?: SerpentPluginManagerApi;
  libraryId?: string;
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
  pluginApi,
  libraryId,
}: AppSettingsDialogProps): ReactNode {
  const t = useT();
  const [pluginSettingsPluginId, setPluginSettingsPluginId] = useState<string | null>(null);
  const [pluginSettingsRefreshKey, setPluginSettingsRefreshKey] = useState(0);
  const pluginSettingsEntries = usePluginSettingsNavEntries(
    pluginApi,
    libraryId,
    open ? String(pluginSettingsRefreshKey) : null,
  );
  const activePluginEntry = useMemo(
    () => pluginSettingsEntries.find((entry) => entry.pluginId === pluginSettingsPluginId),
    [pluginSettingsEntries, pluginSettingsPluginId],
  );
  const activeCategoryDefinition = APP_SETTINGS_CATEGORIES.find(
    (category) => category.id === activeCategory,
  )!;
  const showingPluginSettings = pluginSettingsPluginId !== null;

  function handleClose() {
    onClose();
  }

  function selectCategory(category: AppSettingsCategoryId) {
    setPluginSettingsPluginId(null);
    onActiveCategoryChange(category);
  }

  function openPluginSettings(pluginId: string) {
    setPluginSettingsPluginId(pluginId);
    setPluginSettingsRefreshKey((value) => value + 1);
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
            activeCategory={showingPluginSettings ? null : activeCategory}
            activePluginSettingsId={pluginSettingsPluginId}
            pluginSettingsEntries={pluginSettingsEntries}
            onSelectCategory={selectCategory}
            onSelectPluginSettings={openPluginSettings}
          />
          <main
            aria-labelledby={showingPluginSettings
              ? "app-settings-plugin-settings-heading"
              : `app-settings-tab-${activeCategory}`}
            className="app-settings-content"
            id={showingPluginSettings
              ? "app-settings-page-plugin-settings"
              : `app-settings-page-${activeCategory}`}
            role="tabpanel"
          >
            <div className="app-settings-page-heading">
              <h3 id={showingPluginSettings ? "app-settings-plugin-settings-heading" : undefined}>
                {showingPluginSettings
                  ? (activePluginEntry?.name ?? t("settings.categoryPluginSettings"))
                  : t(activeCategoryDefinition.labelKey)}
              </h3>
            </div>
            {showingPluginSettings && pluginSettingsPluginId !== null ? (
              <PluginSettingsDetailPage
                libraryId={libraryId}
                pluginApi={pluginApi}
                pluginId={pluginSettingsPluginId}
                pluginName={activePluginEntry?.name ?? pluginSettingsPluginId}
                refreshKey={String(pluginSettingsRefreshKey)}
              />
            ) : null}
            {!showingPluginSettings && activeCategory === "general" ? (
              <GeneralSettingsPage onOpenAppLog={onOpenAppLog} />
            ) : null}
            {!showingPluginSettings && activeCategory === "appearance" ? <AppearanceSettingsPage /> : null}
            {!showingPluginSettings && activeCategory === "browse" ? (
              <BrowseSettingsPage
                canvasPrefs={canvasPrefs}
                onSetViewMode={onSetViewMode}
                onToggleField={onToggleField}
              />
            ) : null}
            {!showingPluginSettings && activeCategory === "ai" ? (
              <AiSettingsPage
                aiUiPrefs={aiUiPrefs}
                aiConfigPanel={aiConfigPanel}
                onToggleShowAiBadges={onToggleShowAiBadges}
              />
            ) : null}
            {!showingPluginSettings && activeCategory === "plugins" ? (
              <PluginSettingsPage
                api={pluginApi}
                libraryId={libraryId}
                onOpenPluginSettings={openPluginSettings}
              />
            ) : null}
            {!showingPluginSettings && activeCategory === "safety" ? <SafetySettingsPage /> : null}
          </main>
        </div>
      </div>
    </div>
  );
}
