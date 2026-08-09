import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "node:fs";

import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  protocol,
  safeStorage,
  screen,
  shell,
  nativeImage,
  utilityProcess,
} from "electron";
import type { MessageBoxOptions } from "electron";

import { installApplicationMenu } from "./application-menu";
import { applyDevAppIcon, appIconImage } from "./app-icon";
import {
  clearViewerVideoShortcutCapture,
  isViewerVideoShortcutContentsActive,
  setViewerVideoShortcutCaptureActive,
} from "./viewer-video-shortcut-capture";
import { forwardViewerVideoShortcut } from "./viewer-video-shortcut-forward";
import {
  selectImportSources as selectImportSourcesDialog,
  selectLibraryDirectory,
  selectOpenDirectory,
  selectOpenFile,
  selectSavePath,
  type NativeDialogHost,
} from "./native-dialogs";
import {
  mapSystemLocaleToAppLocale,
  tryParseAppLocaleSync,
  type AppLocale,
} from "../shared/native-dialog-i18n";

import { popupEditContextMenu } from "./edit-context-menu";
import {
  createFileClipboardDeps,
  readFilePathsFromClipboard,
  writeFilePathsToClipboard,
} from "./file-clipboard";
import {
  createOpenWithDeps,
  openPathWithOtherApplication,
} from "./open-with";
import {
  bindWindowMaximizedEvents,
  registerWindowControls,
} from "./window-controls";
import {
  createWindowsTray,
  type WindowsTrayController,
} from "./windows-tray";
import {
  ASSET_CHANGE_CHANNEL,
  EXTENSION_SAVE_COMPLETED_CHANNEL,
  THUMBNAIL_CHANNEL,
  ACTIVE_CONTEXT_CHANNEL,
  APP_LOCALE_CHANNEL,
  LIBRARY_LIFECYCLE_CHANNEL,
  LIBRARY_CHANGED_CHANNEL,
  LIBRARY_REQUEST_CHANNEL,
  PROGRESS_CHANNEL,
  AI_PROGRESS_CHANNEL,
  AI_COMPLETED_CHANNEL,
  AI_CLEARED_CHANNEL,
  OPEN_EXTERNAL_URL_CHANNEL,
  REVEAL_APP_LOG_CHANNEL,
  READ_APP_LOG_CHANNEL,
  SHOW_EDIT_CONTEXT_MENU_CHANNEL,
  SHELL_NOTIFY_CHANNEL,
  SHELL_SWIPE_CHANNEL,
  WINDOW_FOCUS_CHANNEL,
  DESKTOP_AUTOMATION_SELECTION_CHANNEL,
  DESKTOP_AUTOMATION_BROWSE_RESULT_CHANNEL,
  NATIVE_EDIT_COPY_CHANNEL,
  PLUGIN_MANAGER_CHANNEL,
  PLUGIN_CONTRIBUTIONS_CHANGED_CHANNEL,
  PLUGIN_INPUT_CAPTURE_EVENT_CHANNEL,
  PLUGIN_INPUT_CAPTURE_SESSIONS_CHANNEL,
  PLUGIN_INPUT_CAPTURE_SYSTEM_MODAL_CHANNEL,
  VIEWER_VIDEO_SHORTCUTS_ACTIVE_CHANNEL,
  OFFSCREEN_THUMBNAIL_FRAME_CHANNEL,
} from "../shared/protocol/channels";
import {
  createAutomationCommandGateway,
  type AutomationCommandGateway,
} from '../automation/command-gateway';
import { sanitizeShellNotifyTitle } from '../shared/shell-notify';
import { PluginHostCommandError } from '../shared/plugin-host-command-error';
import {
  APP_ASSET_HOST,
  createAppAssetResponse,
} from './app-assets';
import { AutomationLibraryWorkerAdapter } from './automation-worker-adapter';
import {
  createDesktopAutomationFilePlanApprovalHandler,
  type DesktopAutomationFilePlanSummary,
} from './automation-file-plan-approval';
import {
  AutomationExecutionJournal,
  createJsonFileAutomationExecutionStore,
  projectAutomationExecutionStatus,
} from './automation-execution-journal';
import { registerAutomationScriptIpc } from './automation-script-ipc';
import { AutomationScriptFileService } from './automation-script-file-service';
import {
  createJsonFileAutomationRecentScriptsStore,
  type AutomationRecentScriptsStore,
} from './automation-recent-scripts-store';
import {
  maybeStartAutomationMcpMode,
  redirectConsoleToStderrForMcp,
} from './automation-mcp-bootstrap';
import type { AutomationMcpHostHandle } from './automation-mcp-host';
import {
  startDesktopAttachedMcp,
  type DesktopAttachedMcpHandle,
} from './desktop-attached-mcp';
import {
  type DesktopSelectionRequest,
  type DesktopSelectionResult,
} from '../shared/desktop-control';
import {
  createDesktopBrowseControl,
  type DesktopBrowseControl,
} from './desktop-browse-control';
import { ScriptRuntimeSupervisor } from './script-runtime-supervisor';
import { PluginRuntimeSupervisor, type PluginRuntimeHostCommandHandler, type PluginRuntimeInputCaptureStartHandler, type PluginRuntimeJobControlHandler, type PluginRuntimeJobEnqueueHandler, type PluginRuntimeJobProgressHandler, type PluginRuntimeStorageHandler } from './plugin-runtime-supervisor';
import { normalizeAutomationAssetSearchInput } from './normalize-automation-asset-search-input';
import { PluginTrustedRuntimeSupervisor } from './plugin-trusted-runtime-supervisor';
import { PluginInputCaptureBroker } from '../shared/plugin-input-capture';
import {
  parsePluginInputCapturePublishPayload,
  parsePluginInputCaptureSystemModalPayload,
  type PluginInputCaptureSessionsPayload,
} from '../shared/plugin-input-capture-renderer';
import { PluginActivationCoordinator } from './plugin-activation-coordinator';
import { PluginJobScheduler } from './plugin-job-scheduler';
import { PluginProviderScheduler } from './plugin-provider-scheduler';
import { pluginTargetLibraryIdSchema } from '../plugins/plugin-commands';
import { PluginStorageStore, PluginStorageStoreError } from './plugin-storage-store';
import { PluginSettingsStore } from './plugin-settings-store';
import { PluginMcpExposureStore } from './plugin-mcp-exposure-store';
import { PluginMcpToolProvider } from './plugin-mcp-tool-provider';
import { automationCapabilitiesFromPluginPermissions } from '../plugins/plugin-permission-capabilities';
import { createContributionRegistry } from '../plugins/plugin-contributions';
import { createPluginProviderRegistry } from '../plugins/plugin-providers';
import { pluginJobOwnerCanRetry, pluginJobOwnerMatches } from '../plugins/plugin-jobs';
import { loadOrCreatePluginDeviceId } from './plugin-device-identity';
import { createPluginPackageRequestHandler } from './plugin-package-ipc';
import { PluginPackageManager } from './plugin-package-manager';
import { PLUGIN_API_VERSION } from '../plugins/plugin-manifest';
import {
  createPluginDomainEvent,
  validatePluginCauseChain,
} from '../plugins/plugin-domain-events';
import type { AutomationExecutionContext } from '../automation/command-gateway';
import { AUTOMATION_API_VERSION } from '../automation/command-registry';
import { shouldUseFramelessTitleBar } from "../shared/window-controls";
import { matchViewerVideoLetterShortcut } from "../shared/viewer-video-shortcuts";
import {
  resolveOpenExternalUrlTarget,
  type OpenExternalUrlResult,
  type RevealAppLogResult,
} from "../shared/external-url";
import { libraryExportDefaultName } from "../shared/library-export-name";
import { parseReadAppLogRequest, type ReadAppLogResult } from "../shared/app-log";
import type { ShowEditContextMenuResult } from "../shared/edit-context-menu";
import {
  createPublicError,
  publicReasonFromError,
  toPublicError,
} from "../shared/protocol/errors";
import {
  parseRendererRequest,
  tryParseActiveContext,
  type RendererRequest,
  type WorkerCommand,
} from "../shared/protocol/requests";
import {
  parseRendererResult,
  parseRendererLifecycleEvent,
  type RendererLifecycleEvent,
  type RendererResult,
  type WorkerResult,
  type AssetChangeEvent,
  parseAssetChangeEvent,
  type LibraryChangedEvent,
  parseLibraryChangedEvent,
  type ExtensionSaveCompletedEvent,
  parseExtensionSaveCompletedEvent,
  type ProgressEvent,
  type AiProgressEvent,
  type AiAnalysisCompletedEvent,
  type AiContentClearedEvent,
  type ImageSequenceImportOffer,
  parseAiProgressEvent,
  parseAiAnalysisCompletedEvent,
  parseAiContentClearedEvent,
} from "../shared/protocol/responses";
import { LibraryWorkerClient } from "./worker-client";
import { resolveImageSequenceImportPaths } from "./image-sequence-import";
import { AppLogger } from "./app-logger";
import {
  logRendererChildProcessGone,
  logRendererConsoleMessage,
  logRendererProcessGone,
  logRendererResponsive,
  logRendererUnresponsive,
} from "./renderer-diagnostics";
import { pickIsolatedWindowPlacement } from "./e2e-isolated-window";
import {
  clearActiveRecentLibrary,
  readActiveLibraryPath,
  readRecentLibraryEntries,
  rememberRecentLibrary,
  removeRecentLibrary,
} from "./recent-libraries";
import { AiQueueScheduler } from "./ai-queue-scheduler";
import { aiSearchFailureReason, planAiSearch } from "./ai-search-planner";
import {
  DEFAULT_AI_ANALYSIS_SETTINGS,
  normalizeAiAnalysisSettings,
  toWireAiAnalysisSettings,
  type AiAnalysisSettings,
} from "../shared/ai-analysis-settings";
import {
  AI_ANALYSIS_QUEUE_BATCH_SIZE,
  DEFAULT_AI_ANALYSIS_CONCURRENCY,
  normalizeAiAnalysisConcurrency,
} from "../shared/ai-concurrency";
import {
  DEFAULT_AI_ANALYSIS_IMAGE_EDGE_PX,
  normalizeAiAnalysisImageEdgePx,
} from "../shared/ai-analysis-image";
import {
  DEFAULT_AI_RELIABILITY_SETTINGS,
  normalizeAiReliabilitySettings,
  type AiReliabilitySettings,
} from "../shared/ai-reliability";
import {
  DEFAULT_AI_LANGUAGES,
  listAiModels,
  migrateLegacyProviderToApiFormat,
  normalizeAiLanguages,
  type AiApiFormat,
} from "../shared/ai-endpoints";
import { createArtifactResponse } from "./artifact-response";
import {
  createOffscreenThumbnailRenderer,
  packagedRendererOutDir,
  resolveOffscreenPageUrl,
  type OffscreenThumbnailRenderer,
} from "./offscreen-thumbnail-renderer";
import {
  clearModelThumbnailSourceAuthorizations,
  registerModelThumbnailSourceAuthorizations,
  resolveModelThumbnailSourceAuthorization,
} from "./model-thumbnail-source-cache";
import {
  createExtensionServer,
  type ExtensionServer,
  type SaveIntent,
  type SaveIntentDisposition,
  type SaveUploadDisposition,
  type SaveUploadRequest,
  type ListFoldersDisposition,
} from "./extension-server";
import {
  readExtensionBrowseFolderIds,
  recordExtensionBrowseFolder,
} from "./extension-recent-browse-folders";
import { resolveExtensionSaveRouting } from "./extension-save-context";
import { RelinkPreviewStore } from "./relink-preview-store";
import {
  classifyDroppedSourcePaths,
  cleanupClipboardImage,
  cleanupStaleClipboardImages,
  stageClipboardImage,
} from "./desktop-ingestion";
import {
  createWebImportCollectionCommand,
  createWebImportCommand,
} from "./web-ingestion";
import { serpentProtocolSchemes } from "./serpent-protocol-privileges";
import {
  parsePluginUiAssetRequestFromNavigation,
  rewritePluginUiHtmlAssetUrls,
  pluginUiMimeType,
} from "./plugin-ui-assets";

if (process.env.SERPENT_E2E === "1") {
  const explicitUserDataPath = process.env.SERPENT_E2E_USER_DATA_PATH;
  app.setPath(
    "userData",
    explicitUserDataPath && path.isAbsolute(explicitUserDataPath)
      ? explicitUserDataPath
      : path.join(tmpdir(), "serpent-e2e-user-data", String(process.pid)),
  );
}

// Headless MCP stdio host (0023 Phase C). Isolate userData and keep JSON-RPC
// frames off console helpers before Forge/Vite noise is considered separately.
const mcpModeEnabled = process.env.SERPENT_MCP === "1";
const mcpAttachBootstrapEnabled = process.env.SERPENT_MCP_ATTACH_BOOTSTRAP === "1";
const desktopControlEnabled =
  process.env.SERPENT_E2E !== '1' || process.env.SERPENT_E2E_DESKTOP_CONTROL === '1';
if (mcpModeEnabled || mcpAttachBootstrapEnabled) {
  const mcpUserData = process.env.SERPENT_MCP_USER_DATA_PATH;
  app.setPath(
    "userData",
    mcpUserData && path.isAbsolute(mcpUserData)
      ? mcpUserData
      : path.join(tmpdir(), "serpent-mcp-user-data", String(process.pid)),
  );
}

// Dev multi-instance (Serpent-i6xg): isolate userData so SingletonLock / prefs
// do not collide. Prefer `npm run start:multi`. Do not open the same library
// for writes from two GUIs — SQLite write coordination is CLI/desktop lease
// territory (ADR-0021), not dual-GUI.
const allowMultiInstance = process.env.SERPENT_ALLOW_MULTI_INSTANCE === "1";
if (allowMultiInstance && process.env.SERPENT_E2E !== "1" && !mcpModeEnabled) {
  app.setPath(
    "userData",
    path.join(app.getPath("userData"), "dev-instances", `pid-${process.pid}`),
  );
}

// Before app.ready: stream privilege is required for seekable <video>/<audio>
// over serpent:// Range responses (Serpent-jh2).
protocol.registerSchemesAsPrivileged(serpentProtocolSchemes());

// E2E（本地/CI）：虚拟化 runner 的 GPU 不可靠，白屏会让所有交互测试
// 超时（CI mac 上 69 个 E2E 全挂）。禁用硬件加速换取稳定渲染。
if (process.env.SERPENT_E2E === "1") {
  app.disableHardwareAcceleration();
}

app.enableSandbox();

const hasSingleInstanceLock = allowMultiInstance
  ? true
  : app.requestSingleInstanceLock();

let mainWindow: BrowserWindow | undefined;
/** Effective UI locale for native dialogs; synced from Renderer (Serpent-bwb). */
let appLocale: AppLocale = "en";
let workerClient: LibraryWorkerClient | undefined;
/** Slice E: shared offscreen window that renders model thumbnails (Serpent-hnmg). */
let offscreenThumbnailRenderer: OffscreenThumbnailRenderer | undefined;
let quitAfterShutdown = false;
let startupComplete = false;
let logger: AppLogger | undefined;
let appLogPath: string | undefined;
let automationExecutionJournal: AutomationExecutionJournal | undefined;
let automationMcpHost: AutomationMcpHostHandle | undefined;
let desktopAttachedMcp: DesktopAttachedMcpHandle | undefined;
let desktopBrowseControl: DesktopBrowseControl | undefined;
let automationCommandGateway: AutomationCommandGateway | undefined;
let scriptRuntimeSupervisor: ScriptRuntimeSupervisor | undefined;
let pluginRuntimeSupervisor: PluginRuntimeSupervisor | undefined;
let pluginTrustedRuntimeSupervisor: PluginTrustedRuntimeSupervisor | undefined;
let pluginInputCaptureBroker: PluginInputCaptureBroker | undefined;
let pluginInputCaptureFlushTimer: NodeJS.Timeout | undefined;
let pluginActivationCoordinator: PluginActivationCoordinator | undefined;
let pluginJobScheduler: PluginJobScheduler | undefined;
let pluginProviderScheduler: PluginProviderScheduler | undefined;
let automationScriptFiles: AutomationScriptFileService | undefined;
let automationRecentScripts: AutomationRecentScriptsStore | undefined;
let pluginPackageManager: PluginPackageManager | undefined;
let pluginMcpToolProvider: PluginMcpToolProvider | undefined;
const pluginAutomationContexts = new Map<string, AutomationExecutionContext>();
const desktopAutomationSelections = new Map<string, string[]>();

function buildPluginInputCaptureSessionsPayload(): PluginInputCaptureSessionsPayload {
  const sessions = pluginInputCaptureBroker?.activeSessions() ?? [];
  return {
    sessions: sessions.map((session) => ({
      sessionId: session.sessionId,
      scope: session.scope,
      ...(session.ownerViewId === undefined ? {} : { ownerViewId: session.ownerViewId }),
      keyboard: session.keyboard,
      pointer: session.pointer,
    })),
  };
}

function publishPluginInputCaptureSessionsToRenderer(): void {
  if (!mainWindow) return;
  mainWindow.webContents.send(
    PLUGIN_INPUT_CAPTURE_SESSIONS_CHANNEL,
    buildPluginInputCaptureSessionsPayload(),
  );
}

function schedulePluginInputCaptureFlush(): void {
  if (pluginInputCaptureFlushTimer !== undefined) return;
  pluginInputCaptureFlushTimer = setTimeout(() => {
    pluginInputCaptureFlushTimer = undefined;
    pluginInputCaptureBroker?.flush();
  }, 0);
}
let windowsTray: WindowsTrayController | undefined;

function recentLibraryPath(): string {
  return path.join(app.getPath("userData"), "recent-library.json");
}

function currentPluginCompatibilityPlatform():
  | { platform: 'darwin' | 'win32' | 'linux'; arch: 'arm64' | 'x64' | 'ia32' }
  | undefined {
  const platform = process.platform;
  const arch = process.arch;
  if ((platform !== 'darwin' && platform !== 'win32' && platform !== 'linux')
    || (arch !== 'arm64' && arch !== 'x64' && arch !== 'ia32')) {
    return undefined;
  }
  return { platform, arch };
}

function rememberOpenedLibrary(libraryPath: string, displayName: string): void {
  rememberRecentLibrary(
    recentLibraryPath(),
    { path: libraryPath, name: displayName },
    {
      onError: (error) => {
        logger?.error("recent-library.write", error);
      },
    },
  );
}

let extensionServer: ExtensionServer | undefined;
let extensionBrowseFoldersStorePath: string | undefined;
const aiQueueScheduler = new AiQueueScheduler(processAiQueueBatch, {
  batchSize: AI_ANALYSIS_QUEUE_BATCH_SIZE,
  baseRetryDelayMs: DEFAULT_AI_RELIABILITY_SETTINGS.retryBaseDelayMs,
  maxRetryDelayMs: DEFAULT_AI_RELIABILITY_SETTINGS.retryMaxDelayMs,
  retryJitterRatio: DEFAULT_AI_RELIABILITY_SETTINGS.retryJitterRatio,
});

// Maps BrowserWindow.id to the active library/folder context for extension save.
const focusedContexts = new Map<
  number,
  { libraryId: string | null; selectedFolderId?: string }
>();
// Last Serpent window that published browse context or received OS focus.
let lastExtensionTargetWindowId: number | undefined;

// Keeps selected roots in Main. Renderer receives only an opaque, one-shot token.
const pendingRelinkPreviews = new RelinkPreviewStore();

// Pending import source path (importId -> sourceFolderPath), remembered after validation.
const pendingImportSources = new Map<string, string>();

// Pending import libraryId (importId -> libraryId), for auto-analyze after import.
const pendingImportLibraries = new Map<string, string>();

// Pending drop/paste collection destinations survive the conflict dialog. The
// actual import is already durable in Worker staging before Main stores this.
const pendingImportCollections = new Map<string, string>();

type StoredImageSequenceOffer = ImageSequenceImportOffer;

const pendingImageSequenceOffers = new Map<
  string,
  {
    offer: StoredImageSequenceOffer;
    expiresAt: number;
    nextSequenceIndex: number;
  }
>();

function rememberImageSequenceOffer(
  offer: StoredImageSequenceOffer,
): StoredImageSequenceOffer {
  const offerId = randomUUID();
  pendingImageSequenceOffers.set(offerId, {
    offer,
    expiresAt: Date.now() + 10 * 60_000,
    nextSequenceIndex: 0,
  });
  for (const [id, entry] of pendingImageSequenceOffers) {
    if (entry.expiresAt <= Date.now()) pendingImageSequenceOffers.delete(id);
  }
  return {
    defaultFps: offer.defaultFps,
    libraryId: offer.libraryId,
    offerId,
    sequences: offer.sequences.map((sequence) => ({
      displayName: sequence.displayName,
      extension: sequence.extension,
      firstFrame: sequence.firstFrame,
      frameCount: sequence.frameCount,
      height: sequence.height,
      lastFrame: sequence.lastFrame,
      numberStyle: sequence.numberStyle,
      numericWidth: sequence.numericWidth,
      prefix: sequence.prefix,
      width: sequence.width,
    })),
    ...(offer.targetFolderId ? { targetFolderId: offer.targetFolderId } : {}),
    ...(offer.targetCollectionId
      ? { targetCollectionId: offer.targetCollectionId }
      : {}),
  };
}

// ── AI Config ────────────────────────────────────────────────────────────

interface AiConfig {
  apiFormat: AiApiFormat;
  model: string;
  /** Empty = official default for the selected API format. */
  baseUrl: string;
  descriptionEnabled: boolean;
  tagEnabled: boolean;
  ratingEnabled: boolean;
  analysisSettings: AiAnalysisSettings;
  concurrencyLimit: number;
  /** Longest edge for images uploaded to analysis (default 2048 / 2K). */
  maxAnalysisImageEdgePx: number;
  reliabilitySettings: AiReliabilitySettings;
  languages: Array<"zh-CN" | "en" | "ja" | "ko">;
  autoAnalyzeEnabled: boolean;
  disclaimerAccepted: boolean;
}

const DEFAULT_AI_CONFIG: AiConfig = {
  apiFormat: "dashscope_native",
  model: "qwen3-vl-plus",
  baseUrl: "",
  descriptionEnabled: true,
  tagEnabled: true,
  ratingEnabled: true,
  analysisSettings: { ...DEFAULT_AI_ANALYSIS_SETTINGS },
  concurrencyLimit: DEFAULT_AI_ANALYSIS_CONCURRENCY,
  maxAnalysisImageEdgePx: DEFAULT_AI_ANALYSIS_IMAGE_EDGE_PX,
  reliabilitySettings: { ...DEFAULT_AI_RELIABILITY_SETTINGS },
  languages: ["zh-CN", "en"],
  autoAnalyzeEnabled: false,
  disclaimerAccepted: false,
};

function aiConfigPath(): string {
  return path.join(app.getPath("userData"), "ai-config.json");
}

function aiKeyPath(): string {
  return path.join(app.getPath("userData"), "ai-key.enc");
}

function loadAiConfig(): AiConfig & { hasKey: boolean } {
  try {
    const raw = readFileSync(aiConfigPath(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<AiConfig> & {
      provider?: string;
      language?: string;
      apiFormat?: string;
      languages?: unknown;
    };
    const apiFormat =
      migrateLegacyProviderToApiFormat(parsed.apiFormat) ??
      migrateLegacyProviderToApiFormat(parsed.provider) ??
      DEFAULT_AI_CONFIG.apiFormat;
    const languages = normalizeAiLanguages(
      parsed.languages ?? parsed.language ?? DEFAULT_AI_LANGUAGES,
    );
    const merged: AiConfig = {
      ...DEFAULT_AI_CONFIG,
      model: typeof parsed.model === "string" && parsed.model.trim()
        ? parsed.model
        : DEFAULT_AI_CONFIG.model,
      baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : "",
      descriptionEnabled:
        parsed.descriptionEnabled ?? DEFAULT_AI_CONFIG.descriptionEnabled,
      tagEnabled: parsed.tagEnabled ?? DEFAULT_AI_CONFIG.tagEnabled,
      ratingEnabled:
        (parsed as { ratingEnabled?: boolean }).ratingEnabled ??
        DEFAULT_AI_CONFIG.ratingEnabled,
      analysisSettings: normalizeAiAnalysisSettings({
        ...DEFAULT_AI_ANALYSIS_SETTINGS,
        ...((parsed as { analysisSettings?: Partial<AiAnalysisSettings> })
          .analysisSettings ?? {}),
        forceExistingTags:
          (parsed as { analysisSettings?: { forceExistingTags?: boolean } })
            .analysisSettings?.forceExistingTags ??
          DEFAULT_AI_ANALYSIS_SETTINGS.forceExistingTags,
      }),
      concurrencyLimit: normalizeAiAnalysisConcurrency(parsed.concurrencyLimit),
      maxAnalysisImageEdgePx: normalizeAiAnalysisImageEdgePx(
        (parsed as { maxAnalysisImageEdgePx?: unknown }).maxAnalysisImageEdgePx,
      ),
      reliabilitySettings: normalizeAiReliabilitySettings(
        parsed.reliabilitySettings,
      ),
      autoAnalyzeEnabled:
        parsed.autoAnalyzeEnabled ?? DEFAULT_AI_CONFIG.autoAnalyzeEnabled,
      disclaimerAccepted:
        parsed.disclaimerAccepted ?? DEFAULT_AI_CONFIG.disclaimerAccepted,
      apiFormat,
      languages,
    };
    const hasKey = existsSync(aiKeyPath());
    return { ...merged, hasKey };
  } catch {
    const hasKey = existsSync(aiKeyPath());
    return { ...DEFAULT_AI_CONFIG, hasKey };
  }
}

function saveAiConfig(config: AiConfig): void {
  const toSave: Record<string, unknown> = {};
  toSave.apiFormat = config.apiFormat;
  toSave.model = config.model;
  toSave.baseUrl = config.baseUrl;
  toSave.descriptionEnabled = config.descriptionEnabled;
  toSave.tagEnabled = config.tagEnabled;
  toSave.ratingEnabled = config.ratingEnabled;
  toSave.analysisSettings = config.analysisSettings;
  toSave.concurrencyLimit = config.concurrencyLimit;
  toSave.maxAnalysisImageEdgePx = config.maxAnalysisImageEdgePx;
  toSave.reliabilitySettings = config.reliabilitySettings;
  toSave.languages = config.languages;
  toSave.autoAnalyzeEnabled = config.autoAnalyzeEnabled;
  toSave.disclaimerAccepted = config.disclaimerAccepted;
  writeFileSync(aiConfigPath(), JSON.stringify(toSave, null, 2), "utf-8");
}

function getDecryptedApiKey(): string {
  try {
    const encrypted = readFileSync(aiKeyPath());
    return safeStorage.decryptString(encrypted);
  } catch {
    throw new Error("AI API key not configured or could not be decrypted.");
  }
}

function saveEncryptedApiKey(apiKey: string): void {
  const encrypted = safeStorage.encryptString(apiKey);
  writeFileSync(aiKeyPath(), encrypted);
}

function focusMainWindow(): boolean {
  return focusSerpentWindow(
    mainWindow && !mainWindow.isDestroyed() ? mainWindow.id : undefined,
  );
}

function handleSecondInstance(): void {
  if (
    MAIN_WINDOW_VITE_DEV_SERVER_URL &&
    mainWindow &&
    !mainWindow.isDestroyed()
  ) {
    void loadRendererDevUrl(
      mainWindow,
      MAIN_WINDOW_VITE_DEV_SERVER_URL,
    ).finally(() => focusMainWindow());
    return;
  }
  focusMainWindow();
}

function focusSerpentWindow(windowId?: number): boolean {
  const target =
    windowId === undefined
      ? mainWindow
      : BrowserWindow.getAllWindows().find((window) => window.id === windowId);
  if (!target || target.isDestroyed()) return false;
  if (target.isMinimized()) target.restore();
  target.show();
  target.focus();
  return true;
}

/**
 * Isolated-session placement for `SERPENT_E2E_ISOLATED=1`: real E2E must keep
 * real `show()`/focus semantics (an earlier `showInactive` attempt broke
 * keyboard/focus tests and was reverted — see
 * docs/internal/development/2026-07-19-e2e-isolated-session-development-log.md), so
 * this only changes *where* the window appears, never how it is shown.
 * When a non-primary display exists, the window is placed fully within it;
 * on a single-display Mac there is no isolation available yet and the
 * window falls back to the primary display (logged, not silent).
 */
function resolveE2eIsolatedPlacement(
  defaultSize: { width: number; height: number },
): { x: number; y: number; width: number; height: number } | undefined {
  if (process.env.SERPENT_E2E_ISOLATED !== "1") return undefined;

  const displays = screen.getAllDisplays().map((display) => ({
    id: display.id,
    bounds: display.bounds,
  }));
  const primaryDisplayId = screen.getPrimaryDisplay().id;
  const placement = pickIsolatedWindowPlacement(
    displays,
    primaryDisplayId,
    defaultSize,
  );

  if (placement) {
    logger?.info(
      "e2e.isolated-window",
      "Placing the E2E window on a secondary display so it does not steal foreground focus.",
      { ...placement },
    );
    return placement;
  }

  logger?.info(
    "e2e.isolated-window",
    "SERPENT_E2E_ISOLATED=1 was set but no secondary display was detected; " +
      "falling back to the primary display. The E2E window will steal " +
      "foreground focus on this machine (documented limitation of Serpent-a1b).",
    { displayCount: displays.length },
  );
  return undefined;
}

const DEV_SERVER_WAIT_MS = 60_000;
const DEV_SERVER_POLL_MS = 250;
const DEV_RENDERER_MOUNT_TIMEOUT_MS = 20_000;
const DEV_RENDERER_LOAD_ATTEMPTS = 4;

async function waitForDevServer(url: string): Promise<void> {
  const deadline = Date.now() + DEV_SERVER_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {
      // Vite may still be binding; keep polling until the deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, DEV_SERVER_POLL_MS));
  }
  throw new Error(
    `Renderer dev server did not become reachable within ${DEV_SERVER_WAIT_MS}ms: ${url}`,
  );
}

async function isRendererMounted(
  webContents: Electron.WebContents,
): Promise<boolean> {
  try {
    return await webContents.executeJavaScript(
      "Boolean(document.querySelector('#root .app-shell'))",
    );
  } catch {
    return false;
  }
}

async function waitForRendererMounted(
  webContents: Electron.WebContents,
  timeoutMs = DEV_RENDERER_MOUNT_TIMEOUT_MS,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isRendererMounted(webContents)) return true;
    await new Promise((resolve) => setTimeout(resolve, DEV_SERVER_POLL_MS));
  }
  return false;
}

async function loadRendererDevUrl(
  window: BrowserWindow,
  url: string,
): Promise<void> {
  for (let attempt = 1; attempt <= DEV_RENDERER_LOAD_ATTEMPTS; attempt++) {
    try {
      await waitForDevServer(url);
      await window.loadURL(url);
    } catch (error) {
      logger?.error("main.window.load-attempt", error, { attempt, url });
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
      continue;
    }
    if (await waitForRendererMounted(window.webContents)) {
      logger?.info("main.window.mount-verified", "Renderer shell visible.", {
        attempt,
        url,
      });
      return;
    }
    logger?.info(
      "main.window.mount-retry",
      "Renderer still blank after load; retrying.",
      { attempt, url },
    );
    await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
  }
  logger?.error(
    "main.window.mount-failed",
    new Error("Renderer remained blank after dev load retries."),
    { url, attempts: DEV_RENDERER_LOAD_ATTEMPTS },
  );
  throw new Error(`Renderer remained blank after dev load retries: ${url}`);
}

function attachRendererDiagnostics(window: BrowserWindow): void {
  window.webContents.on(
    "console-message",
    (_event, level, message, line, sourceId) => {
      logRendererConsoleMessage(logger, level, message, line, sourceId);
    },
  );
  window.webContents.on("render-process-gone", (_event, details) => {
    logRendererProcessGone(logger, window.id, details);
  });
  window.webContents.on("unresponsive", () => {
    logRendererUnresponsive(logger, window.id);
  });
  window.webContents.on("responsive", () => {
    logRendererResponsive(logger, window.id);
  });
}

async function createMainWindow(): Promise<void> {
  const defaultWidth = 1440;
  const defaultHeight = 900;
  const isolatedPlacement = resolveE2eIsolatedPlacement({
    width: defaultWidth,
    height: defaultHeight,
  });

  const devIcon = appIconImage();

  const window = new BrowserWindow({
    width: isolatedPlacement?.width ?? defaultWidth,
    height: isolatedPlacement?.height ?? defaultHeight,
    ...(isolatedPlacement
      ? { x: isolatedPlacement.x, y: isolatedPlacement.y }
      : {}),
    minWidth: 1040,
    minHeight: 680,
    show: false,
    backgroundColor: "#111417",
    ...(devIcon ? { icon: devIcon } : {}),
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 14, y: 14 },
        }
      : shouldUseFramelessTitleBar(process.platform)
        ? {
            // Serpent-znex: hide system title bar; renderer draws caption buttons.
            titleBarStyle: "hidden" as const,
          }
        : {}),
    webPreferences: {
      preload: path.join(__dirname, "index.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow = window;
  const mainContentsId = window.webContents.id;
  // Keep renderer diagnostics active in both development and packaged builds.
  // A blank window in a packaged build must leave the same evidence as one
  // started from Vite; idle windows produce no log entries.
  attachRendererDiagnostics(window);
  window.on("ready-to-show", () => window.show());
  // Cleanup while webContents/HWND still exist (`closed` is too late).
  window.on("close", () => {
    clearViewerVideoShortcutCapture(mainContentsId);
  });
  window.on("closed", () => {
    if (mainWindow === window) {
      focusedContexts.delete(window.id);
      mainWindow = undefined;
    }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.session.on("will-download", (event, item) => {
    if (item.getURL().startsWith("serpent-plugin:")) event.preventDefault();
  });
  // VIEWER-018: letter keys under CJK IME — Menu accelerators + IMM32 suspend
  // are primary on Windows; before-input remains a cross-platform fallback.
  window.webContents.on("before-input-event", (event, input) => {
    if (input.type !== 'keyDown' && input.type !== 'keyUp') return;
    const captureType = input.type === 'keyUp' ? 'keyup' : 'keydown';
    const captureResult = pluginInputCaptureBroker?.publish({
      target: { scope: 'application' },
      event: {
        type: captureType,
        timestamp: Date.now(),
        key: input.key,
        code: input.code,
        repeat: input.isAutoRepeat,
        altKey: input.alt,
        ctrlKey: input.control,
        metaKey: input.meta,
        shiftKey: input.shift,
        isComposing: input.isComposing,
      },
    });
    if (captureResult === 'delivered' || captureResult === 'queued') {
      event.preventDefault();
      return;
    }
    if (!isViewerVideoShortcutContentsActive(window.webContents.id)) {
      return;
    }
    const action = matchViewerVideoLetterShortcut({
      type: input.type,
      code: input.code,
      key: input.key,
      keyCode: (input as { keyCode?: number }).keyCode,
      control: input.control,
      meta: input.meta,
      alt: input.alt,
      shift: input.shift,
    });
    if (!action) return;
    event.preventDefault();
    forwardViewerVideoShortcut(window.webContents, action);
  });
  // Defense in depth (Serpent-46i9): even if a page-zoom accelerator sneaks
  // back into the menu, Chromium must not rescale the whole UI.
  void window.webContents.setVisualZoomLevelLimits(1, 1);
  // Serpent-znex: keep caption maximize/restore glyph in sync on Windows.
  if (shouldUseFramelessTitleBar(process.platform)) {
    bindWindowMaximizedEvents(window);
  }
  // macOS three-finger swipe (requires Trackpad → Swipe between pages).
  // Event is on BrowserWindow, not webContents.
  window.on("swipe", (_event, direction) => {
    window.webContents.send(SHELL_SWIPE_CHANNEL, direction);
  });

  const publishWindowFocus = () => {
    if (window.isFocused()) {
      lastExtensionTargetWindowId = window.id;
    }
    window.webContents.send(WINDOW_FOCUS_CHANNEL, {
      focused: window.isFocused(),
    });
  };
  window.on("focus", publishWindowFocus);
  window.on("blur", () => {
    pluginInputCaptureBroker?.releaseForWindowBlur();
    publishWindowFocus();
  });
  window.once("ready-to-show", publishWindowFocus);
  window.webContents.once("did-finish-load", () => {
    publishPluginInputCaptureSessionsToRenderer();
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
      if (errorCode === -3) return; // aborted
      const detail = [
        `Failed to load renderer (${errorCode}): ${errorDescription}`,
        validatedURL ? `URL: ${validatedURL}` : null,
        "If the window is black after npm start, a Vite port conflict is likely.",
        "Use `npm start` (auto free port) or free the process on 5173.",
      ]
        .filter(Boolean)
        .join("\n");
      logger?.error("main.window.load", detail);
      dialog.showErrorBox("Serpent renderer failed to load", detail);
    });
    try {
      await loadRendererDevUrl(window, MAIN_WINDOW_VITE_DEV_SERVER_URL);
    } catch (error) {
      logger?.error("main.window.dev-load", error);
      dialog.showErrorBox(
        "Serpent renderer failed to load",
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  } else {
    await window.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
}

function cancelled(): RendererResult {
  return { ok: false, error: createPublicError("CANCELLED") };
}

function getExtensionSaveRouting() {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  return resolveExtensionSaveRouting({
    focusedWindowId: focusedWindow?.id ?? null,
    contexts: focusedContexts,
    lastTargetWindowId: lastExtensionTargetWindowId ?? null,
    mainWindowId:
      mainWindow && !mainWindow.isDestroyed() ? mainWindow.id : null,
  });
}

function getExtensionSaveContext() {
  return getExtensionSaveRouting().context;
}

async function handleListFolders(): Promise<ListFoldersDisposition> {
  if (!workerClient) {
    return { ok: false, status: 503, reason: "worker unavailable" };
  }

  const saveContext = getExtensionSaveContext();
  if (!saveContext) {
    return { ok: false, status: 503, reason: "no active library" };
  }

  const result = await workerClient.request({
    type: "folder.list",
    libraryId: saveContext.libraryId,
  });
  if (!result.ok) {
    return {
      ok: false,
      status: result.error.code === "LIBRARY_NOT_OPEN" ? 503 : 422,
      reason: result.error.reason ?? result.error.code,
    };
  }
  if (result.type !== "folder.list") {
    return { ok: false, status: 500, reason: "unexpected worker response" };
  }

  let libraryDisplayName = "Serpent";
  const librariesResult = await workerClient.request({ type: "library.list" });
  if (librariesResult.ok && librariesResult.type === "library.list") {
    const match = librariesResult.libraries.find(
      (library) => library.libraryId === saveContext.libraryId,
    );
    if (match?.displayName) libraryDisplayName = match.displayName;
  }

  return {
    ok: true,
    libraryDisplayName,
    recentBrowsedFolderIds: (() => {
      let ids = extensionBrowseFoldersStorePath
        ? readExtensionBrowseFolderIds(
            extensionBrowseFoldersStorePath,
            saveContext.libraryId,
          )
        : [];
      if (saveContext.selectedFolderId) {
        ids = [
          saveContext.selectedFolderId,
          ...ids.filter((id) => id !== saveContext.selectedFolderId),
        ];
      }
      return ids;
    })(),
    folders: result.folders.map((folder) => ({
      folderId: folder.folderId,
      name: folder.name,
      relativePath: folder.relativePath,
      assetCount: folder.directAssetCount,
    })),
  };
}

async function handleSaveIntent(
  intent: SaveIntent,
): Promise<SaveIntentDisposition> {
  if (!workerClient) {
    return { accepted: false, status: 503, reason: "worker unavailable" };
  }

  const focusedWindow = BrowserWindow.getFocusedWindow();
  const saveContext = getExtensionSaveContext();
  if (!saveContext) {
    logger?.info(
      "extension-server.save",
      focusedWindow
        ? "No active library in focused window; dropping save intent."
        : "No focused Serpent window and no fallback browse context; dropping save intent.",
      {
        focusedWindowId: focusedWindow?.id ?? null,
        lastTargetWindowId: lastExtensionTargetWindowId ?? null,
        mainWindowId:
          mainWindow && !mainWindow.isDestroyed() ? mainWindow.id : null,
        contextWindowCount: focusedContexts.size,
      },
    );
    return { accepted: false, status: 503, reason: "no active library" };
  }

  const targetFolderId =
    intent.targetFolderId !== undefined
      ? intent.targetFolderId ?? undefined
      : saveContext.selectedFolderId;

  const command: WorkerCommand = {
    type: "extension.save-from-url",
    libraryId: saveContext.libraryId,
    targetFolderId,
    sourcePageUrl: intent.sourcePageUrl,
    mediaUrl: intent.mediaUrl,
    mediaType: intent.mediaType,
  };

  try {
    const result = await workerClient.request(command);
    if (!result.ok) {
      logger?.error(
        "extension-server.save",
        new Error(`Save failed: ${result.error.message}`),
        {
          code: result.error.code,
          reason: result.error.reason,
        },
      );
      return {
        accepted: false,
        status: result.error.code === "LIBRARY_NOT_OPEN" ? 503 : 422,
        reason: result.error.reason ?? result.error.code,
      };
    }
    logger?.info("extension-server.save", "Asset saved successfully.", {
      type: result.type,
    });
    if (result.type === "extension.asset-saved") {
      void enqueueAutoAnalyzeAfterImport(saveContext.libraryId, [
        result.asset.assetId,
      ]);
    }
    return { accepted: true };
  } catch (error) {
    logger?.error("extension-server.save", error);
    throw error;
  }
}

async function handleSaveUpload(
  upload: SaveUploadRequest,
): Promise<SaveUploadDisposition> {
  if (!workerClient) {
    return { accepted: false, status: 503, reason: "worker unavailable" };
  }

  const focusedWindow = BrowserWindow.getFocusedWindow();
  const saveRouting = getExtensionSaveRouting();
  const saveContext = saveRouting.context;
  if (!saveContext) {
    logger?.info(
      "extension-server.save-upload",
      focusedWindow
        ? "No active library in focused window; dropping upload."
        : "No focused Serpent window and no fallback browse context; dropping upload.",
      {
        focusedWindowId: focusedWindow?.id ?? null,
        lastTargetWindowId: lastExtensionTargetWindowId ?? null,
        mainWindowId:
          mainWindow && !mainWindow.isDestroyed() ? mainWindow.id : null,
        contextWindowCount: focusedContexts.size,
      },
    );
    return { accepted: false, status: 503, reason: "no active library" };
  }

  const targetFolderId =
    upload.targetFolderId !== undefined
      ? upload.targetFolderId ?? undefined
      : saveContext.selectedFolderId;

  const command: WorkerCommand = {
    type: "extension.save-from-file",
    libraryId: saveContext.libraryId,
    targetFolderId,
    sourcePageUrl: upload.sourcePageUrl,
    mediaUrl: upload.mediaUrl,
    stagedFilePath: upload.stagedFilePath,
    contentType: upload.contentType,
    filename: upload.filename,
  };

  try {
    const result = await workerClient.request(command);
    if (!result.ok) {
      logger?.error(
        "extension-server.save-upload",
        new Error(`Upload save failed: ${result.error.message}`),
        {
          code: result.error.code,
          reason: result.error.reason,
        },
      );
      return {
        accepted: false,
        status: result.error.code === "LIBRARY_NOT_OPEN" ? 503 : 422,
        reason: result.error.reason ?? result.error.code,
      };
    }
    if (result.type !== "extension.asset-saved") {
      return { accepted: false, status: 500, reason: "unexpected worker response" };
    }
    logger?.info("extension-server.save-upload", "Asset saved successfully.", {
      type: result.type,
      byteLength: upload.byteLength,
      assetId: result.asset.assetId,
    });
    if (upload.focusAppAfterSave) {
      focusSerpentWindow(saveRouting.targetWindowId ?? undefined);
    }
    if (upload.revealInLibrary) {
      publishExtensionSaveCompleted(saveRouting.targetWindowId, {
        type: "extension.save.completed",
        libraryId: saveContext.libraryId,
        asset: result.asset,
      });
    }
    void enqueueAutoAnalyzeAfterImport(saveContext.libraryId, [
      result.asset.assetId,
    ]);
    return { accepted: true };
  } catch (error) {
    logger?.error("extension-server.save-upload", error);
    throw error;
  } finally {
    try {
      rmSync(upload.stagingDirectory, { recursive: true, force: true });
    } catch (error) {
      logger?.error("extension-server.save-upload-cleanup", error);
    }
  }
}

function publishLifecycle(event: RendererLifecycleEvent): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(
    LIBRARY_LIFECYCLE_CHANNEL,
    parseRendererLifecycleEvent(event),
  );
}

function publishAssetChange(event: AssetChangeEvent): void {
  const parsed = parseAssetChangeEvent(event);
  pluginActivationCoordinator?.fanOutDomainEvent(createPluginDomainEvent({
    kind: 'asset.changed',
    libraryId: parsed.libraryId,
    summary: {
      changedCount: parsed.changedCount,
      missingCount: parsed.missingCount,
      ...(parsed.source === undefined ? {} : { source: parsed.source }),
    },
  }));
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(
    ASSET_CHANGE_CHANNEL,
    parsed,
  );
}

function publishLibraryChanged(event: LibraryChangedEvent): void {
  const parsed = parseLibraryChangedEvent(event);
  pluginActivationCoordinator?.fanOutDomainEvent(createPluginDomainEvent({
    kind: 'library.changed',
    libraryId: parsed.libraryId,
    summary: {
      changeSequence: parsed.changeSequence,
    },
  }));
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(
    LIBRARY_CHANGED_CHANNEL,
    parsed,
  );
}

function publishExtensionSaveCompleted(
  windowId: number | null,
  event: ExtensionSaveCompletedEvent,
): void {
  const target =
    windowId === null
      ? mainWindow
      : BrowserWindow.getAllWindows().find((window) => window.id === windowId);
  if (!target || target.isDestroyed()) return;
  target.webContents.send(
    EXTENSION_SAVE_COMPLETED_CHANNEL,
    parseExtensionSaveCompletedEvent(event),
  );
}

function publishProgress(event: ProgressEvent): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(PROGRESS_CHANNEL, event);
}

function publishAiProgress(event: AiProgressEvent): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(AI_PROGRESS_CHANNEL, parseAiProgressEvent(event));
}

function publishAiCompleted(event: AiAnalysisCompletedEvent): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(
    AI_COMPLETED_CHANNEL,
    parseAiAnalysisCompletedEvent(event),
  );
}

function publishAiCleared(event: AiContentClearedEvent): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(
    AI_CLEARED_CHANNEL,
    parseAiContentClearedEvent(event),
  );
}

async function enqueueAutoAnalyzeAfterImport(
  libraryId: string,
  importedAssetIds: string[],
  folderId?: string,
): Promise<void> {
  const config = loadAiConfig();
  if (!config.autoAnalyzeEnabled || !config.hasKey || !config.apiFormat) return;
  if ((importedAssetIds.length === 0 && !folderId) || !workerClient) return;

  try {
    const result = await workerClient.request({
      type: "ai.enqueue-analysis",
      libraryId,
      ...(importedAssetIds.length > 0 ? { assetIds: importedAssetIds } : {}),
      ...(folderId ? { folderId } : {}),
    });
    if (result.ok && result.type === "ai.jobs.enqueued") {
      logger?.info(
        "auto-analyze",
        `Enqueued ${result.enqueued} AI analysis jobs after import.`,
      );
      await processAiQueue(libraryId);
    }
  } catch (error) {
    logger?.error("auto-analyze", error);
    // Non-blocking: import succeeded regardless of AI enqueue failure.
  }
}

async function processAiQueue(libraryId: string): Promise<void> {
  const config = loadAiConfig();
  aiQueueScheduler.setRetryPolicy(config.reliabilitySettings);
  await aiQueueScheduler.trigger(libraryId);
}

/** Shared post-open hook for dialog opens and startup recent-library restore. */
async function notifyLibraryOpenedSideEffects(input: {
  libraryId: string;
  libraryDirectory: string;
}): Promise<void> {
  void processAiQueue(input.libraryId);
  try {
    await pluginActivationCoordinator?.onLibraryOpened({
      libraryId: input.libraryId,
      libraryDirectory: input.libraryDirectory,
    });
  } catch (error) {
    logger?.error("plugin.activation.library-opened", error, {
      libraryId: input.libraryId,
    });
  }
  // Global plugin activation uses an internal pseudo-library. Once the real
  // library is open, tick only jobs explicitly enqueued or retried in this
  // application session; interrupted rows are never auto-recovered.
  pluginJobScheduler?.tick(input.libraryId);
}

async function processAiQueueBatch(
  libraryId: string,
  maxJobs: number,
): Promise<{ processed: number; requeued: number }> {
  const config = loadAiConfig();
  if (!config.hasKey || !workerClient) return { processed: 0, requeued: 0 };
  try {
    const apiKey = getDecryptedApiKey();
    const result = await workerClient.request({
      type: "ai.process-queue",
      libraryId,
      apiFormat: config.apiFormat,
      model: config.model,
      apiKey,
      ...(config.baseUrl.trim() ? { baseUrl: config.baseUrl.trim() } : {}),
      enabledFields: {
        description: config.descriptionEnabled,
        tags: config.tagEnabled,
        rating: config.ratingEnabled,
      },
      analysisSettings: toWireAiAnalysisSettings(config.analysisSettings),
      languages: config.languages,
      concurrencyLimit: config.concurrencyLimit,
      maxAnalysisImageEdgePx: config.maxAnalysisImageEdgePx,
      requestTimeoutMs: config.reliabilitySettings.requestTimeoutMs,
      maxAttempts: config.reliabilitySettings.maxAttempts,
      maxJobs,
    });
    if (!result.ok) {
      logger?.error(
        "ai.queue.process",
        new Error(`Worker rejected AI queue batch: ${result.error.code}`),
      );
      return { processed: 0, requeued: 0 };
    }
    if (result.type !== "ai.jobs.processed") {
      logger?.error(
        "ai.queue.process",
        new Error(`Unexpected AI queue result: ${result.type}`),
      );
      return { processed: 0, requeued: 0 };
    }
    return { processed: result.processed, requeued: result.requeued };
  } catch (error) {
    logger?.error("ai.queue.process", error);
    return { processed: 0, requeued: 0 };
  }
}

function toRendererResult(
  result: WorkerResult,
  relinkPreviewId?: string,
): RendererResult {
  if (!result.ok) return parseRendererResult(result);
  if (result.type === "library.opened") {
    return parseRendererResult({
      ok: true,
      type: result.type,
      library: {
        libraryId: result.library.libraryId,
        displayName: result.library.displayName,
        displayPath: result.library.libraryPath,
        // Serpent-033e: read-only degrade for newer-schema libraries.
        readOnly: result.library.readOnly,
        libraryVersion: result.library.libraryVersion,
        supportedSchemaVersion: result.library.supportedSchemaVersion,
        // Serpent-verg.5: read-only because the migration is stuck.
        migrationStuck: result.library.migrationStuck,
      },
    });
  }
  if (result.type === "library.renamed") {
    return parseRendererResult({
      ok: true,
      type: result.type,
      library: {
        libraryId: result.library.libraryId,
        displayName: result.library.displayName,
        displayPath: result.library.libraryPath,
      },
    });
  }
  if (result.type === "library.list") {
    return parseRendererResult({
      ok: true,
      type: result.type,
      libraries: result.libraries.map((library) => ({
        libraryId: library.libraryId,
        displayName: library.displayName,
        displayPath: library.libraryPath,
      })),
    });
  }
  // library.imported includes libraryPath but the renderer schema strips it.
  if (result.type === "library.imported") {
    // Use libraryPath for lifecycle but strip from renderer result.
    // The lifecycle is published in handleLibraryRequest above.
    return parseRendererResult({
      ok: true,
      type: "library.imported",
      importId: result.importId,
      libraryId: result.libraryId,
      displayName: result.displayName,
    });
  }
  // library.deleted includes libraryPath for Main recent-store cleanup only.
  if (result.type === "library.deleted") {
    return parseRendererResult({
      ok: true,
      type: "library.deleted",
      libraryId: result.libraryId,
      displayName: result.displayName,
    });
  }
  if (result.type === "asset.relink-batch.preview") {
    if (!relinkPreviewId) {
      throw new Error("Batch relink preview is missing its Main-process token.");
    }
    return parseRendererResult({
      ...result,
      previewId: relinkPreviewId,
    });
  }
  return parseRendererResult(result);
}

function createNativeDialogHost(): NativeDialogHost {
  return {
    getLocale: () => appLocale,
    getMainWindow: () => mainWindow ?? null,
    isE2e: () => !app.isPackaged && process.env.SERPENT_E2E === "1",
  };
}

async function selectAutomationScriptToOpen(): Promise<string | undefined> {
  return selectOpenFile(
    createNativeDialogHost(),
    'openAutomationScript',
    process.env.SERPENT_E2E_OPEN_AUTOMATION_SCRIPT,
    [{ name: 'Serpent scripts', extensions: ['serpent.js', 'serpent.ts'] }],
  );
}

async function selectAutomationScriptToSave(): Promise<string | undefined> {
  return selectSavePath(
    createNativeDialogHost(),
    'saveAutomationScript',
    process.env.SERPENT_E2E_SAVE_AUTOMATION_SCRIPT,
    {
      defaultPath: 'Untitled.serpent.ts',
      filters: [{ name: 'Serpent scripts', extensions: ['serpent.js', 'serpent.ts'] }],
    },
  );
}

async function selectImportSources(
  sourceKind: "files" | "folder",
): Promise<string[] | undefined> {
  return selectImportSourcesDialog(createNativeDialogHost(), sourceKind);
}

async function selectDirectory(
  dialogId: "createLibrary" | "openLibrary",
): Promise<string | undefined> {
  return selectLibraryDirectory(createNativeDialogHost(), dialogId);
}

async function selectPluginPackage(): Promise<string | undefined> {
  // Isolated Electron E2E injects a disposable package path. Production and
  // normal development always use the native picker, so Renderer never gains
  // path selection capability.
  if (!app.isPackaged && process.env.SERPENT_E2E === '1') {
    const e2ePackage = process.env.SERPENT_E2E_PLUGIN_PACKAGE;
    return e2ePackage && path.isAbsolute(e2ePackage) ? e2ePackage : undefined;
  }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, {
      title: 'Install a Serpent plugin',
      buttonLabel: 'Choose plugin',
      properties: ['openFile', 'openDirectory'],
      filters: [{ name: 'Serpent plugin package', extensions: ['zip'] }],
    })
    : await dialog.showOpenDialog({
      title: 'Install a Serpent plugin',
      buttonLabel: 'Choose plugin',
      properties: ['openFile', 'openDirectory'],
      filters: [{ name: 'Serpent plugin package', extensions: ['zip'] }],
    });
  return result.canceled || result.filePaths.length === 0 ? undefined : result.filePaths[0];
}

async function commandFor(
  request: RendererRequest,
): Promise<WorkerCommand | undefined> {
  switch (request.type) {
    case "library.create.request": {
      const selectedParentPath = await selectDirectory("createLibrary");
      return selectedParentPath
        ? {
            type: "library.create",
            displayName: request.displayName,
            selectedParentPath,
          }
        : undefined;
    }
    case "library.open.request": {
      const selectedLibraryPath = await selectDirectory("openLibrary");
      return selectedLibraryPath
        ? { type: "library.open", selectedLibraryPath }
        : undefined;
    }
    case "library.close.request":
      return { type: "library.close", libraryId: request.libraryId };
    case "library.rename.request":
      return { type: "library.rename", libraryId: request.libraryId, displayName: request.displayName };
    case "library.delete-from-disk.request":
      return { type: "library.delete-from-disk", libraryId: request.libraryId };
    case "library.list.request":
      return { type: "library.list" };
    case "library.list-recent.request":
    case "library.open-recent.request":
    case "library.forget-recent.request":
      // Both are handled directly in handleLibraryRequest: the list comes from
      // the Main-owned recent libraries store, and open-recent validates store
      // membership before building the same library.open command used here.
      // forget-recent only mutates the Main store (Serpent-ucx).
      return undefined;
    case "folder.create.request":
      return {
        type: "folder.create",
        libraryId: request.libraryId,
        parentFolderId: request.parentFolderId,
        name: request.name,
      };
    case "folder.rename.request":
      return {
        type: "folder.rename",
        libraryId: request.libraryId,
        folderId: request.folderId,
        newName: request.newName,
      };
    case "folder.list.request":
      return { type: "folder.list", libraryId: request.libraryId, showIgnored: request.showIgnored };
    case "folder.browse-entries.request":
      return {
        type: "folder.browse-entries",
        libraryId: request.libraryId,
        parentFolderId: request.parentFolderId,
        showIgnored: request.showIgnored,
      };
    case "folder.trash.request":
      return {
        type: "folder.trash",
        libraryId: request.libraryId,
        folderId: request.folderId,
      };
    case "folder.delete-from-disk.request":
      return {
        type: "folder.delete-from-disk",
        libraryId: request.libraryId,
        folderId: request.folderId,
      };
    case "linked-folder.remove.request":
      return {
        type: "linked-folder.remove",
        libraryId: request.libraryId,
        folderId: request.folderId,
      };
    case "linked-folder.delete-subtree.request":
      return {
        type: "linked-folder.delete-subtree",
        libraryId: request.libraryId,
        linkedFolderId: request.linkedFolderId,
        relativePath: request.relativePath,
        deleteFromDisk: request.deleteFromDisk,
      };
    case "folder.open-in-file-manager.request":
      // Handled directly in handleLibraryRequest because it requires shell.openPath.
      return {
        type: "folder.get-path",
        libraryId: request.libraryId,
        folderId: request.folderId,
      };
    case "folder.open-with.request":
      // Handled directly in handleLibraryRequest (macOS picker / Windows Open With).
      return {
        type: "folder.get-path",
        libraryId: request.libraryId,
        folderId: request.folderId,
      };
    case "folder.copy-path.request":
      // Handled directly in handleLibraryRequest because it requires clipboard.writeText.
      return {
        type: "folder.get-path",
        libraryId: request.libraryId,
        folderId: request.folderId,
      };
    case "folder.copy.request":
      // OS file clipboard (clarification #5); path resolved then written in Main.
      return {
        type: "folder.get-path",
        libraryId: request.libraryId,
        folderId: request.folderId,
      };
    case "folder.paste.request":
      // Clipboard paths are read in handleLibraryRequest, then imported.
      return undefined;
    case "folder.clone.request":
      return {
        type: "folder.clone",
        libraryId: request.libraryId,
        folderId: request.folderId,
      };
    case "folder.move.request":
      return {
        type: "folder.move",
        libraryId: request.libraryId,
        folderIds: request.folderIds,
        targetParentFolderId: request.targetParentFolderId,
        conflictStrategy: request.conflictStrategy,
      };
    case "asset.list.request":
      return {
        type: "asset.list",
        libraryId: request.libraryId,
        folderId: request.folderId,
        recursive: request.recursive,
        showIgnored: request.showIgnored,
      };
    case "asset.import-files.request": {
      const sourcePaths = await selectImportSources("files");
      return sourcePaths
        ? {
            type: "asset.import.prepare",
            libraryId: request.libraryId,
            targetFolderId: request.targetFolderId,
            sourceKind: "files" as const,
            sourcePaths,
            expandImageSequences:
              !app.isPackaged && process.env.SERPENT_E2E === "1",
            imageSequenceFps:
              !app.isPackaged && process.env.SERPENT_E2E === "1"
                ? 30
                : undefined,
          }
        : undefined;
    }
    case "asset.import-folder.request": {
      const sourcePaths = await selectImportSources("folder");
      return sourcePaths
        ? {
            type: "asset.import.prepare",
            libraryId: request.libraryId,
            targetFolderId: request.targetFolderId,
            sourceKind: "folder",
            sourcePaths,
          }
        : undefined;
    }
    case "asset.import-drop.request":
      // Classified in handleLibraryRequest because classification failures need
      // a renderer-safe, specific public error instead of an INTERNAL_ERROR.
      return undefined;
    case "asset.import-sequence.confirm":
      // Resolved against Main-held offer paths in handleLibraryRequest.
      return undefined;
    case "asset.import-drop-invalid.report":
      return undefined;
    case "asset.import-web.request":
      return createWebImportCommand(request);
    case "asset.import-web-invalid.report":
      return undefined;
    case "asset.import-clipboard.request":
      // Clipboard bytes are read and staged in handleLibraryRequest. Renderer
      // never sends clipboard bytes or a source path.
      return undefined;
    case "asset.import.resolve":
      return {
        type: "asset.import.resolve",
        importId: request.importId,
        suspectedDuplicate: request.suspectedDuplicate,
        nameConflict: request.nameConflict,
      };
    case "asset.import.abandon":
      return { type: "asset.import.abandon", importId: request.importId };
    case "asset.refresh.request":
      return { type: "asset.refresh", libraryId: request.libraryId };
    case "asset.import-linked.request": {
      const sourceRootPath = await selectOpenDirectory(
        createNativeDialogHost(),
        "linkFolder",
        process.env.SERPENT_E2E_LINKED_SOURCE,
      );
      return sourceRootPath
        ? {
            type: "asset.import-linked",
            libraryId: request.libraryId,
            displayName: request.displayName,
            sourceRootPath,
          }
        : undefined;
    }
    case "linked-folder.list.request":
      return { type: "linked-folder.list", libraryId: request.libraryId };
    case "linked-folder.relink.request": {
      const newRootPath = await selectOpenDirectory(
        createNativeDialogHost(),
        "relinkFolder",
        process.env.SERPENT_E2E_LINKED_NEW_ROOT,
      );
      return newRootPath
        ? {
            type: "linked-folder.relink",
            libraryId: request.libraryId,
            folderId: request.folderId,
            newRootPath,
          }
        : undefined;
    }
    case "linked-folder.rules.get.request":
      return {
        type: "linked-folder.rules.get",
        libraryId: request.libraryId,
        folderId: request.folderId,
      };
    case "linked-folder.rules.set.request":
      return {
        type: "linked-folder.rules.set",
        libraryId: request.libraryId,
        folderId: request.folderId,
        rules: request.rules,
      };
    case "ignore.list.request":
      return { type: "ignore.list", libraryId: request.libraryId };
    case "ignore.gitignore.get.request":
      return { type: "ignore.gitignore.get", libraryId: request.libraryId };
    case "ignore.gitignore.set.request":
      return {
        type: "ignore.gitignore.set",
        libraryId: request.libraryId,
        content: request.content,
      };
    case "ignore.set.request":
      return {
        type: "ignore.set",
        libraryId: request.libraryId,
        locationKind: request.locationKind,
        linkedFolderId: request.linkedFolderId,
        relativePath: request.relativePath,
        pathKind: request.pathKind,
        ignored: request.ignored,
      };
    case "linked-folder.assets.copy.request":
      return {
        type: "linked-folder.assets.copy",
        libraryId: request.libraryId,
        folderId: request.folderId,
        assetIds: request.assetIds,
        conflictStrategy: request.conflictStrategy,
      };
    case "linked-folder.convert.request":
      return {
        type: "linked-folder.convert",
        libraryId: request.libraryId,
        folderId: request.folderId,
        targetFolderId: request.targetFolderId,
      };
    case "tag.list.request":
      return { type: "tag.list", libraryId: request.libraryId };
    case "tag.create.request":
      return {
        type: "tag.create",
        libraryId: request.libraryId,
        name: request.name,
      };
    case "tag.rename.request":
      return {
        type: "tag.rename",
        libraryId: request.libraryId,
        tagId: request.tagId,
        name: request.name,
      };
    case "tag.delete.request":
      return {
        type: "tag.delete",
        libraryId: request.libraryId,
        tagId: request.tagId,
      };
    case "tag.delete-many.request":
      return {
        type: "tag.delete-many",
        libraryId: request.libraryId,
        tagIds: request.tagIds,
      };
    case "tag.merge.request":
      return {
        type: "tag.merge",
        libraryId: request.libraryId,
        sourceTagIds: request.sourceTagIds,
        name: request.name,
      };
    case "tag.cooccurrence.request":
      return {
        type: "tag.cooccurrence",
        libraryId: request.libraryId,
        minWeight: request.minWeight,
        maxNodes: request.maxNodes,
        maxEdges: request.maxEdges,
      };
    case "tag.assign.request":
      return {
        type: "tag.assign",
        libraryId: request.libraryId,
        assetIds: request.assetIds,
        tagIds: request.tagIds,
      };
    case "tag.remove.request":
      return {
        type: "tag.remove",
        libraryId: request.libraryId,
        assetIds: request.assetIds,
        tagIds: request.tagIds,
      };
    case "collection.list.request":
      return { type: "collection.list", libraryId: request.libraryId };
    case "collection.create.request":
      return {
        type: "collection.create",
        libraryId: request.libraryId,
        parentId: request.parentId,
        name: request.name,
      };
    case "collection.update.request":
      return {
        type: "collection.update",
        libraryId: request.libraryId,
        collectionId: request.collectionId,
        name: request.name,
        description: request.description,
        coverAssetId: request.coverAssetId,
        position: request.position,
      };
    case "collection.reorder.request":
      return {
        type: "collection.reorder",
        libraryId: request.libraryId,
        orderedCollectionIds: request.orderedCollectionIds,
      };
    case "collection.delete.request":
      return {
        type: "collection.delete",
        libraryId: request.libraryId,
        collectionId: request.collectionId,
      };
    case "collection.assets.add.request":
      return {
        type: "collection.assets.add",
        libraryId: request.libraryId,
        collectionId: request.collectionId,
        assetIds: request.assetIds,
      };
    case "collection.assets.remove.request":
      return {
        type: "collection.assets.remove",
        libraryId: request.libraryId,
        collectionId: request.collectionId,
        assetIds: request.assetIds,
      };
    case "collection.assets.reorder.request":
      return {
        type: "collection.assets.reorder",
        libraryId: request.libraryId,
        collectionId: request.collectionId,
        orderedAssetIds: request.orderedAssetIds,
      };
    case "collection.assets.list.request":
      return {
        type: "collection.assets.list",
        libraryId: request.libraryId,
        collectionId: request.collectionId,
        recursive: request.recursive,
      };
    case "collection.assets.memberships.request":
      return {
        type: "collection.assets.memberships",
        libraryId: request.libraryId,
        assetIds: request.assetIds,
      };
    case "asset.metadata.get.request":
      return {
        type: "asset.metadata.get",
        libraryId: request.libraryId,
        assetId: request.assetId,
      };
    case "asset.extracted-metadata.get.request":
      return {
        type: "asset.extracted-metadata.get",
        libraryId: request.libraryId,
        assetId: request.assetId,
      };
    case "asset.color-space.set.request":
      return {
        type: "asset.color-space.set",
        libraryId: request.libraryId,
        assetId: request.assetId,
        colorSpace: request.colorSpace,
      };
    case "asset.metadata.set.request":
      return {
        type: "asset.metadata.set",
        libraryId: request.libraryId,
        assetId: request.assetId,
        expectedVersion: request.expectedVersion,
        description: request.description,
        rating: request.rating,
        favorite: request.favorite,
        palette: request.palette,
        sourcePageUrl: request.sourcePageUrl,
        author: request.author,
      };
    case "asset.metadata.backfill.request":
      return { type: "asset.metadata.backfill", libraryId: request.libraryId };
    case "asset.rating.set.request":
      return {
        type: "asset.rating.set",
        libraryId: request.libraryId,
        assetIds: request.assetIds,
        rating: request.rating,
      };
    case "asset.search.request":
      return {
        type: "asset.search",
        libraryId: request.libraryId,
        query: request.query,
        filters: request.filters,
        scope: request.scope,
        sort: request.sort,
        scopeMode: request.scopeMode,
        limit: request.limit,
        offset: request.offset,
        showIgnored: request.showIgnored,
      };
    case "ai.search-plan.request":
      // Planned directly in Main so provider credentials never enter the
      // Renderer response or Library Worker command stream.
      return undefined;
    case "smart-collection.list.request":
      return { type: "smart-collection.list", libraryId: request.libraryId };
    case "smart-collection.create.request":
      return {
        type: "smart-collection.create",
        libraryId: request.libraryId,
        name: request.name,
        queryDefinitionJson: request.queryDefinitionJson,
      };
    case "smart-collection.update.request":
      return {
        type: "smart-collection.update",
        libraryId: request.libraryId,
        collectionId: request.collectionId,
        name: request.name,
        queryDefinitionJson: request.queryDefinitionJson,
        position: request.position,
      };
    case "smart-collection.delete.request":
      return {
        type: "smart-collection.delete",
        libraryId: request.libraryId,
        collectionId: request.collectionId,
      };
    case "smart-collection.execute.request":
      return {
        type: "smart-collection.execute",
        libraryId: request.libraryId,
        collectionId: request.collectionId,
        scopeMode: request.scopeMode,
        limit: request.limit,
        offset: request.offset,
      };
    case "asset.trash.request":
      return {
        type: "asset.trash",
        libraryId: request.libraryId,
        assetIds: request.assetIds,
      };
    case "asset.sequence.create.request":
      return {
        type: "asset.sequence.create",
        libraryId: request.libraryId,
        assetIds: request.assetIds,
        fps: request.fps,
      };
    case "asset.sequence.dissolve.request":
      return {
        type: "asset.sequence.dissolve",
        libraryId: request.libraryId,
        sequenceId: request.sequenceId,
      };
    case "asset.sequence.dissolve-batch.request":
      return {
        type: "asset.sequence.dissolve-batch",
        libraryId: request.libraryId,
        sequenceIds: request.sequenceIds,
      };
    case "asset.sequence.set-fps.request":
      return {
        type: "asset.sequence.set-fps",
        libraryId: request.libraryId,
        sequenceId: request.sequenceId,
        fps: request.fps,
      };
    case "asset.restore.request":
      return {
        type: "asset.restore",
        libraryId: request.libraryId,
        assetIds: request.assetIds,
        targetFolderId: request.targetFolderId,
        conflictStrategy: request.conflictStrategy,
      };
    case "asset.restore-preview.request":
      return {
        type: "asset.restore-preview",
        libraryId: request.libraryId,
        assetIds: request.assetIds,
        targetFolderId: request.targetFolderId,
      };
    case "asset.move.request":
      return {
        type: "asset.move",
        libraryId: request.libraryId,
        assetIds: request.assetIds,
        targetFolderId: request.targetFolderId,
        conflictStrategy: request.conflictStrategy,
      };
    case "asset.move-undo.request":
      return {
        type: "asset.move-undo",
        libraryId: request.libraryId,
        operationId: request.operationId,
        conflictStrategy: request.conflictStrategy,
      };
    case "asset.copy.request":
      return {
        type: "asset.copy",
        libraryId: request.libraryId,
        assetIds: request.assetIds,
        targetFolderId: request.targetFolderId,
        conflictStrategy: request.conflictStrategy,
      };
    case "asset.copy-undo.request":
      return {
        type: "asset.copy-undo",
        libraryId: request.libraryId,
        operationId: request.operationId,
        conflictStrategy: request.conflictStrategy,
      };
    case "asset.rename-file.request":
      return {
        type: "asset.rename-file",
        libraryId: request.libraryId,
        assetId: request.assetId,
        newBaseName: request.newBaseName,
      };
    case "asset.text.read.request":
      return {
        type: "asset.text.read",
        libraryId: request.libraryId,
        assetId: request.assetId,
        maxBytes: request.maxBytes,
      };
    case "asset.text.save.request":
      return {
        type: "asset.text.save",
        libraryId: request.libraryId,
        assetId: request.assetId,
        content: request.content,
        expectedRevisionId: request.expectedRevisionId,
        createRevision: request.createRevision,
      };
    case "asset.delete-permanent.request":
      return {
        type: "asset.delete-permanent",
        libraryId: request.libraryId,
        assetIds: request.assetIds,
      };
    case "asset.delete-from-disk.request":
      return {
        type: "asset.delete-from-disk",
        libraryId: request.libraryId,
        assetIds: request.assetIds,
      };
    case "trash.list.request":
      return { type: "asset.list-trash", libraryId: request.libraryId };
    case "trash.list-folders.request":
      return { type: "folder.list-trashed", libraryId: request.libraryId };
    case "trash.restore-folder.request":
      return {
        type: "folder.restore-trashed",
        libraryId: request.libraryId,
        tombstoneId: request.tombstoneId,
      };
    case "trash.purge.request":
      return { type: "asset.purge-trash", libraryId: request.libraryId };
    case "asset.delete-linked.request":
      return {
        type: "asset.delete-linked",
        libraryId: request.libraryId,
        assetIds: request.assetIds,
        deleteSourceFile: request.deleteSourceFile,
      };
    case "asset.relink.request": {
      const newAbsolutePath = await selectOpenFile(
        createNativeDialogHost(),
        "locateMissingAsset",
        process.env.SERPENT_E2E_RELINK_FILE,
      );
      return newAbsolutePath
        ? {
            type: "asset.relink",
            libraryId: request.libraryId,
            assetId: request.assetId,
            newAbsolutePath,
          }
        : undefined;
    }
    case "asset.relink-batch.preview-at-root.request": {
      return {
        type: "asset.relink-batch.preview",
        libraryId: request.libraryId,
        newRootPath: request.newRootPath,
      };
    }
    case "asset.relink-batch.request": {
      const newRootPath = await selectOpenDirectory(
        createNativeDialogHost(),
        "selectRelinkRoot",
        process.env.SERPENT_E2E_RELINK_ROOT,
      );
      if (newRootPath) {
        return {
          type: "asset.relink-batch.preview",
          libraryId: request.libraryId,
          newRootPath,
        };
      }
      return undefined;
    }
    case "asset.relink-batch.apply.request": {
      const newRootPath = pendingRelinkPreviews.consume(
        request.libraryId,
        request.previewId,
      );
      if (!newRootPath) return undefined;
      return {
        type: "asset.relink-batch.apply",
        libraryId: request.libraryId,
        newRootPath,
        keepMetadata: request.keepMetadata,
      };
    }
    case "asset.relink-batch.cancel.request":
      // Handled directly in handleLibraryRequest; no root path crosses to Worker.
      return undefined;
    case "library.export.request": {
      const host = createNativeDialogHost();
      const defaultExportName = libraryExportDefaultName(
        request.libraryName ?? "serpent-library-export",
        request.format,
      );
      // Windows 的保存对话框对文件名-only 的 defaultPath 不预填文件名
      // （electron#812：SetDefaultFolder vs SetFolder），macOS 特判可用——
      // 统一拼上 downloads 目录的完整路径，两平台都预填库名。
      const defaultExportPath = path.join(
        app.getPath("downloads"),
        defaultExportName,
      );
      const destinationPath =
        request.format === "zip"
          ? await selectSavePath(
              host,
              "exportZip",
              process.env.SERPENT_E2E_EXPORT_DEST_ZIP,
              {
                defaultPath: defaultExportPath,
                filters: [{ name: "ZIP", extensions: ["zip"] }],
              },
            )
          : await selectSavePath(
              host,
              "exportFolder",
              process.env.SERPENT_E2E_EXPORT_DEST,
              { defaultPath: defaultExportPath },
            );
      return destinationPath
        ? {
            type: "library.export",
            libraryId: request.libraryId,
            destinationPath,
            format: request.format,
            includeLinkedContent: request.includeLinkedContent,
          }
        : undefined;
    }
    case "library.export.cancel.request":
      return { type: "library.export-cancel", exportId: request.exportId };
    case "library.import.request": {
      const sourceFolderPath = await selectOpenDirectory(
        createNativeDialogHost(),
        "importLibraryFolder",
        process.env.SERPENT_E2E_IMPORT_SOURCE,
      );
      if (!sourceFolderPath) return undefined;
      // Store source path for later use in copy/in-place decision.
      const importId = `import-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      pendingImportSources.set(importId, sourceFolderPath);
      return { type: "library.import-validate", importId, sourceFolderPath };
    }
    case "library.import-zip.request": {
      const host = createNativeDialogHost();
      const sourceZipPath = await selectOpenFile(
        host,
        "importZip",
        process.env.SERPENT_E2E_IMPORT_SOURCE_ZIP,
        [{ name: "ZIP", extensions: ["zip"] }],
      );
      if (!sourceZipPath) return undefined;
      const destinationParentPath = await selectOpenDirectory(
        host,
        "importZipDestination",
        process.env.SERPENT_E2E_IMPORT_COPY_PARENT,
        { createDirectory: true },
      );
      if (!destinationParentPath) return undefined;
      return {
        type: "library.import-zip",
        sourceZipPath,
        destinationParentPath,
      };
    }
    case "library.import.cancel.request":
      return { type: "library.import-cancel", importId: request.importId };
    case "library.import.copy.request": {
      const importId = request.importId;
      const sourcePath = pendingImportSources.get(importId);
      if (!sourcePath) return undefined;
      const copyToParentPath = await selectOpenDirectory(
        createNativeDialogHost(),
        "importCopyDestination",
        process.env.SERPENT_E2E_IMPORT_COPY_PARENT,
        { createDirectory: true },
      );
      pendingImportSources.delete(importId);
      if (!copyToParentPath) return undefined;
      return {
        type: "library.import-folder",
        sourceFolderPath: sourcePath,
        copyToParentPath,
      };
    }
    case "library.import.open-in-place.request": {
      const importId = request.importId;
      const sourcePath = pendingImportSources.get(importId);
      if (!sourcePath) return undefined;
      pendingImportSources.delete(importId);
      return { type: "library.import-folder", sourceFolderPath: sourcePath };
    }
    case "ai.config.get.request":
    case "ai.config.set.request":
    case "ai.list-models.request":
      // Handled directly in handleLibraryRequest — should never reach here.
      return undefined;
    case "ai.test-connection.request": {
      // Resolve plaintext key in Main (safeStorage lives here). Pass ephemeral
      // plaintext to Worker on the private channel — same pattern as asset.analyze.
      // Do not re-encrypt for Worker: UtilityProcess cannot decrypt Main ciphertext.
      let apiKey = request.apiKey?.trim() ?? "";
      if (!apiKey) {
        try {
          apiKey = getDecryptedApiKey();
        } catch {
          return undefined;
        }
      }
      return {
        type: "ai.test-connection",
        apiFormat: request.apiFormat,
        model: request.model,
        apiKey,
        ...(request.baseUrl?.trim()
          ? { baseUrl: request.baseUrl.trim() }
          : {}),
      };
    }
    case "ai.clear-content.request":
      return {
        type: "ai.clear-content",
        libraryId: request.libraryId,
        scope: request.scope,
        confirm: request.confirm,
        ...(request.fields ? { fields: request.fields } : {}),
      };
    case "media.list-jobs.request":
      return { type: "media.list-jobs", libraryId: request.libraryId };
    case "plugin.list-jobs.request":
      return { type: "plugin.jobs.list", libraryId: request.libraryId };
    case "media.pause-jobs.request":
      return {
        type: "media.pause-jobs",
        libraryId: request.libraryId,
        jobIds: request.jobIds,
      };
    case "media.resume-jobs.request":
      return {
        type: "media.resume-jobs",
        libraryId: request.libraryId,
        jobIds: request.jobIds,
      };
    case "media.cancel-jobs.request":
      return {
        type: "media.cancel-jobs",
        libraryId: request.libraryId,
        jobIds: request.jobIds,
      };
    case "media.retry-jobs.request":
      return {
        type: "media.retry-jobs",
        libraryId: request.libraryId,
        jobIds: request.jobIds,
      };
    case "ai.pause-jobs.request":
      return {
        type: "ai.pause-jobs",
        libraryId: request.libraryId,
        jobIds: request.jobIds,
      };
    case "ai.resume-jobs.request":
      return {
        type: "ai.resume-jobs",
        libraryId: request.libraryId,
        jobIds: request.jobIds,
      };
    case "ai.cancel-jobs.request":
      return {
        type: "ai.cancel-jobs",
        libraryId: request.libraryId,
        jobIds: request.jobIds,
      };
    case "ai.retry-jobs.request":
      return {
        type: "ai.retry-jobs",
        libraryId: request.libraryId,
        jobIds: request.jobIds,
      };
    case "ai.status.request":
      return {
        type: "ai.status",
        libraryId: request.libraryId,
        ...(request.jobIds ? { jobIds: request.jobIds } : {}),
      };
    case "asset.analyze.request": {
      const config = loadAiConfig();
      if (!config.hasKey) return undefined; // Will be handled as error downstream.
      if (!config.apiFormat) return undefined;
      let apiKey: string;
      try {
        apiKey = getDecryptedApiKey();
      } catch {
        return undefined;
      }
      return {
        type: "asset.analyze",
        libraryId: request.libraryId,
        assetId: request.assetId,
        apiFormat: config.apiFormat,
        model: config.model,
        apiKey,
        ...(config.baseUrl.trim() ? { baseUrl: config.baseUrl.trim() } : {}),
        enabledFields: {
          description: config.descriptionEnabled,
          tags: config.tagEnabled,
          rating: config.ratingEnabled,
        },
        analysisSettings: toWireAiAnalysisSettings(config.analysisSettings),
        languages: config.languages,
        maxAnalysisImageEdgePx: config.maxAnalysisImageEdgePx,
      };
    }
    case "assets.analyze.request":
      // Handled before generic Worker-command dispatch because it atomically
      // enqueues the whole selected batch and starts the scheduler once.
      return undefined;
    case "ai.content.get.request":
      return {
        type: "ai.content.get",
        libraryId: request.libraryId,
        assetId: request.assetId,
      };
    case "asset.thumbnail.request":
      return {
        type: "media.generate-thumbnail",
        libraryId: request.libraryId,
        assetId: request.assetId,
      };
    case "model.resolve-companions.request":
      // Slice C (Serpent-qvc6): 3D viewer companion-texture index. The worker
      // command already exists (slice A); this is the renderer request bridge.
      return {
        type: "model.resolve-companions",
        libraryId: request.libraryId,
        assetId: request.assetId,
      };
    case "model.convert-fbx.request":
      // Slice C: FBX→GLB conversion (worker command from slice B). The
      // renderer routes `failed` results to the FBXLoader fallback.
      return {
        type: "model.convert-fbx",
        libraryId: request.libraryId,
        assetId: request.assetId,
      };
    case "asset.preview.request":
      // Handled directly in handleLibraryRequest because it requires constructing
      // a serpent:// URL after the Worker lookup.
      return {
        type: "media.get-preview-artifact",
        libraryId: request.libraryId,
        assetId: request.assetId,
        ...(request.intent === undefined ? {} : { intent: request.intent }),
        ...(request.exrPlane === undefined ? {} : { exrPlane: request.exrPlane }),
        ...(request.colorSpace === undefined ? {} : { colorSpace: request.colorSpace }),
      };
    case "asset.close-preview.request":
      // Preview close is a no-op on the Main side; renderer handles UI state.
      return undefined;
    case "asset.preview-error.report":
      // Main records this before command dispatch.
      return undefined;
    case "asset.open-external.request":
      // Handled directly in handleLibraryRequest because it requires shell.openPath.
      return {
        type: "media.get-asset-path",
        libraryId: request.libraryId,
        assetId: request.assetId,
      };
    case "asset.open-with.request":
      // Handled directly in handleLibraryRequest (macOS picker / Windows Open With).
      return {
        type: "media.get-asset-path",
        libraryId: request.libraryId,
        assetId: request.assetId,
      };
    case "asset.reveal-in-folder.request":
      // Handled directly in handleLibraryRequest because it requires shell.showItemInFolder.
      return {
        type: "media.get-asset-path",
        libraryId: request.libraryId,
        assetId: request.assetId,
      };
    case "asset.copy-file-path.request":
      // Handled directly in handleLibraryRequest because it requires clipboard.writeText.
      return {
        type: "media.get-asset-path",
        libraryId: request.libraryId,
        assetId: request.assetId,
      };
    case "asset.copy-files.request":
      // OS file clipboard (clarification #5); paths resolved then written in Main.
      return {
        type: "media.get-asset-paths",
        libraryId: request.libraryId,
        assetIds: request.assetIds,
      };
    case "asset.retry-artifact.request":
      return {
        type: "media.retry-artifact",
        libraryId: request.libraryId,
        assetId: request.assetId,
        kind: request.kind,
      };
    default:
      return assertNever(request);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Renderer request: ${String(value)}`);
}
async function handleLibraryRequest(input: unknown): Promise<RendererResult> {
  let operation: "create" | "open" | "import" | undefined;
  let clipboardStageDirectory: string | undefined;
  let relinkPreviewContext:
    | { libraryId: string; previewId: string }
    | undefined;
  try {
    const request = parseRendererRequest(input);

    if (request.type === "asset.import-drop-invalid.report") {
      logger?.error(
        "desktop-ingestion.drop-file-handle",
        new Error(
          "Electron could not resolve one or more dropped File handles.",
        ),
        { libraryId: request.libraryId },
      );
      return {
        ok: false,
        error: createPublicError("INVALID_DROP_SELECTION"),
      } satisfies RendererResult;
    }

    if (request.type === "asset.import-web-invalid.report") {
      logger?.error(
        "web-ingestion.drop-metadata",
        new Error(`Browser drag metadata was rejected: ${request.failure}.`),
        { libraryId: request.libraryId, failure: request.failure },
      );
      return {
        ok: false,
        error: createPublicError(request.failure),
      } satisfies RendererResult;
    }

    // The recent libraries store is Main-owned; listing never touches the Worker.
    if (request.type === "library.list-recent.request") {
      return {
        ok: true,
        type: "library.recent-list",
        libraries: readRecentLibraryEntries(recentLibraryPath(), (error) => {
          logger?.error("recent-library.read", error);
        }),
      } satisfies RendererResult;
    }

    if (request.type === "library.forget-recent.request") {
      if (!path.isAbsolute(request.libraryPath)) {
        return {
          ok: false,
          error: createPublicError("LIBRARY_NOT_FOUND"),
        } satisfies RendererResult;
      }
      removeRecentLibrary(recentLibraryPath(), request.libraryPath, (error) => {
        logger?.error("recent-library.forget", error);
      });
      return {
        ok: true,
        type: "library.forgotten",
        libraryPath: request.libraryPath,
      } satisfies RendererResult;
    }

    // A selected batch must be enqueued atomically. Sending one IPC request per
    // asset lets the first scheduler batch observe only one job and serializes
    // the entire operation despite a higher configured lane limit.
    if (request.type === "assets.analyze.request") {
      const config = loadAiConfig();
      if (!config.hasKey || !config.apiFormat) {
        return {
          ok: false,
          error: createPublicError("AI_ANALYSIS_FAILED", "AI_NOT_CONFIGURED"),
        } satisfies RendererResult;
      }
      try {
        getDecryptedApiKey();
      } catch {
        return {
          ok: false,
          error: createPublicError("AI_ANALYSIS_FAILED", "AI_NOT_CONFIGURED"),
        } satisfies RendererResult;
      }
      if (!workerClient) throw new Error("Library Worker is unavailable.");
      try {
        const enqueueResult = await workerClient.request({
          type: "ai.enqueue-analysis",
          libraryId: request.libraryId,
          assetIds: request.assetIds,
          resumePaused: true,
        });
        if (enqueueResult.ok && enqueueResult.type === "ai.jobs.enqueued") {
          const jobIds = [
            ...enqueueResult.jobIds,
            ...enqueueResult.alreadyPendingJobIds,
          ];
          if (jobIds.length > 0) {
            void processAiQueue(request.libraryId);
            return {
              ok: true,
              type: "assets.analyze-queued",
              assetIds: request.assetIds,
              jobIds,
              skippedAssetIds: enqueueResult.skippedAssetIds,
              enqueued: enqueueResult.enqueued,
            } satisfies RendererResult;
          }
        }
      } catch (error) {
        logger?.error("ai.analyze.batch-enqueue", error);
      }
      return {
        ok: false,
        error: createPublicError("AI_ANALYSIS_FAILED"),
      } satisfies RendererResult;
    }

    // Manual analyze: prefer the AI job queue so Renderer gets progress events
    // and the background-jobs panel updates. Fall through to sync analyze only
    // when the asset could not be queued (and is not already pending).
    if (request.type === "asset.analyze.request") {
      const config = loadAiConfig();
      if (!config.hasKey || !config.apiFormat) {
        return {
          ok: false,
          error: createPublicError("AI_ANALYSIS_FAILED", "AI_NOT_CONFIGURED"),
        } satisfies RendererResult;
      }
      try {
        getDecryptedApiKey();
      } catch {
        return {
          ok: false,
          error: createPublicError("AI_ANALYSIS_FAILED", "AI_NOT_CONFIGURED"),
        } satisfies RendererResult;
      }
      if (!workerClient) throw new Error("Library Worker is unavailable.");
      try {
        const enqueueResult = await workerClient.request({
          type: "ai.enqueue-analysis",
          libraryId: request.libraryId,
          assetIds: [request.assetId],
        });
        if (
          enqueueResult.ok &&
          enqueueResult.type === "ai.jobs.enqueued" &&
          enqueueResult.enqueued > 0
        ) {
          void processAiQueue(request.libraryId);
          return {
            ok: true,
            type: "asset.analyze-queued",
            assetId: request.assetId,
            enqueued: enqueueResult.enqueued,
          } satisfies RendererResult;
        }
        if (
          enqueueResult.ok &&
          enqueueResult.type === "ai.jobs.enqueued" &&
          enqueueResult.enqueued === 0
        ) {
          const statusResult = await workerClient.request({
            type: "ai.status",
            libraryId: request.libraryId,
          });
          const alreadyPending =
            statusResult.ok &&
            statusResult.type === "ai.jobs.status" &&
            statusResult.jobs.some(
              (job) =>
                job.assetId === request.assetId &&
                (job.status === "queued" ||
                  job.status === "running" ||
                  job.status === "paused"),
            );
          if (alreadyPending) {
            void processAiQueue(request.libraryId);
            return {
              ok: true,
              type: "asset.analyze-queued",
              assetId: request.assetId,
              enqueued: 1,
            } satisfies RendererResult;
          }
        }
      } catch (error) {
        logger?.error("ai.analyze.enqueue", error);
      }
      // Fall through to synchronous asset.analyze for eligibility errors.
    }

    // Handle AI config requests entirely in the main process — no Worker involved.
    if (request.type === "ai.config.get.request") {
      const config = loadAiConfig();
      return {
        ok: true,
        type: "ai.config.got",
        apiFormat: config.apiFormat,
        model: config.model,
        baseUrl: config.baseUrl ?? "",
        hasKey: config.hasKey,
        enabledFields: {
          description: config.descriptionEnabled,
          tags: config.tagEnabled,
          rating: config.ratingEnabled,
        },
        analysisSettings: toWireAiAnalysisSettings(config.analysisSettings),
        languages: config.languages,
        concurrencyLimit: config.concurrencyLimit,
        maxAnalysisImageEdgePx: config.maxAnalysisImageEdgePx,
        reliabilitySettings: config.reliabilitySettings,
        autoAnalyzeEnabled: config.autoAnalyzeEnabled,
        disclaimerAccepted: config.disclaimerAccepted,
      } satisfies RendererResult;
    }

    if (request.type === "ai.config.set.request") {
      const currentConfig = loadAiConfig();
      if (request.autoAnalyzeEnabled && !request.disclaimerAccepted) {
        return {
          ok: false,
          error: createPublicError("INVALID_IMPORT_DECISION"),
        } satisfies RendererResult;
      }
      if (!request.apiKey && !currentConfig.hasKey) {
        return {
          ok: false,
          error: createPublicError("INVALID_IMPORT_DECISION"),
        } satisfies RendererResult;
      }
      const savedConfig: AiConfig = {
        apiFormat: request.apiFormat,
        model: request.model,
        baseUrl: (request.baseUrl ?? "").trim(),
        descriptionEnabled: request.enabledFields?.description ?? true,
        tagEnabled: request.enabledFields?.tags ?? true,
        ratingEnabled: request.enabledFields?.rating ?? true,
        analysisSettings: normalizeAiAnalysisSettings({
          ...DEFAULT_AI_ANALYSIS_SETTINGS,
          ...request.analysisSettings,
          descriptionEnabled: request.enabledFields?.description ?? true,
          tagEnabled: request.enabledFields?.tags ?? true,
          ratingEnabled: request.enabledFields?.rating ?? true,
        }),
        concurrencyLimit: normalizeAiAnalysisConcurrency(
          request.concurrencyLimit ?? currentConfig.concurrencyLimit,
        ),
        maxAnalysisImageEdgePx: normalizeAiAnalysisImageEdgePx(
          request.maxAnalysisImageEdgePx ?? currentConfig.maxAnalysisImageEdgePx,
        ),
        // Retry policy remains durable but is no longer a user-facing setting.
        reliabilitySettings: request.reliabilitySettings
          ? normalizeAiReliabilitySettings(request.reliabilitySettings)
          : currentConfig.reliabilitySettings,
        languages: normalizeAiLanguages(
          request.languages ?? request.language ?? DEFAULT_AI_LANGUAGES,
        ),
        autoAnalyzeEnabled: request.autoAnalyzeEnabled,
        disclaimerAccepted: request.disclaimerAccepted,
      };
      saveAiConfig(savedConfig);
      if (request.apiKey) saveEncryptedApiKey(request.apiKey);
      if (workerClient) {
        try {
          const update = await workerClient.request({
            type: 'ai.set-concurrency-limit',
            concurrencyLimit: savedConfig.concurrencyLimit,
          });
          if (!update.ok || update.type !== 'ai.concurrency.updated') {
            logger?.error(
              'ai.config.concurrency-update',
              new Error('Library Worker did not acknowledge the AI concurrency update.'),
              { concurrencyLimit: savedConfig.concurrencyLimit },
            );
          }
        } catch (error) {
          // Saving stays durable even if the Worker is restarting. The next
          // queue batch always reapplies this value before dispatching work.
          logger?.error('ai.config.concurrency-update', error, {
            concurrencyLimit: savedConfig.concurrencyLimit,
          });
        }
      }
      return { ok: true, type: "ai.config.saved" } satisfies RendererResult;
    }

    if (request.type === "ai.test-connection.request") {
      // Resolve credentials here so a missing key returns AI_NOT_CONFIGURED
      // instead of the generic CANCELLED path from commandFor().
      let apiKey = request.apiKey?.trim() ?? "";
      if (!apiKey) {
        try {
          apiKey = getDecryptedApiKey();
        } catch {
          return {
            ok: false,
            error: createPublicError("AI_ANALYSIS_FAILED", "AI_NOT_CONFIGURED"),
          } satisfies RendererResult;
        }
      }
      if (!workerClient) throw new Error("Library Worker is unavailable.");
      const workerResult = await workerClient.request({
        type: "ai.test-connection",
        apiFormat: request.apiFormat,
        model: request.model,
        apiKey,
        ...(request.baseUrl?.trim()
          ? { baseUrl: request.baseUrl.trim() }
          : {}),
      });
      if (!workerResult.ok) {
        return {
          ok: false,
          error: workerResult.error,
        } satisfies RendererResult;
      }
      if (workerResult.type !== "ai.test-connection.result") {
        return {
          ok: false,
          error: createPublicError("AI_ANALYSIS_FAILED"),
        } satisfies RendererResult;
      }
      return {
        ok: true,
        type: "ai.test-connection.result",
        success: workerResult.success,
        ...(workerResult.errorKind
          ? { errorKind: workerResult.errorKind }
          : {}),
        ...(workerResult.reason ? { reason: workerResult.reason } : {}),
      } satisfies RendererResult;
    }

    if (request.type === "ai.list-models.request") {
      let apiKey = request.apiKey?.trim() ?? "";
      if (!apiKey) {
        try {
          apiKey = getDecryptedApiKey();
        } catch {
          return {
            ok: true,
            type: "ai.list-models.result",
            models: [],
            errorKind: "auth",
            reason: "API key is required to list models.",
          } satisfies RendererResult;
        }
      }
      const listed = await listAiModels({
        apiFormat: request.apiFormat,
        apiKey,
        baseUrl: request.baseUrl,
      });
      if (!listed.ok) {
        return {
          ok: true,
          type: "ai.list-models.result",
          models: [],
          errorKind: listed.errorKind,
          reason: listed.reason,
        } satisfies RendererResult;
      }
      return {
        ok: true,
        type: "ai.list-models.result",
        models: listed.models,
      } satisfies RendererResult;
    }

    if (request.type === "ai.search-plan.request") {
      const config = loadAiConfig();
      if (!config.hasKey || !config.disclaimerAccepted) {
        logger?.info(
          "ai.search-plan.unavailable",
          "AI search requires configured credentials and accepted disclosure.",
          {
            apiFormat: config.apiFormat,
            hasKey: config.hasKey,
            disclaimerAccepted: config.disclaimerAccepted,
          },
        );
        return {
          ok: false,
          error: createPublicError("AI_SEARCH_FAILED", "AI_NOT_CONFIGURED"),
        } satisfies RendererResult;
      }
      let apiKey: string;
      try {
        apiKey = getDecryptedApiKey();
      } catch (caught) {
        logger?.error("ai.search-plan.credentials", caught, {
          apiFormat: config.apiFormat,
        });
        return {
          ok: false,
          error: createPublicError("AI_SEARCH_FAILED", "AI_NOT_CONFIGURED"),
        } satisfies RendererResult;
      }
      try {
        const plan = await planAiSearch({
          apiFormat: config.apiFormat,
          model: config.model,
          apiKey,
          baseUrl: config.baseUrl,
          languages: config.languages,
          naturalQuery: request.naturalQuery,
        });
        logger?.info("ai.search-plan.completed", "AI search plan validated.", {
          apiFormat: config.apiFormat,
          model: config.model,
          keywordCount: plan.keywords.length,
          synonymCount: plan.synonyms.length,
          exclusionCount: plan.exclusions.length,
          filterCount: plan.filters.length,
        });
        return {
          ok: true,
          type: "ai.search-plan.result",
          plan,
          apiFormat: config.apiFormat,
          model: config.model,
        } satisfies RendererResult;
      } catch (caught) {
        const reason = aiSearchFailureReason(caught);
        logger?.error("ai.search-plan.failed", caught, {
          apiFormat: config.apiFormat,
          model: config.model,
          reason,
        });
        return {
          ok: false,
          error: createPublicError("AI_SEARCH_FAILED", reason),
        } satisfies RendererResult;
      }
    }

    if (request.type === "asset.close-preview.request") {
      return {
        ok: true,
        type: "asset.preview.closed",
        assetId: request.assetId,
      } satisfies RendererResult;
    }

    if (request.type === "asset.preview-error.report") {
      logger?.error(
        "media.preview.renderer",
        new Error(`Renderer media element reported ${request.errorCode}.`),
        {
          libraryId: request.libraryId,
          assetId: request.assetId,
          errorCode: request.errorCode,
          detail: request.detail,
        },
      );
      return {
        ok: true,
        type: "asset.preview-error.recorded",
        assetId: request.assetId,
      } satisfies RendererResult;
    }

    if (request.type === "asset.relink-batch.cancel.request") {
      pendingRelinkPreviews.cancel(request.libraryId, request.previewId);
      return {
        ok: true,
        type: "asset.relink-batch.cancelled",
        previewId: request.previewId,
      } satisfies RendererResult;
    }

    let command: WorkerCommand | undefined;
    if (request.type === "library.open-recent.request") {
      // The renderer may only reopen a library that Main itself recorded in the
      // recent libraries store — never an arbitrary path. This keeps the same
      // open-by-path pipeline the restart restore uses.
      const recentEntries = readRecentLibraryEntries(
        recentLibraryPath(),
        (error) => {
          logger?.error("recent-library.read", error);
        },
      );
      if (
        !path.isAbsolute(request.libraryPath) ||
        !recentEntries.some((entry) => entry.path === request.libraryPath)
      ) {
        return {
          ok: false,
          error: createPublicError("LIBRARY_NOT_FOUND"),
        } satisfies RendererResult;
      }
      command = {
        type: "library.open",
        selectedLibraryPath: request.libraryPath,
      };
    } else if (request.type === "asset.import-drop.request") {
      let sourceKind: "files" | "folder";
      try {
        sourceKind = classifyDroppedSourcePaths(request.sourcePaths);
      } catch (error) {
        logger?.error("desktop-ingestion.drop-selection", error, {
          sourceCount: request.sourcePaths.length,
        });
        const isSelectionShapeError =
          error instanceof Error && error.message === "INVALID_DROP_SELECTION";
        return {
          ok: false,
          error: isSelectionShapeError
            ? createPublicError("INVALID_DROP_SELECTION")
            : createPublicError(
                "INVALID_IMPORT_SOURCE",
                publicReasonFromError(error),
              ),
        } satisfies RendererResult;
      }
      const e2eAutoExpand =
        !app.isPackaged && process.env.SERPENT_E2E === "1";
      if (
        sourceKind === "files" &&
        !request.imageSequenceDecision &&
        !e2eAutoExpand
      ) {
        if (!workerClient) throw new Error("Library Worker is unavailable.");
        const probeResult = await workerClient.request({
          type: "asset.import.probe-sequences",
          libraryId: request.libraryId,
          targetFolderId: request.targetFolderId,
          targetCollectionId: request.targetCollectionId,
          sourcePaths: request.sourcePaths,
        });
        if (!probeResult.ok) {
          return {
            ok: false,
            error: probeResult.error,
          } satisfies RendererResult;
        }
        if (
          probeResult.type === "asset.import.sequence-offer" &&
          probeResult.offer.sequences.length > 0
        ) {
          return {
            ok: true,
            type: "asset.import.sequence-offer",
            offer: rememberImageSequenceOffer(probeResult.offer),
          } satisfies RendererResult;
        }
        command = {
          type: "asset.import.prepare",
          libraryId: request.libraryId,
          targetFolderId: request.targetFolderId,
          sourceKind,
          sourcePaths: request.sourcePaths,
          expandImageSequences: false,
          createImageSequence: false,
        };
      } else if (
        sourceKind === "files" &&
        request.imageSequenceDecision?.action === "import-sequence"
      ) {
        if (!workerClient) throw new Error("Library Worker is unavailable.");
        const probeResult = await workerClient.request({
          type: "asset.import.probe-sequences",
          libraryId: request.libraryId,
          targetFolderId: request.targetFolderId,
          targetCollectionId: request.targetCollectionId,
          sourcePaths: request.sourcePaths,
        });
        if (!probeResult.ok) {
          return {
            ok: false,
            error: probeResult.error,
          } satisfies RendererResult;
        }
        if (
          probeResult.type !== "asset.import.sequence-offer" ||
          probeResult.offer.sequences.length === 0
        ) {
          command = {
            type: "asset.import.prepare",
            libraryId: request.libraryId,
            targetFolderId: request.targetFolderId,
            sourceKind,
            sourcePaths: request.sourcePaths,
            expandImageSequences: false,
          };
        } else {
          const sequenceIndex = request.imageSequenceDecision.sequenceIndex ?? 0;
          const sequence =
            probeResult.offer.sequences[sequenceIndex] ??
            probeResult.offer.sequences[0]!;
          const firstFrame =
            request.imageSequenceDecision.firstFrame ?? sequence.firstFrame;
          const lastFrame =
            request.imageSequenceDecision.lastFrame ?? sequence.lastFrame;
          const rangedPaths: string[] = [];
          const framePaths = sequence.framePaths ?? [];
          for (let index = 0; index < framePaths.length; index += 1) {
            const frameNumber = sequence.firstFrame + index;
            if (frameNumber < firstFrame || frameNumber > lastFrame) continue;
            rangedPaths.push(framePaths[index]!);
          }
          command = {
            type: "asset.import.prepare",
            libraryId: request.libraryId,
            targetFolderId: request.targetFolderId,
            sourceKind: "files",
            sourcePaths:
              request.imageSequenceDecision.applyToRest
                ? request.sourcePaths
                : rangedPaths.length >= 3
                  ? rangedPaths
                  : framePaths,
            expandImageSequences: false,
            createImageSequence: true,
            imageSequenceFps:
              request.imageSequenceDecision.fps ??
              probeResult.offer.defaultFps,
          };
        }
      } else {
        command = {
          type: "asset.import.prepare",
          libraryId: request.libraryId,
          targetFolderId: request.targetFolderId,
          sourceKind,
          sourcePaths: request.sourcePaths,
          expandImageSequences: e2eAutoExpand && sourceKind === "files",
          ...(sourceKind === "files" && !e2eAutoExpand
            ? { createImageSequence: false }
            : {}),
          imageSequenceFps: e2eAutoExpand ? 30 : undefined,
        };
      }
    } else if (request.type === "asset.import-sequence.confirm") {
      const pending = pendingImageSequenceOffers.get(request.offerId);
      if (!pending || pending.expiresAt <= Date.now()) {
        pendingImageSequenceOffers.delete(request.offerId);
        return {
          ok: false,
          error: createPublicError("IMPORT_NOT_FOUND"),
        } satisfies RendererResult;
      }
      if (pending.offer.libraryId !== request.libraryId) {
        return {
          ok: false,
          error: createPublicError("IMPORT_NOT_FOUND"),
        } satisfies RendererResult;
      }
      const stored = pending.offer;
      const sequenceIndex = request.sequenceIndex ?? pending.nextSequenceIndex;
      if (sequenceIndex !== pending.nextSequenceIndex) {
        return {
          ok: false,
          error: createPublicError("INVALID_IMPORT_DECISION"),
        } satisfies RendererResult;
      }
      const sequence = stored.sequences[sequenceIndex];
      const decision = resolveImageSequenceImportPaths({
        action: request.action,
        applyToRest: request.applyToRest === true,
        firstFrame: request.firstFrame ?? sequence?.firstFrame ?? 0,
        lastFrame: request.lastFrame ?? sequence?.lastFrame ?? 0,
        offer: stored,
        sequenceIndex,
      });
      if (decision.sourcePaths.length === 0) {
        return {
          ok: false,
          error: createPublicError("INVALID_IMPORT_DECISION"),
        } satisfies RendererResult;
      }
      command = {
        type: "asset.import.prepare",
        libraryId: request.libraryId,
        targetFolderId: stored.targetFolderId,
        sourceKind: "files",
        sourcePaths: decision.sourcePaths,
        expandImageSequences: false,
        createImageSequence: decision.createImageSequence,
        ...(decision.createImageSequence
          ? { imageSequenceFps: request.fps ?? stored.defaultFps }
          : {}),
      };
      if (decision.nextSequenceIndex === null) {
        pendingImageSequenceOffers.delete(request.offerId);
      } else {
        pending.nextSequenceIndex = decision.nextSequenceIndex;
      }
    } else if (request.type === "asset.import-clipboard.request") {
      let image;
      try {
        image =
          !app.isPackaged &&
          process.env.SERPENT_E2E === "1" &&
          process.env.SERPENT_E2E_CLIPBOARD_IMAGE_PATH
            ? nativeImage.createFromBuffer(
                readFileSync(process.env.SERPENT_E2E_CLIPBOARD_IMAGE_PATH),
              )
            : clipboard.readImage();
        const injectedNow =
          !app.isPackaged &&
          process.env.SERPENT_E2E === "1" &&
          process.env.SERPENT_E2E_CLIPBOARD_NOW
            ? new Date(process.env.SERPENT_E2E_CLIPBOARD_NOW)
            : new Date();
        const staged = stageClipboardImage(
          image,
          app.getPath("temp"),
          injectedNow,
        );
        clipboardStageDirectory = staged.directoryPath;
        command = {
          type: "asset.import.prepare",
          libraryId: request.libraryId,
          targetFolderId: request.targetFolderId,
          sourceKind: "files",
          sourcePaths: [staged.filePath],
        };
      } catch (error) {
        logger?.error("desktop-ingestion.clipboard-stage", error);
        const code =
          error instanceof Error &&
          error.message === "CLIPBOARD_IMAGE_NOT_FOUND"
            ? "CLIPBOARD_IMAGE_NOT_FOUND"
            : "INVALID_IMPORT_SOURCE";
        return {
          ok: false,
          error: createPublicError(
            code,
            code === "INVALID_IMPORT_SOURCE"
              ? publicReasonFromError(error)
              : undefined,
          ),
        } satisfies RendererResult;
      }
    } else if (request.type === "folder.paste.request") {
      try {
        const injectedPaths =
          !app.isPackaged &&
          process.env.SERPENT_E2E === "1" &&
          process.env.SERPENT_E2E_CLIPBOARD_FILE_PATHS
            ? process.env.SERPENT_E2E_CLIPBOARD_FILE_PATHS.split("\n").filter(
                Boolean,
              )
            : null;
        const sourcePaths =
          injectedPaths ??
          readFilePathsFromClipboard(createFileClipboardDeps());
        if (sourcePaths.length === 0) {
          return {
            ok: false,
            error: createPublicError("CLIPBOARD_FILES_NOT_FOUND"),
          } satisfies RendererResult;
        }
        const sourceKind = classifyDroppedSourcePaths(sourcePaths);
        command = {
          type: "asset.import.prepare",
          libraryId: request.libraryId,
          targetFolderId: request.folderId ?? undefined,
          sourceKind,
          sourcePaths,
          // Paste must never auto-group into an image sequence. Users expect
          // ordinary import + name/content conflict dialogs (PASTE-001).
          expandImageSequences: false,
          createImageSequence: false,
        };
      } catch (error) {
        logger?.error("desktop-ingestion.clipboard-files", error);
        const isSelectionShapeError =
          error instanceof Error && error.message === "INVALID_DROP_SELECTION";
        return {
          ok: false,
          error: isSelectionShapeError
            ? createPublicError("INVALID_DROP_SELECTION")
            : createPublicError(
                "INVALID_IMPORT_SOURCE",
                publicReasonFromError(error),
              ),
        } satisfies RendererResult;
      }
    } else {
      command = await commandFor(request);
    }
    if (!command) return cancelled();
    if (
      command.type === "asset.import.prepare" &&
      command.sourceKind === "files" &&
      command.expandImageSequences !== true &&
      request.type !== "asset.import-drop.request" &&
      request.type !== "asset.import-sequence.confirm" &&
      // Clipboard paste into a folder must keep ordinary conflict flows
      // (name-conflict / content-duplicate). Sequence probing here wrongly
      // offered a sequence dialog when pasting a single copied image
      // (PASTE-001 / Serpent-el2g).
      request.type !== "folder.paste.request" &&
      !(
        !app.isPackaged &&
        process.env.SERPENT_E2E === "1"
      )
    ) {
      if (!workerClient) throw new Error("Library Worker is unavailable.");
      const probeResult = await workerClient.request({
        type: "asset.import.probe-sequences",
        libraryId: command.libraryId,
        targetFolderId: command.targetFolderId,
        sourcePaths: command.sourcePaths,
      });
      if (!probeResult.ok) {
        return {
          ok: false,
          error: probeResult.error,
        } satisfies RendererResult;
      }
      if (
        probeResult.type === "asset.import.sequence-offer" &&
        probeResult.offer.sequences.length > 0
      ) {
        return {
          ok: true,
          type: "asset.import.sequence-offer",
          offer: rememberImageSequenceOffer(probeResult.offer),
        } satisfies RendererResult;
      }
      // The explicit normal-file path must not run the legacy post-import
      // sequence detector. Folder imports and automation calls that opt into
      // expansion keep the existing behavior above.
      command = { ...command, createImageSequence: false };
    }
    if (
      (request.type === "asset.relink-batch.request" ||
        request.type === "asset.relink-batch.preview-at-root.request") &&
      command.type === "asset.relink-batch.preview"
    ) {
      const previewId = pendingRelinkPreviews.create(
        request.libraryId,
        command.newRootPath,
      );
      relinkPreviewContext = { libraryId: request.libraryId, previewId };
    }
    if (!workerClient) throw new Error("Library Worker is unavailable.");
    if (command.type === "library.create") operation = "create";
    if (command.type === "library.open") operation = "open";
    if (
      command.type === "library.import-folder" ||
      command.type === "library.import-zip"
    )
      operation = "import";
    if (operation) publishLifecycle({ type: "library.opening", operation });

    const workerResult = await workerClient.request(command);

    if (!workerResult.ok && relinkPreviewContext) {
      pendingRelinkPreviews.cancel(
        relinkPreviewContext.libraryId,
        relinkPreviewContext.previewId,
      );
    }

    if (workerResult.ok && workerResult.type === "library.opened") {
      rememberOpenedLibrary(
        workerResult.library.libraryPath,
        workerResult.library.displayName,
      );
    } else if (workerResult.ok && workerResult.type === "library.renamed") {
      rememberOpenedLibrary(
        workerResult.library.libraryPath,
        workerResult.library.displayName,
      );
    } else if (workerResult.ok && workerResult.type === "library.imported") {
      rememberOpenedLibrary(workerResult.libraryPath, workerResult.displayName);
    } else if (workerResult.ok && workerResult.type === "library.deleted") {
      removeRecentLibrary(
        recentLibraryPath(),
        workerResult.libraryPath,
        (error) => {
          logger?.error("recent-library.remove", error);
        },
      );
    }

    if (!workerResult.ok && request.type === "asset.import-web.request") {
      logger?.error(
        "web-ingestion.download",
        new Error(
          `Library Worker rejected the browser media import: ${workerResult.error.code}.`,
        ),
        {
          libraryId: request.libraryId,
          targetFolderId: request.targetFolderId,
          targetCollectionId: request.targetCollectionId,
          code: workerResult.error.code,
          reason: workerResult.error.reason,
        },
      );
    }

    if (!workerResult.ok && request.type === "asset.import.resolve") {
      pendingImportLibraries.delete(request.importId);
      pendingImportCollections.delete(request.importId);
    }
    if (workerResult.ok && request.type === "library.close.request") {
      pendingRelinkPreviews.clearLibrary(request.libraryId);
      for (const [importId, libraryId] of pendingImportLibraries) {
        if (libraryId !== request.libraryId) continue;
        pendingImportLibraries.delete(importId);
        pendingImportCollections.delete(importId);
      }
    }
    if (workerResult.ok && request.type === "library.delete-from-disk.request") {
      pendingRelinkPreviews.clearLibrary(request.libraryId);
      for (const [importId, libraryId] of pendingImportLibraries) {
        if (libraryId !== request.libraryId) continue;
        pendingImportLibraries.delete(importId);
        pendingImportCollections.delete(importId);
      }
    }

    if (
      workerResult.ok &&
      (request.type === "ai.resume-jobs.request" ||
        request.type === "ai.retry-jobs.request")
    ) {
      void processAiQueue(request.libraryId);
    }
    if (
      workerResult.ok &&
      (workerResult.type === "library.opened" ||
        workerResult.type === "library.imported")
    ) {
      const openedLibraryId =
        workerResult.type === "library.opened"
          ? workerResult.library.libraryId
          : workerResult.libraryId;
      const openedLibraryPath =
        workerResult.type === "library.opened"
          ? workerResult.library.libraryPath
          : workerResult.libraryPath;
      notifyLibraryOpenedSideEffects({
        libraryId: openedLibraryId,
        libraryDirectory: openedLibraryPath,
      }).catch((error) => {
        logger?.error("plugin.activation.library-opened", error, {
          libraryId: openedLibraryId,
        });
      });
    }
    if (workerResult.ok && workerResult.type === "library.closed") {
      pluginActivationCoordinator?.onLibraryClosed(workerResult.libraryId);
      for (const [executionId, context] of pluginAutomationContexts) {
        if (context.libraryId === workerResult.libraryId) {
          pluginAutomationContexts.delete(executionId);
        }
      }
    }

    // Post-process preview and open-external requests
    if (
      workerResult.ok &&
      request.type === "asset.preview.request" &&
      workerResult.type === "media.preview-artifact"
    ) {
      const url =
        workerResult.status === "ready"
          ? workerResult.playbackMode === "source" &&
            workerResult.sourceRevisionId
            ? `serpent://source/${request.libraryId}/${request.assetId}?revision=${encodeURIComponent(workerResult.sourceRevisionId)}`
            : workerResult.artifactId
              ? `serpent://${workerResult.playbackMode === "proxy" ? "proxy" : "preview"}/${request.libraryId}/${workerResult.artifactId}`
              : undefined
          : undefined;
      const posterUrl = workerResult.posterArtifactId
        ? `serpent://preview/${request.libraryId}/${workerResult.posterArtifactId}`
        : undefined;
      if (
        workerResult.status === "failed" ||
        workerResult.status === "missing"
      ) {
        logger?.info("media.preview.unavailable", "Preview is not available.", {
          assetId: request.assetId,
          status: workerResult.status,
          errorCode: workerResult.errorCode,
        });
      }
      return {
        ok: true,
        type: "asset.preview.resolved",
        assetId: request.assetId,
        mediaType: workerResult.mediaType,
        status: workerResult.status,
        kind: workerResult.kind,
        ...(url ? { url } : {}),
        ...(posterUrl ? { posterUrl } : {}),
        ...(workerResult.errorCode
          ? { errorCode: workerResult.errorCode }
          : {}),
        ...(workerResult.playbackMode
          ? { playbackMode: workerResult.playbackMode }
          : {}),
        ...(workerResult.sourceMimeType
          ? { sourceMimeType: workerResult.sourceMimeType }
          : {}),
        ...(workerResult.sourceContainer
          ? { sourceContainer: workerResult.sourceContainer }
          : {}),
        ...(workerResult.sourceCodecs
          ? { sourceCodecs: workerResult.sourceCodecs }
          : {}),
        ...(workerResult.sourceRevisionId
          ? {
              playbackToken: `${request.assetId}:${workerResult.sourceRevisionId}`,
            }
          : {}),
        ...(workerResult.exrPlanes ? { exrPlanes: workerResult.exrPlanes } : {}),
        ...(workerResult.selectedExrPlane === undefined
          ? {}
          : { selectedExrPlane: workerResult.selectedExrPlane }),
        ...(workerResult.colorSpace ? { colorSpace: workerResult.colorSpace } : {}),
      } satisfies RendererResult;
    }
    if (
      workerResult.ok &&
      request.type === "asset.open-external.request" &&
      workerResult.type === "media.asset-path"
    ) {
      try {
        const openError = await shell.openPath(workerResult.absolutePath);
        if (openError) {
          return {
            ok: false,
            error: createPublicError("INTERNAL_ERROR"),
          } satisfies RendererResult;
        }
        return {
          ok: true,
          type: "asset.open-external.requested",
          assetId: request.assetId,
        } satisfies RendererResult;
      } catch (error) {
        logger?.error("main.open-external", error);
        return {
          ok: false,
          error: createPublicError("INTERNAL_ERROR"),
        } satisfies RendererResult;
      }
    }
    if (
      workerResult.ok &&
      request.type === "asset.open-with.request" &&
      workerResult.type === "media.asset-path"
    ) {
      const outcome = await openPathWithOtherApplication(
        workerResult.absolutePath,
        createOpenWithDeps(appLocale, () => mainWindow ?? null),
      );
      if (outcome === "failed") {
        logger?.error("main.open-with", new Error("open-with failed"));
        return {
          ok: false,
          error: createPublicError("INTERNAL_ERROR"),
        } satisfies RendererResult;
      }
      // cancelled → quiet ok (no toast); opened → quiet ok.
      return {
        ok: true,
        type: "asset.open-with.requested",
        assetId: request.assetId,
      } satisfies RendererResult;
    }
    if (
      workerResult.ok &&
      request.type === "asset.reveal-in-folder.request" &&
      workerResult.type === "media.asset-path"
    ) {
      try {
        shell.showItemInFolder(workerResult.absolutePath);
        return {
          ok: true,
          type: "asset.reveal-in-folder.requested",
          assetId: request.assetId,
        } satisfies RendererResult;
      } catch (error) {
        logger?.error("main.reveal-in-folder", error);
        return {
          ok: false,
          error: createPublicError("INTERNAL_ERROR"),
        } satisfies RendererResult;
      }
    }
    if (
      workerResult.ok &&
      request.type === "asset.copy-file-path.request" &&
      workerResult.type === "media.asset-path"
    ) {
      try {
        clipboard.writeText(workerResult.absolutePath);
        return {
          ok: true,
          type: "asset.copy-file-path.requested",
          assetId: request.assetId,
        } satisfies RendererResult;
      } catch (error) {
        logger?.error("main.copy-file-path", error);
        return {
          ok: false,
          error: createPublicError("INTERNAL_ERROR"),
        } satisfies RendererResult;
      }
    }
    if (
      workerResult.ok &&
      request.type === "asset.copy-files.request" &&
      workerResult.type === "media.asset-paths"
    ) {
      try {
        const wrote = writeFilePathsToClipboard(
          workerResult.absolutePaths,
          createFileClipboardDeps(),
        );
        if (!wrote) {
          return {
            ok: false,
            error: createPublicError("INTERNAL_ERROR"),
          } satisfies RendererResult;
        }
        return {
          ok: true,
          type: "asset.copy-files.requested",
          assetIds: workerResult.assetIds,
        } satisfies RendererResult;
      } catch (error) {
        logger?.error("main.copy-asset-files", error);
        return {
          ok: false,
          error: createPublicError("INTERNAL_ERROR"),
        } satisfies RendererResult;
      }
    }
    if (
      workerResult.ok &&
      request.type === "folder.open-in-file-manager.request" &&
      workerResult.type === "folder.path"
    ) {
      try {
        const openError = await shell.openPath(workerResult.absolutePath);
        if (openError) {
          return {
            ok: false,
            error: createPublicError("INTERNAL_ERROR"),
          } satisfies RendererResult;
        }
        return {
          ok: true,
          type: "folder.open-in-file-manager.requested",
          folderId: request.folderId,
        } satisfies RendererResult;
      } catch (error) {
        logger?.error("main.open-folder-in-file-manager", error);
        return {
          ok: false,
          error: createPublicError("INTERNAL_ERROR"),
        } satisfies RendererResult;
      }
    }
    if (
      workerResult.ok &&
      request.type === "folder.open-with.request" &&
      workerResult.type === "folder.path"
    ) {
      const outcome = await openPathWithOtherApplication(
        workerResult.absolutePath,
        createOpenWithDeps(appLocale, () => mainWindow ?? null),
      );
      if (outcome === "failed") {
        logger?.error("main.folder-open-with", new Error("open-with failed"));
        return {
          ok: false,
          error: createPublicError("INTERNAL_ERROR"),
        } satisfies RendererResult;
      }
      return {
        ok: true,
        type: "folder.open-with.requested",
        folderId: request.folderId,
      } satisfies RendererResult;
    }
    if (
      workerResult.ok &&
      request.type === "folder.copy-path.request" &&
      workerResult.type === "folder.path"
    ) {
      try {
        clipboard.writeText(workerResult.absolutePath);
        return {
          ok: true,
          type: "folder.copy-path.requested",
          folderId: request.folderId,
        } satisfies RendererResult;
      } catch (error) {
        logger?.error("main.copy-folder-path", error);
        return {
          ok: false,
          error: createPublicError("INTERNAL_ERROR"),
        } satisfies RendererResult;
      }
    }
    if (
      workerResult.ok &&
      request.type === "folder.copy.request" &&
      workerResult.type === "folder.path"
    ) {
      try {
        const wrote = writeFilePathsToClipboard(
          [workerResult.absolutePath],
          createFileClipboardDeps(),
        );
        if (!wrote) {
          return {
            ok: false,
            error: createPublicError("INTERNAL_ERROR"),
          } satisfies RendererResult;
        }
        return {
          ok: true,
          type: "folder.copy.requested",
          folderId: request.folderId,
        } satisfies RendererResult;
      } catch (error) {
        logger?.error("main.copy-folder-files", error);
        return {
          ok: false,
          error: createPublicError("INTERNAL_ERROR"),
        } satisfies RendererResult;
      }
    }
    if (
      workerResult.ok &&
      request.type === "asset.retry-artifact.request" &&
      workerResult.type === "media.retry-artifact.queued"
    ) {
      return {
        ok: true,
        type: "asset.retry-artifact.started",
        assetId: workerResult.assetId,
        kind: request.kind,
      } satisfies RendererResult;
    }
    if (
      workerResult.ok &&
      request.type === "asset.thumbnail.request" &&
      workerResult.type === "media.thumbnail.generated"
    ) {
      return {
        ok: true,
        type: "asset.thumbnail.generated",
        assetId: workerResult.assetId,
        artifactId: workerResult.artifactId,
      } satisfies RendererResult;
    }

    // Auto-analyze on import: after a successful import (resolveImport or
    // importFolderAsLinked), enqueue AI analysis for imported images.
    //
    // Track importId -> libraryId mapping for resolve flows where libraryId
    // is not carried in the resolve request itself.
    if (workerResult.ok && workerResult.type === "asset.import.conflicts") {
      pendingImportLibraries.set(
        workerResult.plan.importId,
        (request as { libraryId?: string }).libraryId ?? "",
      );
      if (
        (request.type === "asset.import-drop.request" ||
          request.type === "asset.import-clipboard.request") &&
        request.targetCollectionId
      ) {
        pendingImportCollections.set(
          workerResult.plan.importId,
          request.targetCollectionId,
        );
      }
    }

    if (request.type === "asset.import.abandon") {
      pendingImportCollections.delete(request.importId);
    }

    if (workerResult.ok && workerResult.type === "asset.import.completed") {
      const collectionId =
        request.type === "asset.import.resolve"
          ? pendingImportCollections.get(request.importId)
          : request.type === "asset.import-drop.request" ||
              request.type === "asset.import-clipboard.request"
            ? request.targetCollectionId
            : undefined;
      if (request.type === "asset.import.resolve")
        pendingImportCollections.delete(request.importId);
      if (collectionId && workerResult.completion.assets.length > 0) {
        const importLibraryId =
          request.type === "asset.import.resolve"
            ? pendingImportLibraries.get(request.importId)
            : request.type === "asset.import-drop.request" ||
                request.type === "asset.import-clipboard.request"
              ? request.libraryId
              : undefined;
        if (!importLibraryId) {
          logger?.error(
            "desktop-ingestion.collection-assign",
            new Error("The import library context was not found."),
            {
              collectionId,
              importedCount: workerResult.completion.assets.length,
            },
          );
          return {
            ok: false,
            error: createPublicError("IMPORT_COLLECTION_ASSIGN_FAILED"),
          } satisfies RendererResult;
        }
        const relationResult = await workerClient.request({
          type: "collection.assets.add",
          libraryId: importLibraryId,
          collectionId,
          assetIds: workerResult.completion.assets.map(
            (asset) => asset.assetId,
          ),
        });
        if (
          !relationResult.ok ||
          relationResult.type !== "collection.assets.added"
        ) {
          logger?.error(
            "desktop-ingestion.collection-assign",
            new Error(
              "Imported assets could not be assigned to the collection.",
            ),
            {
              collectionId,
              importedCount: workerResult.completion.assets.length,
              code: relationResult.ok
                ? "UNEXPECTED_RESULT"
                : relationResult.error.code,
              reason: relationResult.ok
                ? undefined
                : relationResult.error.reason,
            },
          );
          if (request.type === "asset.import.resolve")
            pendingImportLibraries.delete(request.importId);
          return {
            ok: false,
            error: createPublicError("IMPORT_COLLECTION_ASSIGN_FAILED"),
          } satisfies RendererResult;
        }
      }
    }

    if (
      workerResult.ok &&
      workerResult.type === "extension.asset-saved" &&
      request.type === "asset.import-web.request" &&
      request.targetCollectionId
    ) {
      const relationCommand = createWebImportCollectionCommand(
        request,
        workerResult.asset.assetId,
      )!;
      const relationResult = await workerClient.request(relationCommand);
      if (
        !relationResult.ok ||
        relationResult.type !== "collection.assets.added"
      ) {
        logger?.error(
          "web-ingestion.collection-assign",
          new Error(
            "Downloaded browser media could not be assigned to the collection.",
          ),
          {
            libraryId: request.libraryId,
            collectionId: request.targetCollectionId,
            assetId: workerResult.asset.assetId,
            code: relationResult.ok
              ? "UNEXPECTED_RESULT"
              : relationResult.error.code,
            reason: relationResult.ok ? undefined : relationResult.error.reason,
          },
        );
        return {
          ok: false,
          error: createPublicError("IMPORT_COLLECTION_ASSIGN_FAILED"),
        } satisfies RendererResult;
      }
    }

    if (
      workerResult.ok &&
      (workerResult.type === "asset.import.completed" ||
        workerResult.type === "asset.import-linked.completed")
    ) {
      let assetIds: string[] = [];
      let libId: string | undefined;
      let importedFolderId: string | undefined;

      if (workerResult.type === "asset.import.completed") {
        assetIds = workerResult.completion.assets.map((a) => a.assetId);
        // libId from original request or from pending import tracker
        if (
          request.type === "asset.import-files.request" ||
          request.type === "asset.import-folder.request" ||
          request.type === "asset.import-drop.request" ||
          request.type === "asset.import-clipboard.request"
        ) {
          libId = request.libraryId;
        } else if (request.type === "asset.import.resolve") {
          libId = pendingImportLibraries.get(request.importId);
          pendingImportLibraries.delete(request.importId);
        }
      } else {
        // import-linked has libraryId in the request
        if (request.type === "asset.import-linked.request") {
          libId = request.libraryId;
          importedFolderId = workerResult.linkedFolder.folderId;
        }
      }

      if (libId && (assetIds.length > 0 || importedFolderId)) {
        void enqueueAutoAnalyzeAfterImport(libId, assetIds, importedFolderId);
      }
    }

    if (
      workerResult.ok &&
      workerResult.type === "extension.asset-saved" &&
      request.type === "asset.import-web.request"
    ) {
      void enqueueAutoAnalyzeAfterImport(request.libraryId, [
        workerResult.asset.assetId,
      ]);
    }

    const result = toRendererResult(
      workerResult,
      relinkPreviewContext?.previewId,
    );
    if (!result.ok) {
      if (operation) {
        publishLifecycle({
          type: "library.open-failed",
          operation,
          error: result.error,
        });
      }
      return result;
    }
    if (result.type === "library.opened") {
      publishLifecycle({ type: "library.opened", library: result.library });
    } else if (workerResult.ok && workerResult.type === "library.imported") {
      publishLifecycle({
        type: "library.opened",
        library: {
          libraryId: workerResult.libraryId,
          displayName: workerResult.displayName,
          displayPath: workerResult.libraryPath,
        },
      });
    } else if (result.type === "library.closed") {
      clearActiveRecentLibrary(recentLibraryPath(), (error) => {
        logger?.error("recent-library.clear", error);
      });
      publishLifecycle({ type: "library.closed", libraryId: result.libraryId });
    } else if (result.type === "library.deleted") {
      publishLifecycle({ type: "library.closed", libraryId: result.libraryId });
    }
    return result;
  } catch (error) {
    if (relinkPreviewContext) {
      pendingRelinkPreviews.cancel(
        relinkPreviewContext.libraryId,
        relinkPreviewContext.previewId,
      );
    }
    logger?.error("main.library-request", error);
    const publicError = toPublicError(error);
    if (operation) {
      publishLifecycle({
        type: "library.open-failed",
        operation,
        error: publicError,
      });
    }
    return { ok: false, error: publicError };
  } finally {
    if (clipboardStageDirectory) {
      try {
        cleanupClipboardImage(clipboardStageDirectory);
      } catch (error) {
        logger?.error("desktop-ingestion.clipboard-cleanup", error);
      }
    }
  }
}

async function confirmDesktopAutomationWrite(): Promise<boolean> {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  // Native modal dialogs are not controllable through Playwright. Restrict
  // this deterministic test seam to an unpackaged, isolated E2E process; it
  // can never be enabled by a shipped build or normal `npm start` session.
  if (!app.isPackaged
    && process.env.SERPENT_E2E === '1'
    && process.env.SERPENT_E2E_AUTOMATION_CONFIRM === '1') {
    return true;
  }
  const response = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['取消', '运行脚本'],
    defaultId: 1,
    cancelId: 0,
    title: '运行自动化脚本',
    message: '此脚本可以读取资产、标签与合集，修改评分与元数据，创建标签或空文件夹，整理合集，入队 AI 分析，复制文件路径，以及重命名或移入回收站。',
    detail: '脚本只会获得受限自动化能力；新建资源库和批量导入仍需单独的本机计划确认，不会获得网络下载、磁盘直读、数据库或永久删除权限。每次运行都会记录到应用日志。',
  });
  return response.response === 1;
}

let e2eAutomationFilePlanConfirmationCount = 0;

async function confirmDesktopAutomationFilePlan(plan: DesktopAutomationFilePlanSummary): Promise<boolean> {
  // See confirmDesktopAutomationWrite: this is an isolated, unpackaged E2E
  // seam only. Production builds always display the fresh plan confirmation.
  if (!app.isPackaged
    && process.env.SERPENT_E2E === '1'
    && process.env.SERPENT_E2E_AUTOMATION_CANCEL_ONCE === '1') {
    e2eAutomationFilePlanConfirmationCount += 1;
    if (e2eAutomationFilePlanConfirmationCount === 1) return false;
  }
  if (!app.isPackaged
    && process.env.SERPENT_E2E === '1'
    && process.env.SERPENT_E2E_AUTOMATION_CONFIRM === '1') {
    return true;
  }
  const action = plan.operation === 'trash'
    ? '移入回收站'
    : plan.operation === 'replace-content'
      ? '原地替换文件内容'
    : plan.operation === 'move'
      ? '移动到文件夹'
      : plan.operation === 'rename-file' || plan.operation === 'rename-files'
        ? '重命名文件'
        : plan.operation === 'import'
          ? '导入文件'
          : plan.operation === 'create'
            ? '创建资源库'
            : '恢复回原始位置';
  const dialogOptions: MessageBoxOptions = {
    type: 'warning',
    buttons: ['取消', `确认${action}`],
    defaultId: 1,
    cancelId: 0,
    title: '确认文件操作',
    message: `准备${action} ${plan.executableCount} 项资产。`,
    detail: [
      `本次选中 ${plan.targetCount} 项；${plan.blockedCount} 项因当前状态或冲突不会处理。`,
      ...(plan.conflictCount !== undefined && plan.conflictCount > 0
        ? [`其中 ${plan.conflictCount} 项检测到目标冲突。`]
        : []),
      plan.undoSupported
        ? '移入回收站后可在回收站中恢复。'
        : plan.operation === 'replace-content'
          ? '原文件字节将被覆盖，且无法通过回收站撤销。'
        : '执行前会再次确认这些资产没有变化。',
      ...(plan.hookWarnings !== undefined && plan.hookWarnings.length > 0
        ? [`插件提示：${plan.hookWarnings.join('；')}`]
        : []),
    ].join('\n'),
  };
  const response = mainWindow && !mainWindow.isDestroyed()
    ? await dialog.showMessageBox(mainWindow, dialogOptions)
    : await dialog.showMessageBox(dialogOptions);
  return response.response === 1;
}

async function confirmDesktopMcpAttach(input: {
  displayName: string;
  requestWriteAccess: boolean;
  clientName: string;
}): Promise<boolean> {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (
    !app.isPackaged
    && process.env.SERPENT_E2E === '1'
    && process.env.SERPENT_E2E_AUTOMATION_ATTACH_CONFIRM === '1'
  ) {
    return true;
  }

  const access = input.requestWriteAccess ? '读写能力' : '只读能力';
  const response = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['拒绝', '允许附着'],
    defaultId: 1,
    cancelId: 0,
    title: '允许 Agent 连接 Serpent',
    message: `Agent “${input.clientName}”请求连接资源库“${input.displayName}”。`,
    detail: `本次会话申请${access}。允许后，Agent 可以通过 Serpent 的受限自动化接口执行操作；不会获得任意文件系统、Shell、SQL 或网络权限。`,
  });
  return response.response === 1;
}

function applyDesktopAutomationSelection(
  libraryId: string,
  request: DesktopSelectionRequest,
): DesktopSelectionResult {
  const current = desktopAutomationSelections.get(libraryId) ?? [];
  const requested = [...new Set(request.assetIds)];
  let selectedAssetIds: string[];
  if (request.mode === 'replace') {
    selectedAssetIds = requested;
  } else if (request.mode === 'add') {
    selectedAssetIds = [...new Set([...current, ...requested])];
  } else {
    const removed = new Set(requested);
    selectedAssetIds = current.filter((assetId) => !removed.has(assetId));
  }
  desktopAutomationSelections.set(libraryId, selectedAssetIds);
  const primaryAssetId = selectedAssetIds.at(-1) ?? null;
  const window = mainWindow;
  if (window && !window.isDestroyed()) {
    window.webContents.send(DESKTOP_AUTOMATION_SELECTION_CHANNEL, {
      libraryId,
      assetIds: requested,
      mode: request.mode,
    });
  }
  return {
    libraryId,
    mode: request.mode,
    selectedAssetIds,
    primaryAssetId,
    ignoredAssetIds: [],
  };
}

async function startApplication(): Promise<void> {
  // Windows: taskbar/start-pin grouping requires the AppUserModelID to match
  // the shortcuts created by the installer (WiX/Squirrel both set one). Without
  // this, the taskbar shows the default Electron icon and pinning breaks.
  if (process.platform === "win32") {
    app.setAppUserModelId("com.serpent.app");
  }
  // Isolated E2E runs must not write the log into the real user profile
  // (~/Library/Logs/Serpent); pin it under the temp userData instead.
  if (process.env.SERPENT_E2E === "1" && process.env.SERPENT_E2E_USER_DATA_PATH) {
    app.setAppLogsPath(path.join(process.env.SERPENT_E2E_USER_DATA_PATH, "logs"));
  } else {
    app.setAppLogsPath();
  }
  appLogPath = path.join(app.getPath("logs"), "serpent.log");
  logger = new AppLogger(appLogPath);
  app.on("child-process-gone", (_event, details) => {
    logRendererChildProcessGone(logger, undefined, details);
  });
  applyDevAppIcon();
  const staleClipboardCount = cleanupStaleClipboardImages(app.getPath("temp"));
  if (staleClipboardCount > 0) {
    logger.info(
      "desktop-ingestion.clipboard-cleanup",
      "Removed stale clipboard staging directories.",
      {
        removedCount: staleClipboardCount,
      },
    );
  }
  workerClient = new LibraryWorkerClient(
    path.join(__dirname, "library_worker.js"),
    logger,
  );
  await workerClient.start();
  const activeWorkerClient = workerClient;
  // Slice E (Serpent-hnmg): Main owns the shared offscreen window that renders
  // model thumbnails. The worker enqueues model jobs and asks Main to render;
  // Main replies with PNG bytes (or a typed failure) that the worker persists
  // as the standard `thumbnail` artifact.
  offscreenThumbnailRenderer = createOffscreenThumbnailRenderer({
    createWindow: (options) => {
      const offscreenWindow = new BrowserWindow(options);
      offscreenWindow.webContents.on(
        "console-message",
        (_event, level, message, line, sourceId) => {
          logRendererConsoleMessage(logger, level, message, line, sourceId);
        },
      );
      offscreenWindow.webContents.on(
        "did-fail-load",
        (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
          logger?.error(
            "offscreen-thumbnail.page-load-failed",
            new Error(`${errorCode}: ${errorDescription}`),
            { errorCode, validatedURL, isMainFrame },
          );
        },
      );
      offscreenWindow.webContents.on("did-finish-load", () => {
        logger?.info(
          "offscreen-thumbnail.page-finished-load",
          "Offscreen renderer page finished loading.",
        );
        void offscreenWindow.webContents
          .executeJavaScript(
            "({ readyState: document.readyState, body: document.body.innerHTML, hasBridge: Boolean(window.offscreenThumbnail), debug: window.__serpentOffscreenThumbnailDebug })",
          )
          .then((state) => {
            logger?.info(
              "offscreen-thumbnail.page-state",
              "Inspected offscreen renderer page state.",
              { state },
            );
          })
          .catch((error: unknown) => {
            logger?.error("offscreen-thumbnail.page-state", error);
          });
      });
      return offscreenWindow;
    },
    onFrameMessage: (listener) => {
      const onFrameMessage = (_event: Electron.IpcMainEvent, payload: unknown): void => {
        listener(payload);
      };
      ipcMain.on(OFFSCREEN_THUMBNAIL_FRAME_CHANNEL, onFrameMessage);
      return () =>
        ipcMain.removeListener(OFFSCREEN_THUMBNAIL_FRAME_CHANNEL, onFrameMessage);
    },
    logger: {
      error: (scope, error, context) => logger?.error(scope, error, context),
      info: (scope, message, context) => logger?.info(scope, message, context),
    },
    pageUrl: resolveOffscreenPageUrl({
      devServerUrl: MAIN_WINDOW_VITE_DEV_SERVER_URL ?? null,
      rendererOutDir: packagedRendererOutDir(),
    }),
    preloadPath: path.join(__dirname, "offscreen.js"),
  });
  workerClient.onModelThumbnailRenderRequest((request, sourceAuthorizations) => {
    const renderer = offscreenThumbnailRenderer;
    if (!renderer) {
      return Promise.resolve({
        status: "failed" as const,
        errorCode: "MODEL_WINDOW_FAILED",
        reason: "offscreen thumbnail renderer unavailable",
      });
    }
    registerModelThumbnailSourceAuthorizations(sourceAuthorizations);
    return renderer.renderModelThumbnail(request).finally(() => {
      clearModelThumbnailSourceAuthorizations(sourceAuthorizations);
    });
  });
  automationExecutionJournal = new AutomationExecutionJournal({
    store: createJsonFileAutomationExecutionStore(
      path.join(app.getPath('userData'), 'automation-executions.json'),
    ),
    logger,
  });
  automationRecentScripts = createJsonFileAutomationRecentScriptsStore(
    path.join(app.getPath('userData'), 'automation-recent-scripts.json'),
  );
  const automationWorkerAdapter = new AutomationLibraryWorkerAdapter(workerClient, {
    onAiEnqueued: (libraryId) => processAiQueue(libraryId),
    onAiEnqueueError: (error, libraryId) => {
      logger?.error('automation.ai-queue.trigger-failed', error, { libraryId });
    },
  });
  automationScriptFiles = new AutomationScriptFileService({
    selectOpenScript: selectAutomationScriptToOpen,
    selectSaveScript: selectAutomationScriptToSave,
    recentScripts: automationRecentScripts,
  });
  automationCommandGateway = createAutomationCommandGateway(
    automationWorkerAdapter,
    {
      resolve: (executionId) => {
        const pluginContext = pluginAutomationContexts.get(executionId);
        if (pluginContext !== undefined) return pluginContext;
        return automationExecutionJournal?.resolve(executionId);
      },
    },
    {
      auditSink: automationExecutionJournal,
      auditLogger: logger,
      externalEffectHandler: {
        apply: ({ commandId, workerResult }) => {
          // The only current external automation effect is intentionally
          // consumed in Main: scripts receive the copied count, never an
          // absolute asset path or an Electron clipboard handle.
          if (commandId !== 'asset.paths.copy'
            || !workerResult.ok
            || workerResult.type !== 'media.asset-paths') {
            throw new Error(`Unexpected automation external effect: ${commandId}`);
          }
          clipboard.writeText(workerResult.absolutePaths.join('\n'));
        },
      },
      uiNotifyHandler: {
        notify: (input) => {
          if (!mainWindow || mainWindow.isDestroyed()) {
            throw new Error('The Serpent window is not available to show a notification.');
          }
          const payload = {
            severity: input.severity,
            mode: input.mode,
            message: input.message.trim().slice(0, 500),
            ...(input.mode === 'dialog'
              ? { title: sanitizeShellNotifyTitle(input.title, input.severity) }
              : {}),
          };
          mainWindow.webContents.send(SHELL_NOTIFY_CHANNEL, payload);
        },
      },
      filePlanApprovalHandler: createDesktopAutomationFilePlanApprovalHandler({
        workerClient: automationWorkerAdapter,
        confirm: confirmDesktopAutomationFilePlan,
        runWillHooks: async ({ commandId, libraryId, commandInput, planSummary }) => {
          if (commandId !== 'asset.trash' || pluginActivationCoordinator === undefined) {
            return { warnings: [] };
          }
          const input = commandInput as { assetIds?: readonly string[] };
          const result = await pluginActivationCoordinator.runWillHooks({
            event: 'asset.trash',
            libraryId,
            summary: {
              operation: planSummary.operation,
              targetCount: planSummary.targetCount,
              executableCount: planSummary.executableCount,
              blockedCount: planSummary.blockedCount,
              assetIds: Array.isArray(input.assetIds) ? [...input.assetIds] : [],
            },
          });
          return { warnings: result.warnings };
        },
      }),
      libraryBindingHandler: {
        bindLibrary: async ({ executionId, libraryId }) => {
          const libraries = await activeWorkerClient.request({ type: 'library.list' });
          if (!libraries.ok || libraries.type !== 'library.list') {
            throw new Error('The created library is not open in the Library Worker.');
          }
          const boundLibrary = libraries.libraries.find((library) => library.libraryId === libraryId);
          if (!boundLibrary) {
            throw new Error('The created library is not open in the Library Worker.');
          }
          const bound = automationExecutionJournal?.bindLibrary(executionId, libraryId);
          if (bound === undefined || bound.libraryId !== libraryId) {
            throw new Error('The automation execution could not bind the created library.');
          }
          rememberOpenedLibrary(boundLibrary.libraryPath, boundLibrary.displayName);
          publishLifecycle({
            type: 'library.opened',
            library: {
              libraryId: boundLibrary.libraryId,
              displayName: boundLibrary.displayName,
              displayPath: boundLibrary.libraryPath,
            },
          });
        },
      },
      undoGroupHandler: {
        create: ({ executionId, libraryId }) => {
          if (!automationExecutionJournal) {
            throw new Error('The automation execution journal is unavailable.');
          }
          const group = automationExecutionJournal.createUndoGroup({ executionId, libraryId });
          return { undoGroupId: group.undoGroupId };
        },
        append: ({ undoGroupId, item }) => {
          if (!automationExecutionJournal) {
            throw new Error('The automation execution journal is unavailable.');
          }
          const group = automationExecutionJournal.appendUndoGroupItems(undoGroupId, [item]);
          if (!group) {
            throw new Error(`Undo group ${undoGroupId} was not found while appending recovery items.`);
          }
        },
        complete: ({ undoGroupId, status, failureReason }) => {
          if (!automationExecutionJournal) {
            throw new Error('The automation execution journal is unavailable.');
          }
          const group = automationExecutionJournal.completeUndoGroup(undoGroupId, { status, failureReason });
          if (!group) {
            throw new Error(`Undo group ${undoGroupId} was not found while completing the group.`);
          }
        },
      },
      executionStatusHandler: {
        getStatus: (executionId) => {
          const record = automationExecutionJournal?.get(executionId);
          if (!record) return undefined;
          return {
            projection: projectAutomationExecutionStatus(record),
            source: record.source,
          };
        },
      },
    },
  );
  scriptRuntimeSupervisor = new ScriptRuntimeSupervisor({
    modulePath: path.join(__dirname, 'script_runtime_utility.js'),
    fork: (modulePath) => utilityProcess.fork(modulePath, [], {
      serviceName: 'Serpent Script Runtime',
      stdio: 'pipe',
    }),
    logger,
  });
  const executePluginHostCommand: PluginRuntimeHostCommandHandler = async (commandId, input, context) => {
    const gateway = automationCommandGateway;
    if (gateway === undefined) throw new Error('Automation Gateway is unavailable.');
    const cause = validatePluginCauseChain(context.causeChain);
    if (!cause.ok) {
      throw new Error(cause.message);
    }
    const targetLibraryId = context.targetLibraryId ?? context.libraryId;
    if (targetLibraryId === '__serpent_global_runtime__') {
      throw new Error('A global plugin must choose an open library with serpent.forLibrary().');
    }
    const parsedTarget = pluginTargetLibraryIdSchema.safeParse(targetLibraryId);
    if (!parsedTarget.success) {
      throw new Error('The plugin command target library is invalid.');
    }
    const activeInstance = pluginActivationCoordinator?.findActiveInstance(context.instanceId);
    if (activeInstance === undefined) {
      throw new Error('The plugin instance is no longer active.');
    }
    if (activeInstance.instanceScope === 'library'
      && activeInstance.activationLibraryId !== parsedTarget.data) {
      throw new Error('A library-scoped plugin cannot target another library.');
    }
    const libraries = await workerClient?.request({ type: 'library.list' });
    if (!libraries?.ok || libraries.type !== 'library.list'
      || !libraries.libraries.some((library) => library.libraryId === parsedTarget.data)) {
      throw new Error('The plugin command target library is not open.');
    }
    const executionId = context.targetLibraryId === undefined
      ? context.instanceId
      : `${context.instanceId}:${parsedTarget.data}`;
    pluginAutomationContexts.set(executionId, {
      executionId,
      source: 'plugin',
      libraryId: parsedTarget.data,
      grantedCapabilities: automationCapabilitiesFromPluginPermissions(context.permissions),
    });
    const commandInput = commandId === 'asset.search'
      ? normalizeAutomationAssetSearchInput(input)
      : input;
    if (commandInput === undefined) {
      throw new Error('Invalid search query.');
    }
    const result = await gateway.execute({
      apiVersion: AUTOMATION_API_VERSION,
      commandId,
      executionId,
      input: commandInput,
    });
    if (!result.ok) {
      logger?.error('plugin.host-command.gateway-failed', new Error(result.error.message ?? result.error.code), {
        instanceId: context.instanceId,
        pluginId: context.pluginId,
        commandId,
        errorCode: result.error.code,
      });
      throw new PluginHostCommandError(result.error.code, result.error.message ?? result.error.code);
    }
    return result.result;
  };
  const recordPluginRuntimeCrash = (crash: {
    instanceId: string;
    libraryId: string;
    libraryDirectory: string;
    pluginId: string;
    packageHash: string;
    failureCode: string;
  }): void => {
    pluginInputCaptureBroker?.releaseForInstance(crash.instanceId, 'plugin-crashed');
    void pluginPackageManager?.recordRuntimeCrash({
      libraryId: crash.libraryId,
      libraryDirectory: crash.libraryDirectory,
      pluginId: crash.pluginId,
      packageHash: crash.packageHash,
      failureCode: crash.failureCode,
    }).catch((error) => {
      logger?.error('plugin.runtime.crash-record', error, crash);
    });
  };
  const pluginStorageStore = new PluginStorageStore(app.getPath('userData'));
  const pluginSettingsStore = new PluginSettingsStore(app.getPath('userData'));
  const pluginMcpExposureStore = new PluginMcpExposureStore(app.getPath('userData'));
  await pluginMcpExposureStore.load();
  const executePluginStorage: PluginRuntimeStorageHandler = async (input) => {
    try {
      return await pluginStorageStore.execute({
        operation: input.operation,
        scope: input.scope ?? 'library',
        pluginId: input.context.pluginId,
        libraryId: input.context.libraryId,
        libraryDirectory: input.context.libraryDirectory,
        permissions: input.context.permissions,
        ...(input.key === undefined ? {} : { key: input.key }),
        ...(input.value === undefined ? {} : { value: input.value }),
      });
    } catch (error) {
      if (error instanceof PluginStorageStoreError) throw error;
      throw error;
    }
  };
  const resolvePluginJobTargetLibrary = async (input: {
    instanceId: string;
    requestedTargetLibraryId?: string;
    ambientLibraryId: string;
  }): Promise<{ record: NonNullable<ReturnType<PluginActivationCoordinator['findActiveInstance']>>; libraryId: string }> => {
    const coordinator = pluginActivationCoordinator;
    const client = workerClient;
    if (coordinator === undefined || client === undefined) {
      throw Object.assign(new Error('Plugin jobs are unavailable in this session.'), { code: 'JOBS_UNAVAILABLE' });
    }
    const record = coordinator.findActiveInstance(input.instanceId);
    if (record === undefined) {
      throw Object.assign(new Error('The plugin instance is no longer active.'), { code: 'INSTANCE_GONE' });
    }
    if (record.instanceScope === 'global' && input.requestedTargetLibraryId === undefined) {
      throw Object.assign(
        new Error('Global plugin jobs require an explicit open target library.'),
        { code: 'JOB_TARGET_REQUIRED' },
      );
    }
    const candidate = input.requestedTargetLibraryId ?? input.ambientLibraryId;
    const parsedTarget = pluginTargetLibraryIdSchema.safeParse(candidate);
    if (!parsedTarget.success) {
      throw Object.assign(new Error('The plugin job target library is invalid.'), { code: 'JOB_TARGET_INVALID' });
    }
    if (record.instanceScope === 'library' && record.activationLibraryId !== parsedTarget.data) {
      throw Object.assign(
        new Error('A library-scoped plugin cannot target another library.'),
        { code: 'JOB_TARGET_SCOPE_VIOLATION' },
      );
    }
    const libraries = await client.request({ type: 'library.list' });
    if (!libraries.ok || libraries.type !== 'library.list'
      || !libraries.libraries.some((library) => library.libraryId === parsedTarget.data)) {
      throw Object.assign(new Error('The plugin job target library is not open.'), { code: 'JOB_TARGET_NOT_OPEN' });
    }
    return { record, libraryId: parsedTarget.data };
  };
  const handlePluginJobEnqueue: PluginRuntimeJobEnqueueHandler = async (input) => {
    const client = workerClient;
    if (client === undefined) {
      throw Object.assign(new Error('Plugin jobs are unavailable in this session.'), { code: 'JOBS_UNAVAILABLE' });
    }
    const { record, libraryId } = await resolvePluginJobTargetLibrary({
      instanceId: input.instanceId,
      requestedTargetLibraryId: input.targetLibraryId,
      ambientLibraryId: input.context.libraryId,
    });
    const coordinator = pluginActivationCoordinator;
    if (coordinator === undefined) {
      throw Object.assign(new Error('Plugin jobs are unavailable in this session.'), { code: 'JOBS_UNAVAILABLE' });
    }
    const validated = coordinator.validateJobEnqueue({
      instanceId: input.instanceId,
      handlerId: input.handlerId,
      ...(input.recoveryStrategy === undefined ? {} : { recoveryStrategy: input.recoveryStrategy }),
    });
    if (!validated.ok) {
      throw Object.assign(new Error(validated.message), { code: validated.code });
    }
    const result = await client.request({
      type: 'plugin.jobs.enqueue',
      libraryId,
      ownerPluginId: input.context.pluginId,
      ownerPackageHash: input.context.packageHash,
      ownerPluginInstanceId: input.instanceId,
      ownerScope: record.instanceScope,
      ownerLibraryId: libraryId,
      pluginHandlerId: input.handlerId,
      payload: input.payload,
      recoveryStrategy: validated.recoveryStrategy,
    });
    if (!result.ok || result.type !== 'plugin.jobs.enqueued') {
      throw Object.assign(
        new Error(result.ok ? 'Plugin job enqueue returned an unexpected result.' : result.error.reason),
        { code: result.ok ? 'JOB_ENQUEUE_FAILED' : result.error.code },
      );
    }
    pluginJobScheduler?.tick(libraryId);
    return { jobId: result.job.jobId };
  };
  const handlePluginJobProgress: PluginRuntimeJobProgressHandler = async (input) => {
    const client = workerClient;
    if (client === undefined) {
      throw Object.assign(new Error('Plugin jobs are unavailable in this session.'), { code: 'JOBS_UNAVAILABLE' });
    }
    const { record, libraryId: targetLibraryId } = await resolvePluginJobTargetLibrary({
      instanceId: input.instanceId,
      requestedTargetLibraryId: input.targetLibraryId,
      ambientLibraryId: input.context.libraryId,
    });
    const result = await client.request({
      type: 'plugin.jobs.report-progress',
      libraryId: targetLibraryId,
      jobId: input.jobId,
      ownerPluginId: input.context.pluginId,
      ownerPackageHash: input.context.packageHash,
      ownerPluginInstanceId: input.instanceId,
      ownerScope: record.instanceScope,
      ownerLibraryId: targetLibraryId,
      ...input.progress,
    });
    if (!result.ok || result.type !== 'plugin.jobs.completed') {
      throw Object.assign(
        new Error(result.ok ? 'Plugin job progress returned an unexpected result.' : result.error.reason),
        { code: result.ok ? 'JOB_PROGRESS_FAILED' : result.error.code },
      );
    }
  };
  const handlePluginJobControl: PluginRuntimeJobControlHandler = async (input) => {
    const client = workerClient;
    const coordinator = pluginActivationCoordinator;
    if (client === undefined || coordinator === undefined) {
      throw Object.assign(new Error('Plugin jobs are unavailable in this session.'), { code: 'JOBS_UNAVAILABLE' });
    }
    const { record, libraryId } = await resolvePluginJobTargetLibrary({
      instanceId: input.instanceId,
      requestedTargetLibraryId: input.targetLibraryId,
      ambientLibraryId: input.context.libraryId,
    });
    const listed = await client.request({ type: 'plugin.jobs.list', libraryId });
    if (!listed.ok || listed.type !== 'plugin.jobs.listed') {
      throw Object.assign(new Error('The plugin job list could not be read.'), { code: 'JOB_LIST_FAILED' });
    }
    const job = listed.jobs.find((candidate) => candidate.jobId === input.jobId);
    const owner = {
      pluginId: record.pluginId,
      packageHash: record.packageHash,
      pluginInstanceId: record.instanceId,
      scope: record.instanceScope,
      libraryId,
    } as const;
    const ownsJob = job !== undefined && (input.action === 'retry'
      ? pluginJobOwnerCanRetry(job, owner)
      : pluginJobOwnerMatches(job, owner));
    if (!ownsJob) {
      throw Object.assign(new Error('The plugin does not own this job.'), { code: 'JOB_OWNERSHIP_MISMATCH' });
    }
    const capabilities = {
      handlerId: job.pluginHandlerId,
      resumable: job.recoveryStrategy === 'checkpoint',
      ...(job.checkpoint?.version === undefined ? { checkpointVersion: 'v1' } : { checkpointVersion: job.checkpoint.version }),
    } as const;
    const requestOwner = {
      ownerPluginId: record.pluginId,
      ownerPackageHash: record.packageHash,
      ownerPluginInstanceId: record.instanceId,
      ownerScope: record.instanceScope,
      ownerLibraryId: libraryId,
    } as const;
    let result: Awaited<ReturnType<typeof client.request>>;
    switch (input.action) {
      case 'cancel':
        result = await client.request({ type: 'plugin.jobs.cancel', libraryId, jobId: input.jobId, ...requestOwner, reason: input.reason });
        break;
      case 'pause':
        if (input.checkpoint === undefined) {
          throw Object.assign(new Error('Pausing a plugin job requires a checkpoint.'), { code: 'CHECKPOINT_REQUIRED' });
        }
        result = await client.request({
          type: 'plugin.jobs.pause', libraryId, jobId: input.jobId, ...requestOwner,
          capabilities,
          checkpoint: input.checkpoint,
        });
        break;
      case 'resume':
        result = await client.request({ type: 'plugin.jobs.resume', libraryId, jobId: input.jobId, ...requestOwner, capabilities });
        break;
      case 'retry':
        result = await client.request({ type: 'plugin.jobs.retry', libraryId, jobId: input.jobId, ...requestOwner, retryInput: input.retryInput });
        break;
    }
    if (!result.ok || !('job' in result)) {
      throw Object.assign(new Error(result.ok ? 'Plugin job control returned an unexpected result.' : result.error.reason), {
        code: result.ok ? 'JOB_CONTROL_FAILED' : result.error.code,
      });
    }
    if ((input.action === 'cancel' || input.action === 'pause') && result.job !== null) {
      if (record.mode === 'restricted') pluginRuntimeSupervisor?.signalJob(record.instanceId, input.jobId, input.action, input.reason);
      else pluginTrustedRuntimeSupervisor?.signalJob(record.instanceId, input.jobId, input.action, input.reason);
    }
    if (input.action === 'resume' || input.action === 'retry') pluginJobScheduler?.tick(libraryId);
    return { job: result.job };
  };
  const onPluginInstanceActivated = (input: { libraryId: string }): void => {
    pluginJobScheduler?.tick(input.libraryId);
  };
  const handlePluginInputCaptureStart: PluginRuntimeInputCaptureStartHandler = (input) => {
    if (pluginInputCaptureBroker === undefined) {
      return {
        ok: false,
        code: 'CAPTURE_UNAVAILABLE',
        message: 'Input capture is unavailable in this session.',
      };
    }
    return pluginInputCaptureBroker.start({
      ...input.options,
      instanceId: input.instanceId,
      pluginId: input.pluginId,
      libraryId: input.libraryId,
      permissions: input.permissions,
    });
  };
  pluginInputCaptureBroker = new PluginInputCaptureBroker({
    onStart: () => {
      publishPluginInputCaptureSessionsToRenderer();
    },
    onEvent: (session, event) => {
      pluginRuntimeSupervisor?.deliverInputCaptureEvent(session.instanceId, session.sessionId, event);
      pluginTrustedRuntimeSupervisor?.deliverInputCaptureEvent(session.instanceId, session.sessionId, event);
    },
    onEnd: (session, reason) => {
      pluginRuntimeSupervisor?.endInputCapture(session.instanceId, session.sessionId, reason);
      pluginTrustedRuntimeSupervisor?.endInputCapture(session.instanceId, session.sessionId, reason);
      publishPluginInputCaptureSessionsToRenderer();
    },
  });
  pluginRuntimeSupervisor = new PluginRuntimeSupervisor({
    modulePath: path.join(__dirname, 'plugin_standard_host.js'),
    fork: (modulePath) => utilityProcess.fork(modulePath, [], {
      serviceName: 'Serpent Plugin Standard Host',
      stdio: 'pipe',
    }),
    executeHostCommand: executePluginHostCommand,
    executeStorage: executePluginStorage,
    handleJobEnqueue: handlePluginJobEnqueue,
    handleJobProgress: handlePluginJobProgress,
    handleJobControl: handlePluginJobControl,
    handleInputCaptureStart: handlePluginInputCaptureStart,
    handleInputCaptureRelease: (instanceId, sessionId) => {
      pluginInputCaptureBroker?.release(sessionId);
    },
    onInstanceDeactivated: (instanceId) => {
      pluginInputCaptureBroker?.releaseForInstance(instanceId, 'plugin-deactivated');
    },
    onInstanceCrashed: ({ instanceId, failureCode }) => {
      pluginActivationCoordinator?.onInstanceCrashed({ instanceId, failureCode });
    },
    onCrash: recordPluginRuntimeCrash,
    onInstanceActivated: onPluginInstanceActivated,
    logger,
  });
  pluginTrustedRuntimeSupervisor = new PluginTrustedRuntimeSupervisor({
    modulePath: path.join(__dirname, 'plugin_trusted_host.js'),
    fork: (modulePath) => utilityProcess.fork(modulePath, [], {
      serviceName: 'Serpent Plugin Trusted Host',
      stdio: 'pipe',
    }),
    executeHostCommand: executePluginHostCommand,
    executeStorage: executePluginStorage,
    handleJobEnqueue: handlePluginJobEnqueue,
    handleJobProgress: handlePluginJobProgress,
    handleJobControl: handlePluginJobControl,
    handleInputCaptureStart: handlePluginInputCaptureStart,
    handleInputCaptureRelease: (instanceId, sessionId) => {
      pluginInputCaptureBroker?.release(sessionId);
    },
    onInstanceDeactivated: (instanceId) => {
      pluginInputCaptureBroker?.releaseForInstance(instanceId, 'plugin-deactivated');
    },
    onInstanceCrashed: ({ instanceId, failureCode }) => {
      pluginActivationCoordinator?.onInstanceCrashed({ instanceId, failureCode });
    },
    onInstanceActivated: onPluginInstanceActivated,
    onCrash: recordPluginRuntimeCrash,
    logger,
  });
  const pluginCompatibility = currentPluginCompatibilityPlatform();
  const nodeAbi = Number(process.versions.modules);
  if (pluginCompatibility === undefined || !Number.isSafeInteger(nodeAbi) || nodeAbi <= 0) {
    logger.error('plugin.platform', new Error('This platform cannot run the plugin package manager.'), {
      platform: process.platform,
      arch: process.arch,
      nodeAbi: process.versions.modules,
    });
  } else {
    pluginPackageManager = new PluginPackageManager({
      userDataDirectory: app.getPath('userData'),
      deviceId: await loadOrCreatePluginDeviceId(app.getPath('userData')),
      serpentVersion: app.getVersion(),
      pluginApiVersion: PLUGIN_API_VERSION,
      ...pluginCompatibility,
      nodeAbi,
      logger,
    });
    pluginActivationCoordinator = new PluginActivationCoordinator({
      packageManager: pluginPackageManager,
      supervisor: pluginRuntimeSupervisor,
      trustedSupervisor: pluginTrustedRuntimeSupervisor,
      globalRuntimeContext: {
        libraryId: '__serpent_global_runtime__',
        libraryDirectory: app.getPath('userData'),
      },
      contributions: createContributionRegistry(),
      providers: createPluginProviderRegistry(),
      compatibility: {
        serpentVersion: app.getVersion(),
        pluginApiVersion: PLUGIN_API_VERSION,
        ...pluginCompatibility,
        nodeAbi,
      },
      pausePluginJobs: async ({ libraryId, owners }) => {
        const client = workerClient;
        if (client === undefined) return;
        const result = await client.request({
          type: 'plugin.jobs.pause-owners',
          libraryId,
          owners,
          errorCode: 'PLUGIN_INSTANCE_INACTIVE',
          errorDetail: 'The plugin instance is no longer active.',
        });
        if (!result.ok) {
          throw new Error(result.error.reason);
        }
      },
      onInstanceActivated: ({ libraryId }) => {
        pluginJobScheduler?.tick(libraryId);
      },
      onContributionsRegistered: ({ libraryId }) => {
        void pluginProviderScheduler?.materializeLibrary(libraryId).catch((error) => {
          logger?.error('plugin.providers.materialize', error, { libraryId });
        });
      },
      logger,
    });
    pluginMcpToolProvider = new PluginMcpToolProvider({
      activationCoordinator: pluginActivationCoordinator,
      getLibraryId: () => {
        const executionId = automationMcpHost?.executionId;
        const mcpLibraryId = executionId === undefined
          ? null
          : automationExecutionJournal?.get(executionId)?.libraryId ?? null;
        if (mcpLibraryId !== null) return mcpLibraryId;
        return mainWindow === undefined
          ? null
          : focusedContexts.get(mainWindow.id)?.libraryId ?? null;
      },
    });
    pluginJobScheduler = new PluginJobScheduler({
      supervisor: pluginRuntimeSupervisor,
      trustedSupervisor: pluginTrustedRuntimeSupervisor,
      requestWorker: async (command) => {
        const client = workerClient;
        if (client === undefined) return { ok: false };
        const result = await client.request(command);
        if (!result.ok) return { ok: false };
        if (result.type === 'plugin.jobs.claimed') {
          return { ok: true, type: result.type, job: result.job };
        }
        if (result.type === 'plugin.jobs.completed') {
          return { ok: true, type: result.type, job: result.job };
        }
        return { ok: false };
      },
      resolveInstances: (libraryId) => {
        const coordinator = pluginActivationCoordinator;
        if (coordinator === undefined) return [];
        const bindings = coordinator.listActiveInstances(libraryId);
        const standard = pluginRuntimeSupervisor?.listActiveInstances(libraryId) ?? [];
        const trusted = pluginTrustedRuntimeSupervisor?.listActiveInstances(libraryId) ?? [];
        return bindings.map((binding) => {
          const source = binding.mode === 'restricted'
            ? standard.find((item) => item.instanceId === binding.instanceId)
            : trusted.find((item) => item.instanceId === binding.instanceId);
          return {
            ...binding,
            activated: source?.activated ?? false,
          };
        });
      },
      logger,
    });
    pluginProviderScheduler = new PluginProviderScheduler({
      coordinator: pluginActivationCoordinator,
      supervisor: pluginRuntimeSupervisor,
      trustedSupervisor: pluginTrustedRuntimeSupervisor,
      requestWorker: async (command) => {
        const client = workerClient;
        if (client === undefined) return { ok: false };
        const result = await client.request(command);
        if (!result.ok) return { ok: false };
        if (result.type === 'asset.list') {
          return { ok: true, type: result.type, assets: result.assets };
        }
        if (result.type === 'plugin.derived-fields.materialized') {
          return {
            ok: true,
            type: result.type,
            writtenCount: result.writtenCount,
            fieldKey: result.fieldKey,
          };
        }
        if (result.type === 'asset.search.result') {
          return {
            ok: true,
            type: result.type,
            items: result.items,
            total: result.total,
            offset: result.offset,
            snippets: result.snippets,
          };
        }
        return { ok: false };
      },
      logger,
    });
    workerClient.onPluginMediaProviderRequest(async (input) => {
      const scheduler = pluginProviderScheduler;
      if (scheduler === undefined) {
        return {
          status: 'native-fallback',
          assetId: input.assetId,
          kind: input.kind,
          errorCode: 'PLUGIN_PROVIDER_UNAVAILABLE',
        };
      }
      try {
        return await scheduler.resolveMediaProvider(input);
      } catch (error) {
        logger?.error('plugin.media-provider.request', error, {
          libraryId: input.libraryId,
          assetId: input.assetId,
          kind: input.kind,
        });
        return {
          status: 'native-fallback',
          assetId: input.assetId,
          kind: input.kind,
          errorCode: 'PLUGIN_PROVIDER_FAILED',
        };
      }
    });
  }
  // Global user-scoped plugins have an application lifetime and must be set up
  // before recent-library restore, including when no library can be reopened.
  await pluginActivationCoordinator?.refreshGlobal();
  workerClient.onAssetsChanged(publishAssetChange);
  workerClient.onLibraryChanged(publishLibraryChanged);
  workerClient.onProgress(publishProgress);
  workerClient.onAiProgress(publishAiProgress);
  workerClient.onAiAnalysisCompleted(publishAiCompleted);
  workerClient.onAiContentCleared(publishAiCleared);

  const recentPath = readActiveLibraryPath(recentLibraryPath(), (error) => {
    logger?.error("recent-library.read", error);
  });
  if (recentPath) {
    const restored = await workerClient.request({
      type: "library.open",
      selectedLibraryPath: recentPath,
    });
    if (!restored.ok || restored.type !== "library.opened") {
      logger.info(
        "recent-library.unavailable",
        "The recent library could not be reopened.",
        {
          code: restored.ok ? "UNEXPECTED_RESULT" : restored.error.code,
          reason: restored.ok ? undefined : restored.error.reason,
        },
      );
    } else {
      // Startup restore bypasses handleLibraryRequest; still must activate plugins.
      // Await so contributions exist before the renderer shell lists menus/settings.
      await notifyLibraryOpenedSideEffects({
        libraryId: restored.library.libraryId,
        libraryDirectory: restored.library.libraryPath,
      });
      logger.info(
        "recent-library.restored",
        "Reopened the recent library and completed plugin activation request.",
        {
          libraryId: restored.library.libraryId,
        },
      );
    }
  }

  // Forward thumbnail events to the renderer
  workerClient.onThumbnailEvent((event) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send(THUMBNAIL_CHANNEL, event);
  });

  // Register serpent:// custom protocol for serving thumbnail/preview artifacts.
  // The renderer uses serpent://preview/<libraryId>/<artifactId> URLs in <img> tags.
  // Main resolves the artifact path via Worker, reads the file, and returns bytes.
  protocol.handle("serpent", async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname === APP_ASSET_HOST) {
        // Bundled app assets (e.g. .hdr environment maps) that the packaged
        // renderer cannot fetch via file:// (three r185 loaders use fetch).
        // Whitelist + receipt verification live in src/main/app-assets.ts.
        const response = createAppAssetResponse({
          route: url.pathname,
          appPath: app.getAppPath(),
          isPackaged: app.isPackaged,
        });
        if (!response) {
          logger?.info(
            "serpent-protocol.app-asset-missing",
            "Rejected unknown or unverified app-asset route.",
            { route: url.pathname },
          );
          return new Response("App asset not found", { status: 404 });
        }
        return response;
      }
      if (
        url.hostname !== "preview" &&
        url.hostname !== "proxy" &&
        url.hostname !== "source"
      ) {
        logger?.info(
          "serpent-protocol.invalid-host",
          "Rejected unsupported artifact protocol host.",
        );
        return new Response("Invalid serpent:// path", { status: 400 });
      }
      const parts = url.pathname.replace(/^\/+/, "").split("/");
      if (parts.length !== 2) {
        logger?.info(
          "serpent-protocol.invalid-path",
          "Rejected malformed artifact protocol URL.",
        );
        return new Response("Invalid URL format", { status: 400 });
      }
      const libraryId = parts[0]!;
      const artifactId = parts[1]!;
      if (
        !libraryId ||
        !artifactId ||
        libraryId.includes("..") ||
        artifactId.includes("..")
      ) {
        logger?.info(
          "serpent-protocol.invalid-identifiers",
          "Rejected malformed artifact identifiers.",
        );
        return new Response("Invalid identifiers", { status: 400 });
      }

      if (!workerClient) {
        logger?.error(
          "serpent-protocol.worker-unavailable",
          new Error("Library Worker is unavailable."),
        );
        return new Response("Worker unavailable", { status: 503 });
      }

      if (url.hostname === "source") {
        logger?.info(
          "serpent-protocol.source-request",
          "Resolving a source asset request.",
          { libraryId, assetId: artifactId },
        );
        const revisionId = url.searchParams.get("revision");
        if (!revisionId || !/^[A-Za-z0-9_-]{1,255}$/.test(revisionId)) {
          logger?.info(
            "serpent-protocol.invalid-revision",
            "Rejected malformed source revision token.",
          );
          return new Response("Invalid revision", { status: 400 });
        }
        const authorizedSource = resolveModelThumbnailSourceAuthorization({
          libraryId,
          assetId: artifactId,
          revisionId,
        });
        if (authorizedSource) {
          try {
            return createArtifactResponse(
              authorizedSource.absolutePath,
              authorizedSource.mimeType,
              {
                rangeHeader: request.headers.get("range"),
                signal: request.signal,
                onStreamError: (error) =>
                  logger?.error("serpent-protocol.model-source-stream", error, {
                    libraryId,
                    assetId: artifactId,
                  }),
              },
            );
          } catch (error) {
            logger?.error("serpent-protocol.model-source-read", error, {
              libraryId,
              assetId: artifactId,
            });
            return new Response("Source file missing", { status: 404 });
          }
        }
        const sourceResult = await workerClient.request({
          type: "media.get-source-path",
          libraryId,
          assetId: artifactId,
          revisionId,
        });
        if (!sourceResult.ok || sourceResult.type !== "media.source-path") {
          logger?.info(
            "serpent-protocol.source-stale",
            "Rejected missing or stale source token.",
            {
              libraryId,
              assetId: artifactId,
            },
          );
          return new Response("Source not found", { status: 404 });
        }
        try {
          return createArtifactResponse(
            sourceResult.absolutePath,
            sourceResult.mimeType,
            {
              rangeHeader: request.headers.get("range"),
              signal: request.signal,
              onStreamError: (error) =>
                logger?.error("serpent-protocol.source-stream", error, {
                  libraryId,
                  assetId: artifactId,
                }),
            },
          );
        } catch (error) {
          logger?.error("serpent-protocol.source-read", error, {
            libraryId,
            assetId: artifactId,
          });
          return new Response("Source file missing", { status: 404 });
        }
      }

      const pathResult = await workerClient.request({
        type: "media.get-artifact-path",
        libraryId,
        artifactId,
        usage: url.hostname,
      });

      if (!pathResult.ok || pathResult.type !== "media.artifact-path") {
        logger?.error(
          "serpent-protocol.resolve",
          new Error("Artifact lookup failed."),
          {
            libraryId,
            artifactId,
            resultType: pathResult.ok ? pathResult.type : pathResult.error.code,
          },
        );
        return new Response("Artifact not found", { status: 404 });
      }

      const ext = path.extname(pathResult.absolutePath).toLowerCase();
      const mimeMap: Record<string, string> = {
        ".webp": "image/webp",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".webm": "video/webm",
        ".json": "application/json",
        ".wav": "audio/wav",
        ".mp3": "audio/mpeg",
        ".ogg": "audio/ogg",
        ".oga": "audio/ogg",
        ".m4a": "audio/mp4",
        ".aac": "audio/aac",
        ".flac": "audio/flac",
        ".opus": "audio/ogg",
      };
      const mimeType = mimeMap[ext] ?? "application/octet-stream";

      try {
        return createArtifactResponse(
          pathResult.absolutePath,
          mimeType,
          {
            rangeHeader: request.headers.get("range"),
            signal: request.signal,
            onStreamError: (error) =>
              logger?.error("serpent-protocol.stream", error, {
                libraryId,
                artifactId,
              }),
          },
        );
      } catch (error) {
        logger?.error("serpent-protocol.read", error, {
          libraryId,
          artifactId,
        });
        return new Response("Artifact file missing", { status: 404 });
      }
    } catch (error) {
      logger?.error("serpent-protocol", error);
      return new Response("Internal error", { status: 500 });
    }
  });

  protocol.handle("serpent-plugin", async (request) => {
    const parsed = parsePluginUiAssetRequestFromNavigation(
      request.url,
      request.headers.get("referer") ?? request.headers.get("Referer"),
    );
    if (parsed === undefined) {
      return new Response("Invalid plugin UI URL", { status: 400 });
    }
    const resolved = pluginActivationCoordinator?.resolvePluginUiAsset(parsed);
    if (resolved === undefined) {
      logger?.info("plugin-ui.protocol-rejected", "Rejected an inactive or unallowlisted plugin UI asset.", {
        pluginId: parsed.pluginId,
        instanceId: parsed.instanceId,
        contributionId: parsed.contributionId,
      });
      return new Response("Plugin UI asset not found", { status: 404 });
    }
    try {
      let body: Buffer = await readFile(resolved.absolutePath);
      const contentType = pluginUiMimeType(parsed.relativePath);
      if (contentType.startsWith("text/html")) {
        body = Buffer.from(
          rewritePluginUiHtmlAssetUrls(body.toString("utf8"), request.url),
          "utf8",
        );
      }
      const pluginOrigin = `serpent-plugin://${parsed.pluginId}`;
      return new Response(new Uint8Array(body), {
        headers: {
          "cache-control": "no-store",
          "content-security-policy": [
            "default-src 'none'",
            `script-src 'self' ${pluginOrigin}`,
            `style-src 'self' ${pluginOrigin} 'unsafe-inline'`,
            `img-src 'self' ${pluginOrigin} data:`,
            `font-src 'self' ${pluginOrigin}`,
            `media-src 'self' ${pluginOrigin} data:`,
            "connect-src 'none'",
            "object-src 'none'",
            "base-uri 'none'",
            "form-action 'none'",
            "frame-src 'none'",
          ].join("; "),
          "content-type": contentType,
          "x-content-type-options": "nosniff",
        },
      });
    } catch (error) {
      logger?.error("plugin-ui.protocol-read", error, {
        pluginId: parsed.pluginId,
        contributionId: parsed.contributionId,
        relativePath: parsed.relativePath,
      });
      return new Response("Plugin UI asset unavailable", { status: 404 });
    }
  });

  ipcMain.handle(LIBRARY_REQUEST_CHANNEL, (event, input: unknown) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) {
      return {
        ok: false,
        error: createPublicError("INTERNAL_ERROR"),
      } satisfies RendererResult;
    }
    return handleLibraryRequest(input);
  });

  registerAutomationScriptIpc({
    ipcMain,
    isAuthorizedSender: (sender) => Boolean(mainWindow && sender === mainWindow.webContents),
    workerClient: () => workerClient,
    journal: () => automationExecutionJournal,
    gateway: () => automationCommandGateway,
    runtime: () => scriptRuntimeSupervisor,
    scriptFiles: () => automationScriptFiles,
    confirmDesktopWrite: confirmDesktopAutomationWrite,
    logger: () => logger,
    undoGroup: () => ({
      recover: async ({ libraryId, items }) => {
        let undoneCount = 0;
        let skippedCount = 0;
        for (const item of [...items].reverse()) {
          if (!item.reversible) throw new Error('This automation undo item is not reversible.');
          const result = item.kind === 'asset.move'
            ? await activeWorkerClient.request({
              type: 'asset.move-undo',
              libraryId,
              operationId: item.reference,
              conflictStrategy: 'error',
            })
            : item.kind === 'asset.trash'
              ? await activeWorkerClient.request({
                type: 'asset.trash-undo',
                libraryId,
                operationId: item.reference,
              })
              : undefined;
          if (!result) throw new Error(`Automation undo is not supported for ${item.kind}.`);
          if (!result.ok) throw new Error('Automation undo failed.');
          if (result.type === 'asset.move-undone') {
            undoneCount += result.undoneCount;
            skippedCount += result.skippedCount;
          } else if (result.type === 'asset.trash-undone') {
            undoneCount += result.restoredCount;
            skippedCount += result.skippedCount;
          } else {
            throw new Error('Automation undo returned an unexpected result.');
          }
        }
        return { undoneCount, skippedCount };
      },
    }),
  });

  const pluginPackageRequest = pluginPackageManager === undefined
    ? undefined
    : createPluginPackageRequestHandler({
      manager: pluginPackageManager,
      activationCoordinator: pluginActivationCoordinator,
      settingsStore: pluginSettingsStore,
      storageStore: pluginStorageStore,
      mcpExposureStore: pluginMcpExposureStore,
      searchProviders: async (input) => {
        if (pluginProviderScheduler === undefined) {
          throw new Error('Plugin search providers are unavailable.');
        }
        return pluginProviderScheduler.searchAssets(input);
      },
      mediaProvider: async (input) => {
        if (pluginProviderScheduler === undefined) {
          throw new Error('Plugin media providers are unavailable.');
        }
        return pluginProviderScheduler.resolveMediaProvider(input);
      },
      metadataProvider: async (input) => {
        if (pluginProviderScheduler === undefined) {
          throw new Error('Plugin metadata providers are unavailable.');
        }
        return pluginProviderScheduler.resolveMetadataProvider(input);
      },
      importProvider: async (input) => {
        if (pluginProviderScheduler === undefined) {
          throw new Error('Plugin import providers are unavailable.');
        }
        return pluginProviderScheduler.resolveImportProvider(input);
      },
      exportProvider: async (input) => {
        if (pluginProviderScheduler === undefined) {
          throw new Error('Plugin export providers are unavailable.');
        }
        return pluginProviderScheduler.resolveExportProvider(input);
      },
      aiProvider: async (input) => {
        if (pluginProviderScheduler === undefined) {
          throw new Error('Plugin AI providers are unavailable.');
        }
        return pluginProviderScheduler.resolveAiProvider(input);
      },
      resolveLibraryDirectory: async (libraryId) => {
        const client = workerClient;
        if (client === undefined) return undefined;
        const result = await client.request({ type: 'library.list' });
        if (!result.ok || result.type !== 'library.list') return undefined;
        return result.libraries.find((library) => library.libraryId === libraryId)?.libraryPath;
      },
      chooseLocalPackage: selectPluginPackage,
      revealPackageDirectory: (absoluteDirectory) => {
        shell.showItemInFolder(absoluteDirectory);
      },
      afterMutation: async ({ requestType, libraryId, libraryDirectory }) => {
        const coordinator = pluginActivationCoordinator;
        if (coordinator === undefined) return;
        try {
          if (requestType === 'plugin-manager.resolve'
            || requestType === 'plugin-manager.safe-mode'
            || requestType === 'plugin-manager.install-local'
            || requestType === 'plugin-manager.install-github'
            || requestType === 'plugin-manager.uninstall'
            || requestType === 'plugin-manager.trust'
            || requestType === 'plugin-manager.reload') {
            // Enable/disable (especially user-scoped) and package lifecycle can
            // change contributions in every open library Host.
            await coordinator.refreshOpenLibraries();
          } else if (libraryId !== undefined && libraryDirectory !== undefined) {
            await coordinator.refreshLibrary({ libraryId, libraryDirectory });
          }
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(PLUGIN_CONTRIBUTIONS_CHANGED_CHANNEL, {
              libraryId: libraryId ?? null,
              requestType,
            });
          }
        } catch (error) {
          logger?.error('plugin.activation.after-mutation', error, { requestType, libraryId });
        }
      },
      logger,
    });
  ipcMain.handle(PLUGIN_MANAGER_CHANNEL, (event, input: unknown) => {
    if (!mainWindow || event.sender !== mainWindow.webContents || pluginPackageRequest === undefined) {
      logger?.info('plugin.ipc', 'Rejected plugin manager request.', {
        reason: pluginPackageRequest === undefined ? 'unavailable' : 'unauthorized-sender',
      });
      return { ok: false, code: 'operation-failed' };
    }
    return pluginPackageRequest(input);
  });

  // 渲染进程请求在系统浏览器打开外部链接（检查器「源链接」跳转）。
  // 发送者与 URL 双重校验，仅放行不含凭据的 HTTP(S)。失败回传公开错误码；日志不含 URL。
  ipcMain.handle(
    OPEN_EXTERNAL_URL_CHANNEL,
    async (event, input: unknown): Promise<OpenExternalUrlResult> => {
      if (!mainWindow || event.sender !== mainWindow.webContents) {
        logger?.info("ipc.open-external-url", "Rejected open-external-url request.", {
          code: "unauthorized_sender",
        });
        return { ok: false, code: "unauthorized_sender" };
      }
      const resolved = resolveOpenExternalUrlTarget(input);
      if (!resolved.ok) {
        logger?.info("ipc.open-external-url", "Rejected open-external-url request.", {
          code: resolved.code,
        });
        return resolved;
      }
      try {
        await shell.openExternal(resolved.url);
        return { ok: true };
      } catch (error) {
        logger?.error("ipc.open-external-url", error, { code: "shell_failure" });
        return { ok: false, code: "shell_failure" };
      }
    },
  );

  // Reveal serpent.log in the file manager without exposing the path to Renderer.
  ipcMain.handle(
    REVEAL_APP_LOG_CHANNEL,
    (event): RevealAppLogResult => {
      if (!mainWindow || event.sender !== mainWindow.webContents) {
        logger?.info("ipc.reveal-app-log", "Rejected reveal-app-log request.", {
          code: "unauthorized_sender",
        });
        return { ok: false, code: "unauthorized_sender" };
      }
      if (!appLogPath || !existsSync(appLogPath)) {
        logger?.info("ipc.reveal-app-log", "App log file missing.", {
          code: "log_missing",
        });
        return { ok: false, code: "log_missing" };
      }
      try {
        shell.showItemInFolder(appLogPath);
        return { ok: true };
      } catch (error) {
        logger?.error("ipc.reveal-app-log", error, { code: "shell_failure" });
        return { ok: false, code: "shell_failure" };
      }
    },
  );

  // Read only the recent, already-redacted entries for the in-app diagnostics view.
  // The absolute log path remains Main-owned and never crosses the bridge.
  ipcMain.handle(
    READ_APP_LOG_CHANNEL,
    (event, input: unknown): ReadAppLogResult => {
      if (!mainWindow || event.sender !== mainWindow.webContents) {
        logger?.info("ipc.read-app-log", "Rejected read-app-log request.", {
          code: "unauthorized_sender",
        });
        return { ok: false, code: "unauthorized_sender" };
      }
      const request = parseReadAppLogRequest(input);
      if (!request) {
        logger?.info("ipc.read-app-log", "Rejected malformed app-log filter.", {
          code: "malformed_request",
        });
        return { ok: false, code: "malformed_request" };
      }
      if (!appLogPath || !existsSync(appLogPath)) {
        logger?.info("ipc.read-app-log", "App log file missing.", {
          code: "log_missing",
        });
        return { ok: false, code: "log_missing" };
      }
      try {
        return {
          ok: true,
          entries: logger?.readRecent(500, {
            redactPaths: true,
            automationCorrelationId: request.automationCorrelationId,
          }) ?? [],
          fileName: "serpent.log",
        };
      } catch (error) {
        logger?.error("ipc.read-app-log", error, { code: "read_failure" });
        return { ok: false, code: "read_failure" };
      }
    },
  );

  // 文本输入右键：仅授权主窗口弹出 role 编辑菜单；Renderer 只传坐标。
  ipcMain.handle(
    SHOW_EDIT_CONTEXT_MENU_CHANNEL,
    (event, input: unknown): ShowEditContextMenuResult => {
      if (!mainWindow || event.sender !== mainWindow.webContents) {
        logger?.info("ipc.show-edit-context-menu", "Rejected edit context menu.", {
          code: "unauthorized_sender",
        });
        return { ok: false, code: "unauthorized_sender" };
      }
      const result = popupEditContextMenu(event.sender, input);
      if (!result.ok) {
        logger?.info("ipc.show-edit-context-menu", "Rejected edit context menu.", {
          code: result.code,
        });
      }
      return result;
    },
  );

  // Serpent-166q: text-field ⌘C fallback when Edit menu routes through renderer.
  ipcMain.handle(NATIVE_EDIT_COPY_CHANNEL, (event): void => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return;
    event.sender.copy();
  });

  // Bootstrap dialog locale from OS before Renderer syncs (Serpent-bwb).
  appLocale = mapSystemLocaleToAppLocale(app.getLocale());

  ipcMain.on(APP_LOCALE_CHANNEL, (event, input: unknown) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) {
      logger?.info("ipc.app-locale", "Rejected app-locale update.", {
        code: "unauthorized_sender",
      });
      return;
    }
    const parsed = tryParseAppLocaleSync(input);
    if (!parsed.ok) {
      logger?.info("ipc.app-locale", "Dropped malformed app-locale update.", {
        code: parsed.code,
        issuePaths: parsed.issuePaths,
      });
      return;
    }
    appLocale = parsed.locale;
    installApplicationMenu({ locale: appLocale });
    windowsTray?.updateLocale(appLocale);
  });

  ipcMain.on(ACTIVE_CONTEXT_CHANNEL, (event, input: unknown) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) {
      logger?.info("ipc.active-context", "Rejected active-context update.", {
        code: "unauthorized_sender",
      });
      return;
    }
    const parsed = tryParseActiveContext(input);
    if (!parsed.ok) {
      logger?.info("ipc.active-context", "Dropped malformed active-context update.", {
        code: parsed.code,
        issuePaths: parsed.issuePaths,
      });
      return;
    }
    const windowId = BrowserWindow.fromWebContents(event.sender)?.id;
    if (windowId !== undefined) {
      focusedContexts.set(windowId, parsed.context);
      if (parsed.context.libraryId) {
        lastExtensionTargetWindowId = windowId;
      }
      if (
        extensionBrowseFoldersStorePath &&
        parsed.context.libraryId &&
        parsed.context.selectedFolderId
      ) {
        recordExtensionBrowseFolder(
          extensionBrowseFoldersStorePath,
          parsed.context.libraryId,
          parsed.context.selectedFolderId,
        );
      }
    }
  });

  ipcMain.on(DESKTOP_AUTOMATION_BROWSE_RESULT_CHANNEL, (event, payload: unknown) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) {
      logger?.info('ipc.desktop-browse', 'Rejected Desktop browse response.', {
        code: 'unauthorized_sender',
      });
      return;
    }
    desktopBrowseControl?.handleResult(event.sender, payload);
  });

  ipcMain.on(VIEWER_VIDEO_SHORTCUTS_ACTIVE_CHANNEL, (event, input: unknown) => {
    const active =
      typeof input === "object" &&
      input !== null &&
      "active" in input &&
      Boolean((input as { active?: unknown }).active);
    setViewerVideoShortcutCaptureActive(event.sender, active);
  });

  ipcMain.on(PLUGIN_INPUT_CAPTURE_EVENT_CHANNEL, (event, payload: unknown) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) {
      logger?.info('ipc.plugin-input-capture', 'Rejected input capture event.', {
        code: 'unauthorized_sender',
      });
      return;
    }
    const parsed = parsePluginInputCapturePublishPayload(payload);
    if (parsed === null) return;
    const result = pluginInputCaptureBroker?.publish(parsed);
    if (result === 'queued') schedulePluginInputCaptureFlush();
    if (result === 'released') publishPluginInputCaptureSessionsToRenderer();
  });

  ipcMain.on(PLUGIN_INPUT_CAPTURE_SYSTEM_MODAL_CHANNEL, (event, payload: unknown) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) {
      logger?.info('ipc.plugin-input-capture', 'Rejected system modal seam.', {
        code: 'unauthorized_sender',
      });
      return;
    }
    const parsed = parsePluginInputCaptureSystemModalPayload(payload);
    if (parsed === null) return;
    pluginInputCaptureBroker?.setSystemModalActive(parsed.active);
  });

  // Install before the first window so macOS does not keep Electron's default
  // View→Zoom accelerators that steal Cmd+=/-/0 (Serpent-46i9).
  // Windows: hides menu bar for frameless shell (Serpent-znex).
  installApplicationMenu({ locale: appLocale });

  registerWindowControls({
    getMainWindow: () => mainWindow,
    logger,
  });

  if (mcpModeEnabled) {
    if (!automationExecutionJournal || !automationCommandGateway || !workerClient || !logger) {
      throw new Error('MCP mode requires journal, gateway, worker, and logger.');
    }
    redirectConsoleToStderrForMcp();
    const startedMcpHost = await maybeStartAutomationMcpMode({
      journal: automationExecutionJournal,
      gateway: automationCommandGateway,
      request: (command) => workerClient!.request(command),
      onLibraryChanged: (listener) => workerClient!.onLibraryChanged(listener),
      logger,
      pluginTools: pluginMcpToolProvider,
    });
    if (startedMcpHost === null) {
      throw new Error('SERPENT_MCP=1 but MCP host did not start.');
    }
    automationMcpHost = startedMcpHost;
    startupComplete = true;
    return;
  }

  await createMainWindow();
  desktopBrowseControl = createDesktopBrowseControl({
    getWebContents: () =>
      mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null,
  });

  if (desktopControlEnabled) {
    if (!automationExecutionJournal || !automationCommandGateway || !workerClient || !logger) {
      throw new Error('Desktop attached MCP requires journal, gateway, worker, and logger.');
    }
    void startDesktopAttachedMcp({
      userDataPath: app.getPath('userData'),
      journal: automationExecutionJournal,
      gateway: automationCommandGateway,
      getActiveLibraryId: () => {
        if (!mainWindow || mainWindow.isDestroyed()) return null;
        return focusedContexts.get(mainWindow.id)?.libraryId ?? null;
      },
      getLibrarySummary: async (libraryId) => {
        const result = await workerClient!.request({ type: 'library.list' });
        if (!result.ok || result.type !== 'library.list') return null;
        const library = result.libraries.find((entry) => entry.libraryId === libraryId);
        return library === undefined
          ? null
          : { libraryId: library.libraryId, displayName: library.displayName };
      },
      confirmAttach: confirmDesktopMcpAttach,
      focusMainWindow,
      applySelection: applyDesktopAutomationSelection,
      browseControl: desktopBrowseControl,
      pluginTools: pluginMcpToolProvider,
      logger,
    }).then((handle) => {
      desktopAttachedMcp = handle;
    }).catch((error: unknown) => {
      logger?.error('desktop.attached-mcp.start', error);
    });
  }
  windowsTray = createWindowsTray({
    getMainWindow: () => mainWindow,
    onQuit: () => app.quit(),
    locale: appLocale,
  });

  extensionBrowseFoldersStorePath = path.join(
    app.getPath("userData"),
    "extension-recent-browse-folders.json",
  );

  // Start the browser-extension HTTP server on 127.0.0.1.
  try {
    extensionServer = await createExtensionServer({
      port: 19876,
      uploadStagingRoot: app.getPath("temp"),
      onListFolders: handleListFolders,
      onSaveIntent: handleSaveIntent,
      onSaveUpload: handleSaveUpload,
      onError: (err) => logger?.error("extension-server", err),
    });
    logger?.info(
      "extension-server",
      `Browser extension server started on port ${extensionServer.port}.`,
    );
  } catch (error) {
    logger?.error("extension-server", error);
    // Extension server failure is non-fatal; the app continues without it.
  }

  startupComplete = true;
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", handleSecondInstance);

  app
    .whenReady()
    .then(startApplication)
    .catch((error: unknown) => {
      logger?.error("main.startup", error);
      dialog.showErrorBox(
        "Serpent could not start",
        toPublicError(error).message,
      );
      app.quit();
    });

  app.on("activate", () => {
    if (!startupComplete || mcpModeEnabled) return;
    if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
    else focusMainWindow();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("will-quit", () => {
    windowsTray?.destroy();
    windowsTray = undefined;
  });

  app.on("before-quit", (event) => {
    aiQueueScheduler.clearAll();
    if (quitAfterShutdown || !workerClient) return;
    event.preventDefault();

    // Slice E: fail in-flight model thumbnail renders and destroy the window.
    offscreenThumbnailRenderer?.dispose();
    offscreenThumbnailRenderer = undefined;

    pluginActivationCoordinator?.dispose('supervisor-shutdown');

    // Close the extension server early; stop accepting new save intents.
    try {
      extensionServer?.server.close();
      extensionServer = undefined;
    } catch {
      // Best effort.
    }

    const mcpClose = automationMcpHost?.close() ?? Promise.resolve();
    const desktopAttachedMcpClose = desktopAttachedMcp?.close() ?? Promise.resolve();
    desktopBrowseControl?.close();
    void Promise.all([mcpClose, desktopAttachedMcpClose])
      .catch((error: unknown) => {
        logger?.error("automation.mcp.close", error);
      })
      .then(() => workerClient?.shutdown())
      .finally(() => {
        quitAfterShutdown = true;
      // The first app.quit() is intentionally intercepted above while the
      // worker drains. Once the worker is shut down there is nothing left to
      // close asynchronously; app.exit() completes the already-authorized
      // application shutdown instead of re-entering the quit lifecycle and
      // leaving a hidden Electron process behind on Windows.
      app.exit(0);
      });
  });
}
