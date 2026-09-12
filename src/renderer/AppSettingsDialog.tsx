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
import { PluginCommunityPage } from "./PluginCommunityPage";
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
  showCardSyncStatus: boolean;
  onShowCardSyncStatusChange: (checked: boolean) => void;
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
  showCardSyncStatus,
  onShowCardSyncStatusChange,
}: AppSettingsDialogProps): ReactNode {
  const t = useT();
  const [pluginSettingsPluginId, setPluginSettingsPluginId] = useState<string | null>(null);
  const [showingCommunity, setShowingCommunity] = useState(false);
  const [communityPluginId, setCommunityPluginId] = useState<string | undefined>();
  const [communityDetailTitle, setCommunityDetailTitle] = useState<string | undefined>();
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
    setShowingCommunity(false);
    setCommunityPluginId(undefined);
    setCommunityDetailTitle(undefined);
    onActiveCategoryChange(category);
  }

  function openPluginSettings(pluginId: string) {
    setShowingCommunity(false);
    setCommunityPluginId(undefined);
    setCommunityDetailTitle(undefined);
    setPluginSettingsPluginId(pluginId);
    setPluginSettingsRefreshKey((value) => value + 1);
  }

  function openCommunity() {
    setPluginSettingsPluginId(null);
    setCommunityPluginId(undefined);
    setCommunityDetailTitle(undefined);
    setShowingCommunity(true);
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
              : showingCommunity
                ? "app-settings-plugin-community-heading"
                : `app-settings-tab-${activeCategory}`}
            className="app-settings-content"
            id={showingPluginSettings
              ? "app-settings-page-plugin-settings"
              : showingCommunity
                ? "app-settings-page-plugin-community"
                : `app-settings-page-${activeCategory}`}
            role="tabpanel"
          >
            <div className="app-settings-page-heading">
              {showingCommunity ? (
                <button
                  className="plugin-install-back"
                  onClick={() => {
                    if (communityPluginId !== undefined) {
                      setCommunityPluginId(undefined);
                      setCommunityDetailTitle(undefined);
                      return;
                    }
                    setShowingCommunity(false);
                  }}
                  type="button"
                >
                  <Icon name="chevron-left" size={14} />
                  {t("settings.pluginCommunityBack")}
                </button>
              ) : null}
              <h3 id={showingPluginSettings
                ? "app-settings-plugin-settings-heading"
                : showingCommunity
                  ? "app-settings-plugin-community-heading"
                  : undefined}
              >
                {showingPluginSettings
                  ? (activePluginEntry?.name ?? t("settings.categoryPluginSettings"))
                  : showingCommunity
                    ? (communityDetailTitle ?? t("settings.pluginCommunity"))
                    : t(activeCategoryDefinition.labelKey)}
              </h3>
              {showingCommunity && communityPluginId === undefined ? (
                <p>{t("settings.pluginCommunityHint")}</p>
              ) : null}
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
            {!showingPluginSettings && !showingCommunity && activeCategory === "plugins" ? (
              <PluginSettingsPage
                api={pluginApi}
                libraryId={libraryId}
                onOpenCommunity={openCommunity}
                onOpenPluginSettings={openPluginSettings}
                refreshKey={pluginSettingsRefreshToken}
              />
            ) : null}
            {showingCommunity ? (
              <PluginCommunityPage
                api={pluginApi}
                detailPluginId={communityPluginId}
                libraryId={libraryId}
                onDetailPluginIdChange={setCommunityPluginId}
                onDetailTitleChange={setCommunityDetailTitle}
                onInstalled={() => setPluginSettingsRefreshKey((value) => value + 1)}
                refreshKey={pluginSettingsRefreshToken}
              />
            ) : null}
            {!showingPluginSettings && activeCategory === "sync" ? (
              <SyncSettingsPage
                callbacks={syncServerCallbacks}
                onShowCardSyncStatusChange={onShowCardSyncStatusChange}
                showCardSyncStatus={showCardSyncStatus}
              />
            ) : null}
          </main>
        </div>
      </DialogShell>
    </div>
  );
}
