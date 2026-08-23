import { type ReactNode, useMemo, useState } from "react";

import { AppSettingsNavigation } from "./AppSettingsNavigation";
import {
  AiSettingsPage,
  AssetsSettingsPage,
  AppearanceSettingsPage,
  BrowseSettingsPage,
  GeneralSettingsPage,
} from "./AppSettingsPages";
import { McpSettingsPage } from "./McpSettingsPage";
import { PluginSettingsPage } from "./PluginSettingsPage";
import { SyncSettingsPage, type SyncServerSettingsCallbacks } from "./SyncSettingsPage";
import {
  PluginSettingsDetailPage,
  usePluginSettingsNavEntries,
} from "./plugin-settings-detail";
import {
  APP_SETTINGS_CATEGORIES,
  type AppSettingsCategoryId,
} from "./app-settings-sections";
import type { AiUiPreferences } from "./ai-ui-preferences";
import type { CanvasPreferences, CanvasCaptionAlign } from "./canvas-preferences";
import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";
import type { SerpentPluginManagerApi } from "../shared/plugin-manager-api";
import type { SerpentMcpSettingsApi } from "../shared/mcp";
import { DialogShell } from "./ui/patterns";

export interface AppSettingsDialogProps {
  open: boolean;
  activeCategory: AppSettingsCategoryId;
  onClose: () => void;
  onActiveCategoryChange: (category: AppSettingsCategoryId) => void;
  canvasPrefs: CanvasPreferences;
  onSetViewMode: (mode: CanvasPreferences["viewMode"]) => void;
  onSetCaptionAlign: (align: CanvasCaptionAlign) => void;
  onToggleField: (field: keyof CanvasPreferences["fields"]) => void;
  onToggleHoverAudioPlay: () => void;
  onToggleHoverVideoSound: () => void;
  aiUiPrefs: AiUiPreferences;
  aiConfigPanel: ReactNode;
  onToggleShowAiBadges: () => void;
  autoDetectImageSequences: boolean;
  onToggleAutoDetectImageSequences: () => void;
  onOpenAppLog?: () => void;
  onOpenExtensionReleases?: () => void;
  pluginApi?: SerpentPluginManagerApi;
  pluginContributionRefreshKey?: string | null;
  libraryId?: string;
  mcpApi?: SerpentMcpSettingsApi;
  syncServerCallbacks: SyncServerSettingsCallbacks;
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
  onSetCaptionAlign,
  onToggleField,
  onToggleHoverAudioPlay,
  onToggleHoverVideoSound,
  aiUiPrefs,
  aiConfigPanel,
  onToggleShowAiBadges,
  autoDetectImageSequences,
  onToggleAutoDetectImageSequences,
  onOpenAppLog,
  onOpenExtensionReleases,
  pluginApi,
  pluginContributionRefreshKey,
  libraryId,
  mcpApi,
  syncServerCallbacks,
}: AppSettingsDialogProps): ReactNode {
  const t = useT();
  const [pluginSettingsPluginId, setPluginSettingsPluginId] = useState<string | null>(null);
  const [pluginSettingsRefreshKey, setPluginSettingsRefreshKey] = useState(0);
  const pluginSettingsRefreshToken = `${pluginContributionRefreshKey ?? ''}:${pluginSettingsRefreshKey}`;
  const pluginSettingsEntries = usePluginSettingsNavEntries(
    pluginApi,
    libraryId,
    open ? pluginSettingsRefreshToken : null,
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
      <DialogShell
        className="create-dialog app-settings-dialog"
        contentClassName="ui-dialog-shell__content--flush"
        dialogId="app-settings-dialog"
        headerActions={(
          <button
            className="dialog-close"
            onClick={handleClose}
            type="button"
            {...iconActionAttrs(t("common.close"))}
          >
            <Icon name="close" size={16} />
          </button>
        )}
        onRequestClose={handleClose}
        title={t("settings.title")}
      >
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
                refreshKey={pluginSettingsRefreshToken}
              />
            ) : null}
            {!showingPluginSettings && activeCategory === "general" ? (
              <GeneralSettingsPage
                onOpenAppLog={onOpenAppLog}
                onOpenExtensionReleases={onOpenExtensionReleases}
              />
            ) : null}
            {!showingPluginSettings && activeCategory === "assets" ? (
              <AssetsSettingsPage
                autoDetectImageSequences={autoDetectImageSequences}
                onToggleAutoDetectImageSequences={onToggleAutoDetectImageSequences}
              />
            ) : null}
            {!showingPluginSettings && activeCategory === "appearance" ? <AppearanceSettingsPage /> : null}
            {!showingPluginSettings && activeCategory === "browse" ? (
              <BrowseSettingsPage
                canvasPrefs={canvasPrefs}
                onSetCaptionAlign={onSetCaptionAlign}
                onSetViewMode={onSetViewMode}
                onToggleField={onToggleField}
                onToggleHoverAudioPlay={onToggleHoverAudioPlay}
                onToggleHoverVideoSound={onToggleHoverVideoSound}
              />
            ) : null}
            {!showingPluginSettings && activeCategory === "ai" ? (
              <AiSettingsPage
                aiUiPrefs={aiUiPrefs}
                aiConfigPanel={aiConfigPanel}
                onToggleShowAiBadges={onToggleShowAiBadges}
              />
            ) : null}
            {!showingPluginSettings && activeCategory === "mcp" ? <McpSettingsPage api={mcpApi} onOpenAppLog={onOpenAppLog} /> : null}
            {!showingPluginSettings && activeCategory === "plugins" ? (
              <PluginSettingsPage
                api={pluginApi}
                libraryId={libraryId}
                onOpenPluginSettings={openPluginSettings}
                refreshKey={pluginSettingsRefreshToken}
              />
            ) : null}
            {!showingPluginSettings && activeCategory === "sync" ? (
              <SyncSettingsPage callbacks={syncServerCallbacks} />
            ) : null}
          </main>
        </div>
      </DialogShell>
    </div>
  );
}
