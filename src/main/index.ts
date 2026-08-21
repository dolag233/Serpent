import path from "node:path";
import { spawn } from "node:child_process";
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
import type { MessageBoxOptions, NativeImage } from "electron";

import {
  installApplicationMenu,
  setApplicationMenuCommandEnabled,
  setApplicationMenuCommandLabel,
} from "./application-menu";
import { applyDevAppIcon, appIconImage } from "./app-icon";
import {
  NativeAssetDragCache,
  startNativeAssetDrag,
} from "./native-asset-drag";
import {
  clearViewerVideoShortcutCapture,
  isViewerVideoShortcutContentsActive,
  setViewerVideoShortcutCaptureActive,
} from "./viewer-video-shortcut-capture";
import { forwardViewerVideoShortcut } from "./viewer-video-shortcut-forward";
import { forwardBrowseShortcut } from "./browse-shortcut-forward";
import { setWindowsBrowseShortcutAcceleratorsEnabled } from "./viewer-video-shortcut-menu";
import { matchBrowseKeyboardShortcut } from "../shared/browse-keyboard-shortcuts";
import {
  selectImportSources as selectImportSourcesDialog,
  selectLibraryDirectory,
  selectOpenDirectory,
  selectOpenLibrarySource,
  selectOpenFile,
  selectSavePath,
  type NativeDialogHost,
} from "./native-dialogs";
import {
  materializeExternalLibrarySource,
  type MaterializedExternalLibrarySource,
} from "./external-library-archive";
import {
  mapSystemLocaleToAppLocale,
  tryParseAppLocaleSync,
  type AppLocale,
} from "../shared/native-dialog-i18n";
import {
  createAppUpdateService,
  type AppUpdateService,
} from './app-update-service';
import type {
  AppUpdateCheckResult,
  AppUpdateInstallResult,
} from '../shared/app-update';

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
  ASSET_NATIVE_DRAG_CHANNEL,
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
  APP_UPDATE_CHECK_CHANNEL,
  APP_UPDATE_INSTALL_CHANNEL,
  APP_UPDATE_CANCEL_CHANNEL,
  APP_UPDATE_PROGRESS_CHANNEL,
  REVEAL_APP_LOG_CHANNEL,
  READ_APP_LOG_CHANNEL,
  SHOW_EDIT_CONTEXT_MENU_CHANNEL,
  SHELL_NOTIFY_CHANNEL,
  COMMAND_COMPLETED_CHANNEL,
  APPLICATION_MENU_ITEM_STATE_CHANNEL,
  SHELL_SWIPE_CHANNEL,
  WINDOW_FOCUS_CHANNEL,
  NATIVE_EDIT_COPY_CHANNEL,
  PLUGIN_MANAGER_CHANNEL,
  PLUGIN_INSTALL_PROGRESS_CHANNEL,
  PLUGIN_CONTRIBUTIONS_CHANGED_CHANNEL,
  PLUGIN_INPUT_CAPTURE_EVENT_CHANNEL,
  PLUGIN_INPUT_CAPTURE_SESSIONS_CHANNEL,
  PLUGIN_INPUT_CAPTURE_SYSTEM_MODAL_CHANNEL,
  VIEWER_VIDEO_SHORTCUTS_ACTIVE_CHANNEL,
  BROWSE_SHORTCUT_MENU_ENABLED_CHANNEL,
  OFFSCREEN_THUMBNAIL_FRAME_CHANNEL,
  MCP_SETTINGS_REQUEST_CHANNEL,
  MCP_SETTINGS_EVENT_CHANNEL,
} from "../shared/protocol/channels";
import {
  createAutomationCommandGateway,
  type AutomationCommandGateway,
} from '../automation/command-gateway';
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
  AutomationLibraryContextError,
  createJsonFileAutomationExecutionStore,
  projectAutomationExecutionStatus,
} from './automation-execution-journal';
import { createJsonFileAutomationIdempotencyStore } from './automation-idempotency-store';
import { EmbeddedMcpServer, EmbeddedMcpServerError } from './embedded-mcp-server';
import { McpPermissionBroker } from './mcp-permission-broker';
import { McpPermissionPolicyStore } from './mcp-permission-policy-store';
import { McpOperationChallengeStore } from './mcp-operation-challenge';
import { CriticalConfirmationWindowManager } from './critical-confirmation-window';
import {
  mcpSettingsRequestSchema,
  mcpSettingsResponseSchema,
  mcpSettingsSnapshotSchema,
  type McpSettingsRequest,
} from '../shared/mcp';
import { normalizeWebDAVBaseUrl } from '../shared/sync-paths';
import { registerAutomationScriptIpc } from './automation-script-ipc';
import { AutomationScriptFileService } from './automation-script-file-service';
import {
  createJsonFileAutomationRecentScriptsStore,
  type AutomationRecentScriptsStore,
} from './automation-recent-scripts-store';
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
import {
  AUTOMATION_API_VERSION,
  type AutomationCommandId,
  type AutomationSource,
} from '../automation/command-registry';
import {
  shouldHideApplicationMenuBar,
  shouldUseFramelessTitleBar,
} from "../shared/window-controls";
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
  LibraryParentError,
  resolveWritableLibraryParent,
} from "../worker/library-parent";
import {
  parseNativeAssetDragRequest,
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
import { LibraryWorkerClient, WorkerRequestTimeoutError } from "./worker-client";
import { SyncAutoScheduler, type SyncBindingLike } from "./sync-auto-scheduler";
import { resolveImageSequenceImportPaths } from "./image-sequence-import";
import { AppLogger } from "./app-logger";
import { chooseUniqueSessionLogPath, pruneSessionLogs } from "./session-log";
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
import { PreviewCache } from "./preview-cache";
import {
  bindLibraryMediaReadSignal,
  blockLibraryMediaReads,
  isLibraryMediaReadBlocked,
  unblockLibraryMediaReads,
} from "./library-media-reads";
import {
  createOffscreenThumbnailRenderer,
  packagedRendererOutDir,
  resolveOffscreenPageUrl,
  type OffscreenThumbnailRenderer,
} from "./offscreen-thumbnail-renderer";
import { renderDocumentThumbnail } from "./document-thumbnail-renderer";
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

// Dev multi-instance (Serpent-i6xg): isolate userData so SingletonLock / prefs
// do not collide. Prefer `npm run start:multi`. Do not open the same library
// for writes from two GUIs — SQLite write coordination is CLI/desktop lease
// territory (ADR-0021), not dual-GUI.
const allowMultiInstance = process.env.SERPENT_ALLOW_MULTI_INSTANCE === "1";
if (allowMultiInstance && process.env.SERPENT_E2E !== "1") {
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
/** 自动同步调度器（Serpent-bfsb 后续），随 Worker 生命周期启停。 */
let syncAutoScheduler: SyncAutoScheduler | undefined;
type ArtifactPathBatchWaiter = {
  artifactId: string;
  resolve: (absolutePath: string) => void;
  reject: (error: Error) => void;
};
const artifactPathBatches = new Map<string, ArtifactPathBatchWaiter[]>();

function resolveArtifactPathBatched(
  libraryId: string,
  artifactId: string,
  usage: "preview" | "proxy",
): Promise<string> {
  const key = `${libraryId}\u0000${usage}`;
  return new Promise<string>((resolve, reject) => {
    const batch = artifactPathBatches.get(key) ?? [];
    batch.push({ artifactId, resolve, reject });
    artifactPathBatches.set(key, batch);
    if (batch.length > 1) return;
    setTimeout(() => {
      const pending = artifactPathBatches.get(key) ?? [];
      artifactPathBatches.delete(key);
      const client = workerClient;
      if (!client) {
        const error = new Error("Library Worker is unavailable.");
        for (const waiter of pending) waiter.reject(error);
        return;
      }
      void (async () => {
        for (let index = 0; index < pending.length; index += 500) {
          const chunk = pending.slice(index, index + 500);
          try {
            const result = await client.request({
              type: "media.get-artifact-paths",
              libraryId,
              artifactIds: chunk.map((waiter) => waiter.artifactId),
              usage,
            });
            if (!result.ok || result.type !== "media.artifact-paths") {
              throw new Error("Artifact path batch lookup failed.");
            }
            const paths = new Map(
              result.entries.map((entry) => [entry.artifactId, entry.absolutePath]),
            );
            for (const waiter of chunk) {
              const absolutePath = paths.get(waiter.artifactId);
              if (absolutePath) waiter.resolve(absolutePath);
              else waiter.reject(new Error("Artifact was absent from path batch."));
            }
          } catch (error) {
            const failure = error instanceof Error ? error : new Error(String(error));
            for (const waiter of chunk) waiter.reject(failure);
          }
        }
      })();
    }, 2);
  });
}
const nativeAssetDragCache = new NativeAssetDragCache();
/**
 * Serpent-1e3d4f: Chromium never persists custom-protocol responses on disk,
 * so every session re-reads preview bytes from (possibly remote) origin.
 * Mirror served image previews into userData and serve later sessions from
 * there. Image mimes only — video proxies/posters would thrash the budget
 * with Range-streamed large files.
 */
let previewCache: PreviewCache | undefined;
function initializePreviewCache(): void {
  if (process.env.SERPENT_PREVIEW_CACHE_DISABLED === "1") return;
  // E2E suites manipulate artifact files and rows directly; a mirror would
  // serve phantom bytes. Probes that verify the cache opt in explicitly.
  if (process.env.SERPENT_E2E === "1" && process.env.SERPENT_PREVIEW_CACHE_FORCE !== "1") {
    return;
  }
  const budgetBytes = Number(process.env.SERPENT_PREVIEW_CACHE_BUDGET_BYTES ?? "");
  const cacheLogEnabled = process.env.SERPENT_PREVIEW_CACHE_LOG === "1";
  previewCache = new PreviewCache({
    rootDir: path.join(app.getPath("userData"), "preview-cache"),
    budgetBytes: Number.isFinite(budgetBytes) && budgetBytes > 0 ? budgetBytes : 2 * 1024 * 1024 * 1024,
    onEvent: cacheLogEnabled
      ? (event) => logger?.info("preview-cache", `${event.kind} ${event.libraryId} ${event.artifactId}${event.detail ? ` ${event.detail}` : ""}`)
      : undefined,
  });
  void previewCache.evictToBudget();
}
/** Slice E: shared offscreen window that renders model thumbnails (Serpent-hnmg). */
let offscreenThumbnailRenderer: OffscreenThumbnailRenderer | undefined;
let quitAfterShutdown = false;
let startupComplete = false;
let logger: AppLogger | undefined;
let appLogPath: string | undefined;
let appUpdateService: AppUpdateService | undefined;
let automationExecutionJournal: AutomationExecutionJournal | undefined;
let embeddedMcpServer: EmbeddedMcpServer | undefined;
let automationCommandGateway: AutomationCommandGateway | undefined;
let mcpPermissionPolicyStore: McpPermissionPolicyStore | undefined;
let mcpOperationChallengeStore: McpOperationChallengeStore | undefined;
let mcpPermissionBroker: McpPermissionBroker | undefined;
let criticalConfirmationWindowManager: CriticalConfirmationWindowManager | undefined;
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

function rememberOpenedLibrary(libraryPath: string, displayName: string, libraryId?: string): void {
  rememberRecentLibrary(
    recentLibraryPath(),
    { path: libraryPath, name: displayName, ...(libraryId === undefined ? {} : { libraryId }) },
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

// External-library source chosen and validated; Renderer never receives the
// path. For archive sources this is the extracted temporary root. Cleared
// after destination is chosen, on inspect cancel, or when a new inspect starts.
let pendingEagleOpenSourcePath: string | undefined;
let pendingBillfishOpenSourcePath: string | undefined;

// Archive-backed external libraries are extracted into Main-owned temporary
// directories. The Worker only receives the extracted root; these callbacks
// ensure the archive contents do not remain on disk after the operation.
const externalSourceCleanups = new Map<string, () => Promise<void>>();

function rememberExternalSource(materialized: MaterializedExternalLibrarySource): string {
  externalSourceCleanups.set(materialized.sourceRootPath, materialized.cleanup);
  return materialized.sourceRootPath;
}

async function cleanupExternalSource(sourceRootPath: string | undefined): Promise<void> {
  if (!sourceRootPath) return;
  const cleanup = externalSourceCleanups.get(sourceRootPath);
  if (!cleanup) return;
  externalSourceCleanups.delete(sourceRootPath);
  try {
    await cleanup();
  } catch (error) {
    logger?.error("external-library.archive-cleanup", error, { sourceRootPath });
  }
}

async function cleanupAllExternalSources(): Promise<void> {
  const sourceRoots = [...externalSourceCleanups.keys()];
  await Promise.all(sourceRoots.map((sourceRootPath) => cleanupExternalSource(sourceRootPath)));
}

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

// ── Serpent-xffq: 同步服务器（全局）与库绑定持久化 ───────────────────
interface SyncServerRecord {
  id: string;
  baseUrl: string;
  username?: string;
  /** safeStorage 加密后的密码（base64）。 */
  passwordEncrypted?: string;
  allowInsecureTls: boolean;
}

interface SyncBindingRecord {
  serverId: string;
  /** 同步文件夹名称（远端目录名，默认库名）。 */
  directoryName?: string;
  /** 旧格式字段：subPath 曾是同步文件夹名（Serpent-xffq 早期）；读取时兼容。 */
  subPath?: string;
  /** 上次成功同步时间（ISO 字符串）。 */
  lastSyncedAt?: string;
  /** 自动同步开关（用户决定：在资源库设置里开启/关闭）。 */
  enabled?: boolean;
  /** 云端变化轮询间隔（毫秒，用户可设置；缺省 5000）。 */
  pollIntervalMs?: number;
}

/** 兼容旧格式绑定：directoryName 优先，其次旧 subPath。 */
function effectiveSyncDirectoryName(binding: SyncBindingRecord | undefined): string | undefined {
  return binding?.directoryName ?? binding?.subPath;
}

function syncServersPath(): string {
  return path.join(app.getPath("userData"), "sync-servers.json");
}

function syncBindingsPath(): string {
  return path.join(app.getPath("userData"), "sync-bindings.json");
}

function readSyncServers(): SyncServerRecord[] {
  try {
    const parsed = JSON.parse(readFileSync(syncServersPath(), "utf-8")) as unknown;
    if (Array.isArray(parsed)) return parsed as SyncServerRecord[];
  } catch {
    // 首次运行。
  }
  return [];
}

function writeSyncServers(servers: SyncServerRecord[]): void {
  writeFileSync(syncServersPath(), JSON.stringify(servers, null, 2), "utf-8");
}

function readSyncBindings(): Record<string, SyncBindingRecord> {
  try {
    const parsed = JSON.parse(readFileSync(syncBindingsPath(), "utf-8")) as unknown;
    if (parsed && typeof parsed === "object") return parsed as Record<string, SyncBindingRecord>;
  } catch {
    // 首次运行。
  }
  return {};
}

function writeSyncBindings(bindings: Record<string, SyncBindingRecord>): void {
  writeFileSync(syncBindingsPath(), JSON.stringify(bindings, null, 2), "utf-8");
}

function resolveSyncServerCredentials(serverId: string): {
  baseUrl: string;
  username?: string;
  password?: string;
  allowInsecureTls: boolean;
} | null {
  const server = readSyncServers().find((entry) => entry.id === serverId);
  if (!server) return null;
  let password: string | undefined;
  if (server.passwordEncrypted) {
    try {
      password = safeStorage.decryptString(Buffer.from(server.passwordEncrypted, "base64"));
    } catch {
      password = undefined;
    }
  }
  return {
    baseUrl: server.baseUrl,
    username: server.username,
    password,
    allowInsecureTls: server.allowInsecureTls,
  };
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
  // Serpent-tluf: the macOS dock otherwise shows the default Electron icon
  // in dev builds (packaged apps ship the real .icns).
  if (process.platform === "darwin" && devIcon) {
    app.dock?.setIcon(devIcon);
  }

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
    if (shouldHideApplicationMenuBar(process.platform)) {
      const browseAction = matchBrowseKeyboardShortcut({
        type: input.type,
        code: input.code,
        key: input.key,
        keyCode: (input as { keyCode?: number }).keyCode,
        control: input.control,
        meta: input.meta,
        alt: input.alt,
        shift: input.shift,
      });
      if (browseAction) {
        forwardBrowseShortcut(window.webContents, browseAction);
      }
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

async function closeOpenLibrariesBeforeReplacement(): Promise<string[]> {
  const previousPaths: string[] = [];
  if (!workerClient) return previousPaths;
  try {
    const listed = await workerClient.request({ type: "library.list" });
    if (!listed.ok || listed.type !== "library.list") return previousPaths;
    for (const library of listed.libraries) {
      previousPaths.push(library.libraryPath);
      try {
        const closed = await workerClient.request({
          type: "library.close",
          libraryId: library.libraryId,
        });
        if (!closed.ok || closed.type !== "library.closed") continue;
        nativeAssetDragCache.clear(library.libraryId);
        clearActiveRecentLibrary(recentLibraryPath(), (error) => {
          logger?.error("recent-library.clear", error);
        });
        publishLifecycle({
          type: "library.closed",
          libraryId: library.libraryId,
        });
      } catch (error) {
        logger?.error("external-library-open.close-previous", error, {
          libraryId: library.libraryId,
        });
      }
    }
  } catch (error) {
    logger?.error("external-library-open.list-previous", error);
  }
  return previousPaths;
}

async function reopenLibrariesAfterFailedReplacement(
  libraryPaths: readonly string[],
): Promise<void> {
  if (!workerClient || libraryPaths.length === 0) return;
  for (const selectedLibraryPath of libraryPaths) {
    try {
      const opened = await workerClient.request({
        type: "library.open",
        selectedLibraryPath,
      });
      if (!opened.ok || opened.type !== "library.opened") continue;
      publishLifecycle({
        type: "library.opened",
        library: {
          libraryId: opened.library.libraryId,
          displayName: opened.library.displayName,
          displayPath: opened.library.libraryPath,
        },
        source: "replacement-restore",
      });
    } catch (error) {
      logger?.error("external-library-open.restore-previous", error, {
        selectedLibraryPath,
      });
    }
  }
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
        networkStorage: result.library.networkStorage,
        libraryVersion: result.library.libraryVersion,
        supportedSchemaVersion: result.library.supportedSchemaVersion,
        // Serpent-verg.5: read-only because the migration is stuck.
        migrationStuck: result.library.migrationStuck,
        // Keep the recovery report path inside Main/Worker. Renderer receives
        // only a boolean affordance so the filesystem boundary stays intact.
        recovery: result.library.recovery
          ? {
              mode: result.library.recovery.mode,
              ...(result.library.recovery.reportPath
                ? { reportAvailable: true }
                : {}),
              ...(result.library.recovery.recoveredAssetCount === undefined
                ? {}
                : { recoveredAssetCount: result.library.recovery.recoveredAssetCount }),
              ...(result.library.recovery.metadataRecovered === undefined
                ? {}
                : { metadataRecovered: result.library.recovery.metadataRecovered }),
              ...(result.library.recovery.metadataLosses === undefined
                ? {}
                : { metadataLosses: result.library.recovery.metadataLosses }),
            }
          : undefined,
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
        networkStorage: result.library.networkStorage,
      },
    });
  }
  if (result.type === "asset.recovery-probe") {
    return parseRendererResult({
      ok: true,
      type: "asset.recovery-probe.result",
      assetId: result.assetId,
      probe: result.probe,
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
        networkStorage: library.networkStorage,
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

async function primeNativeAssetDragCache(
  libraryId: string,
  assetIds: readonly string[],
  mode: "replace" | "upsert",
): Promise<void> {
  if (!workerClient || assetIds.length === 0) {
    if (mode === "replace") nativeAssetDragCache.replace(libraryId, []);
    return;
  }
  try {
    const result = await workerClient.request({
      type: "media.get-asset-drag-infos",
      libraryId,
      assetIds: [...new Set(assetIds)],
    });
    if (!result.ok || result.type !== "media.asset-drag-infos") return;
    if (mode === "replace") {
      nativeAssetDragCache.replace(libraryId, result.entries);
    } else {
      nativeAssetDragCache.upsert(libraryId, result.entries);
    }
  } catch (error) {
    logger?.info(
      "main.native-asset-drag-cache",
      "Could not preheat native drag entries.",
      {
        libraryId,
        assetCount: assetIds.length,
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

/**
 * Serpent-v4jf: how many sorted-list-head assets to prime synchronously before
 * a card-bearing response reaches the renderer. The head of the sorted list is
 * exactly the first screen the user sees; priming more than a screenful before
 * forwarding only delays the browse result.
 */
const NATIVE_DRAG_PRIME_VISIBLE_COUNT = 500;

/**
 * Fire-and-forget primer for the rest of a large browse result. Chunked so a
 * 50k result does not post one giant worker request and does not hold the
 * worker for a single long burst; each chunk is a normal upsert.
 */
async function primeNativeAssetDragCacheInBackground(
  libraryId: string,
  assetIds: readonly string[],
): Promise<void> {
  const chunkSize = 5_000;
  for (let i = 0; i < assetIds.length; i += chunkSize) {
    const chunk = assetIds.slice(i, i + chunkSize);
    await primeNativeAssetDragCache(libraryId, chunk, "upsert");
    // Yield between chunks so unrelated worker traffic (thumbnail events,
    // progress pushes) is not starved behind a long prime.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
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

let cachedSyncDeviceId: string | undefined;

/** Serpent-xffq：每台设备的稳定同步身份（userData 持久化，非敏感）。 */
function syncDeviceId(): string {
  if (cachedSyncDeviceId) return cachedSyncDeviceId;
  const file = path.join(app.getPath('userData'), 'sync-device.json');
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as { deviceId?: string };
    if (typeof parsed.deviceId === 'string' && parsed.deviceId.length > 0) {
      cachedSyncDeviceId = parsed.deviceId;
      return parsed.deviceId;
    }
  } catch {
    // 首次运行。
  }
  const deviceId = randomUUID();
  try {
    writeFileSync(file, JSON.stringify({ deviceId }), 'utf-8');
  } catch {
    // 写入失败仍返回本次进程内稳定 ID。
  }
  cachedSyncDeviceId = deviceId;
  return deviceId;
}

async function commandFor(
  request: RendererRequest,
  callbacks?: {
    onBillfishSourceSelected?: () => void;
  },
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
    case "library.recovery-report.request":
      // The Worker resolves the report path from its Main-owned library state;
      // Renderer only receives a shell acknowledgement.
      return { type: "library.recovery-report", libraryId: request.libraryId };
    case "library.inspect-eagle.request": {
      await cleanupExternalSource(pendingEagleOpenSourcePath);
      pendingEagleOpenSourcePath = undefined;
      await cleanupExternalSource(pendingBillfishOpenSourcePath);
      pendingBillfishOpenSourcePath = undefined;
      const selectedSourcePath = await selectOpenLibrarySource(
        createNativeDialogHost(),
        "openEagleLibrary",
        process.env.SERPENT_E2E_OPEN_EAGLE_LIBRARY,
        ["zip", "eaglepack", "rar", "7z", "tar", "gz", "tgz", "bz2", "tbz", "tbz2", "xz", "txz"],
      );
      if (!selectedSourcePath) return undefined;
      const materialized = await materializeExternalLibrarySource({
        sourcePath: selectedSourcePath,
        kind: "eagle",
        tempDirectory: tmpdir(),
      });
      const sourceRootPath = rememberExternalSource(materialized);
      return sourceRootPath
        ? { type: "library.inspect-eagle", sourceRootPath }
        : undefined;
    }
    case "library.inspect-billfish.request": {
      await cleanupExternalSource(pendingBillfishOpenSourcePath);
      pendingBillfishOpenSourcePath = undefined;
      await cleanupExternalSource(pendingEagleOpenSourcePath);
      pendingEagleOpenSourcePath = undefined;
      const selectedSourcePath = await selectOpenFile(
        createNativeDialogHost(),
        "openBillfishLibrary",
        process.env.SERPENT_E2E_OPEN_BILLFISH_LIBRARY,
        [{ name: "Billfish Pack", extensions: ["billfishpack"] }],
      );
      if (!selectedSourcePath) return undefined;
      callbacks?.onBillfishSourceSelected?.();
      const materialized = await materializeExternalLibrarySource({
        sourcePath: selectedSourcePath,
        kind: "billfish",
        tempDirectory: tmpdir(),
      });
      const sourceRootPath = rememberExternalSource(materialized);
      return sourceRootPath
        ? {
            type: "library.inspect-billfish",
            sourceRootPath,
            ...(materialized.sourceDisplayName === undefined
              ? {}
              : { sourceDisplayName: materialized.sourceDisplayName }),
          }
        : undefined;
    }
    case "library.inspect-eagle.cancel.request":
      await cleanupExternalSource(pendingEagleOpenSourcePath);
      pendingEagleOpenSourcePath = undefined;
      return undefined;
    case "library.inspect-billfish.cancel.request":
      await cleanupExternalSource(pendingBillfishOpenSourcePath);
      pendingBillfishOpenSourcePath = undefined;
      return undefined;
    case "library.open-eagle.request": {
      const sourceRootPath = pendingEagleOpenSourcePath;
      if (!sourceRootPath) return undefined;
      const selectedParentPath = await selectOpenDirectory(
        createNativeDialogHost(),
        "openEagleLibraryDestination",
        process.env.SERPENT_E2E_OPEN_EAGLE_PARENT,
        { createDirectory: true },
      );
      return selectedParentPath
        ? {
            type: "library.open-eagle",
            sourceRootPath,
            selectedParentPath,
            displayName: request.displayName,
          }
        : undefined;
    }
    case "library.open-billfish.request": {
      const sourceRootPath = pendingBillfishOpenSourcePath;
      if (!sourceRootPath) return undefined;
      const selectedParentPath = await selectOpenDirectory(
        createNativeDialogHost(),
        "openEagleLibraryDestination",
        process.env.SERPENT_E2E_OPEN_BILLFISH_PARENT,
        { createDirectory: true },
      );
      return selectedParentPath
        ? {
            type: "library.open-billfish",
            sourceRootPath,
            selectedParentPath,
            displayName: request.displayName,
          }
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
    case "history.status.request":
      return { type: "history.status", libraryId: request.libraryId };
    case "history.undo.request":
      return {
        type: "history.undo",
        libraryId: request.libraryId,
        expectedHistoryEntryId: request.expectedHistoryEntryId,
      };
    case "history.redo.request":
      return {
        type: "history.redo",
        libraryId: request.libraryId,
        expectedHistoryEntryId: request.expectedHistoryEntryId,
      };
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
    case "selection.trash.request":
      return {
        type: "selection.trash",
        libraryId: request.libraryId,
        assetIds: request.assetIds,
        folderIds: request.folderIds,
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
    case "asset.import-eagle.request": {
      const selectedSourcePath = await selectOpenLibrarySource(
        createNativeDialogHost(),
        "importEagleLibrary",
        process.env.SERPENT_E2E_IMPORT_EAGLE_LIBRARY,
        ["zip", "eaglepack", "rar", "7z", "tar", "gz", "tgz", "bz2", "tbz", "tbz2", "xz", "txz"],
      );
      if (!selectedSourcePath) return undefined;
      const materialized = await materializeExternalLibrarySource({
        sourcePath: selectedSourcePath,
        kind: "eagle",
        tempDirectory: tmpdir(),
      });
      const sourceRootPath = rememberExternalSource(materialized);
      return sourceRootPath
        ? {
            type: "asset.import-eagle",
            libraryId: request.libraryId,
            sourceRootPath,
          }
        : undefined;
    }
    case "asset.import-billfish.request": {
      const selectedSourcePath = await selectOpenFile(
        createNativeDialogHost(),
        "importBillfishLibrary",
        process.env.SERPENT_E2E_IMPORT_BILLFISH_LIBRARY,
        [{ name: "Billfish Pack", extensions: ["billfishpack"] }],
      );
      if (!selectedSourcePath) return undefined;
      const materialized = await materializeExternalLibrarySource({
        sourcePath: selectedSourcePath,
        kind: "billfish",
        tempDirectory: tmpdir(),
      });
      const sourceRootPath = rememberExternalSource(materialized);
      return sourceRootPath
        ? {
            type: "asset.import-billfish",
            libraryId: request.libraryId,
            sourceRootPath,
          }
        : undefined;
    }
    case "asset.import-drop.request":
      // Classified in handleLibraryRequest because classification failures need
      // a renderer-safe, specific public error instead of an INTERNAL_ERROR.
      return undefined;
    case "asset.resolve-dropped-paths.request":
      return {
        type: "media.resolve-asset-paths",
        libraryId: request.libraryId,
        sourcePaths: request.sourcePaths,
      };
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
        idsOnly: request.idsOnly,
        layoutOnly: request.layoutOnly,
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
        idsOnly: request.idsOnly,
        layoutOnly: request.layoutOnly,
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
    case "ai.pending-assets.request":
      return {
        type: "ai.pending-assets.request",
        libraryId: request.libraryId,
        assetIds: request.assetIds,
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
    case "asset.thumbnail.visible-window.request":
      return {
        type: "asset.thumbnail.visible-window",
        libraryId: request.libraryId,
        assetIds: request.assetIds,
      };
    case "sync.probe.request": {
      const server = resolveSyncServerCredentials(request.serverId);
      if (!server) throw new Error("同步服务器不存在，请先在通用设置中配置。");
      return {
        type: "sync.probe",
        baseUrl: server.baseUrl,
        username: server.username,
        password: server.password,
        allowInsecureTls: server.allowInsecureTls,
      };
    }
    case "sync.preview.request": {
      const server = resolveSyncServerCredentials(request.serverId);
      if (!server) throw new Error("同步服务器不存在，请先在通用设置中配置。");
      return {
        type: "sync.preview",
        libraryId: request.libraryId,
        deviceId: syncDeviceId(),
        baseUrl: server.baseUrl,
        username: server.username,
        password: server.password,
        allowInsecureTls: server.allowInsecureTls,
        directoryName: request.directoryName,
      };
    }
    case "sync.run.request": {
      const server = resolveSyncServerCredentials(request.serverId);
      if (!server) throw new Error("同步服务器不存在，请先在通用设置中配置。");
      return {
        type: "sync.run",
        libraryId: request.libraryId,
        deviceId: syncDeviceId(),
        baseUrl: server.baseUrl,
        username: server.username,
        password: server.password,
        allowInsecureTls: server.allowInsecureTls,
        directoryName: request.directoryName,
      };
    }
    case "sync.list-remote-libraries.request": {
      const server = resolveSyncServerCredentials(request.serverId);
      if (!server) throw new Error("同步服务器不存在，请先在通用设置中配置。");
      return {
        type: "sync.list-remote-libraries",
        baseUrl: server.baseUrl,
        username: server.username,
        password: server.password,
        allowInsecureTls: server.allowInsecureTls,
      };
    }
    case "sync.open-remote-library.request": {
      const server = resolveSyncServerCredentials(request.serverId);
      if (!server) throw new Error("同步服务器不存在，请先在通用设置中配置。");
      const host = createNativeDialogHost();
      const selectedParentPath = await selectOpenDirectory(
        host,
        "openSyncLibraryDestination",
        process.env.SERPENT_E2E_OPEN_SYNC_LIBRARY_PARENT,
        { createDirectory: true },
      );
      if (!selectedParentPath) return undefined;
      return {
        type: "sync.open-remote-library",
        baseUrl: server.baseUrl,
        username: server.username,
        password: server.password,
        allowInsecureTls: server.allowInsecureTls,
        libraryId: request.libraryId,
        displayName: request.displayName,
        directoryName: request.directoryName,
        selectedParentPath,
      };
    }
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
    case "asset.recovery-probe.request":
      return {
        type: "asset.recovery-probe",
        libraryId: request.libraryId,
        assetId: request.assetId,
      };
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
    case "sync.servers.list.request":
    case "sync.servers.upsert.request":
    case "sync.servers.delete.request":
    case "sync.library.binding.save.request":
    case "sync.library.binding.get.request":
      // Main-owned local config; handled before Worker dispatch.
      return undefined;
    default:
      return assertNever(request);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Renderer request: ${String(value)}`);
}

/** 测试连接的最大尝试次数（含首次）。 */
const SYNC_PROBE_MAX_ATTEMPTS = 3;
const SYNC_PROBE_RETRY_DELAY_MS = [1_000, 2_000];

/**
 * 测试连接（sync.probe）：单次请求超时或网络类失败后自动重试，
 * 最大重试后返回带“已自动重试”提示的可读错误（用户决定 2026-08-17）。
 * 认证失败等确定性错误不重试，直接返回。
 */
async function runSyncProbeWithRetry(
  command: Extract<WorkerCommand, { type: "sync.probe" }>,
): Promise<WorkerResult> {
  if (!workerClient) throw new Error("Library Worker is unavailable.");
  let lastError: WorkerResult & { ok: false } | undefined;
  let lastTimeout = false;
  for (let attempt = 0; attempt < SYNC_PROBE_MAX_ATTEMPTS; attempt += 1) {
    try {
      const result = await workerClient.request(command);
      if (result.ok) return result;
      // 确定性错误（认证失败/服务器不支持等）不重试。
      if (!isRetryableProbeError(result.error)) return result;
      lastError = result;
    } catch (error) {
      if (error instanceof WorkerRequestTimeoutError) {
        lastTimeout = true;
      } else {
        throw error;
      }
    }
    if (attempt < SYNC_PROBE_MAX_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, SYNC_PROBE_RETRY_DELAY_MS[attempt] ?? 1_000));
    }
  }
  if (lastTimeout) {
    return {
      ok: false,
      error: createPublicError("SYNC_CONNECTION_FAILED", "SYNC_TIMEOUT"),
    } satisfies WorkerResult;
  }
  return lastError ?? {
    ok: false,
    error: createPublicError("SYNC_CONNECTION_FAILED", "SYNC_NETWORK"),
  } satisfies WorkerResult;
}

function isRetryableProbeError(error: { code: string; reason?: string }): boolean {
  if (error.code !== "SYNC_CONNECTION_FAILED") return false;
  return (
    error.reason === "SYNC_TIMEOUT"
    || error.reason === "SYNC_DNS"
    || error.reason === "SYNC_CONNECTION_REFUSED"
    || error.reason === "SYNC_NETWORK"
  );
}

async function handleLibraryRequest(input: unknown): Promise<RendererResult> {
  let operation: "create" | "open" | "import" | "open-eagle" | "open-billfish" | undefined;
  let lifecyclePublished = false;
  let clipboardStageDirectory: string | undefined;
  let command: WorkerCommand | undefined;
  let retainExternalSource = false;
  let deleteFromDiskLibraryId: string | undefined;
  let relinkPreviewContext:
    | { libraryId: string; previewId: string }
    | undefined;
  let previousLibraryPaths: string[] = [];
  try {
    const request = parseRendererRequest(input);

    if (criticalRendererRequest(request)) {
      logger?.info(
        'critical-confirmation.route',
        'Routing a renderer request through the critical confirmation window.',
        { requestType: request.type },
      );
      if (!(await confirmCriticalRendererRequest(request))) return cancelled();
    }

    if (request.type === "library.delete-from-disk.request") {
      // Drop serpent:// file handles before the Worker tries to rm the root.
      deleteFromDiskLibraryId = request.libraryId;
      blockLibraryMediaReads(request.libraryId);
      nativeAssetDragCache.clear(request.libraryId);
    }

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

    if (request.type === "library.inspect-eagle.cancel.request") {
      await cleanupExternalSource(pendingEagleOpenSourcePath);
      pendingEagleOpenSourcePath = undefined;
      return {
        ok: true,
        type: "library.eagle-inspect-cancelled",
      } satisfies RendererResult;
    }

    if (request.type === "library.inspect-billfish.cancel.request") {
      await cleanupExternalSource(pendingBillfishOpenSourcePath);
      pendingBillfishOpenSourcePath = undefined;
      return {
        ok: true,
        type: "library.billfish-inspect-cancelled",
      } satisfies RendererResult;
    }

    // Serpent-xffq: 同步服务器与库绑定是 Main 本地配置（凭据经 safeStorage）。
    if (request.type === "sync.servers.list.request") {
      const servers = readSyncServers().map((server) => ({
        id: server.id,
        baseUrl: server.baseUrl,
        username: server.username,
        hasPassword: server.passwordEncrypted !== undefined,
        allowInsecureTls: server.allowInsecureTls,
      }));
      return { ok: true, type: "sync.servers.listed", servers } satisfies RendererResult;
    }

    if (request.type === "sync.servers.upsert.request") {
      const servers = readSyncServers();
      const id = request.id ?? randomUUID();
      // Serpent-fatf: 保存时即校验/规范化 URL（缺协议自动补 http://），
      // 让非法地址在保存瞬间给出可读提示，而不是等到连接时才报笼统错误。
      // 远端码体系已删除 INVALID_SYNC_URL，用 SYNC_CONNECTION_FAILED +
      // SYNC_INVALID_URL reason 表达同一语义。
      const normalized = normalizeWebDAVBaseUrl(request.baseUrl);
      if (!normalized.ok) {
        return {
          ok: false,
          error: createPublicError("SYNC_CONNECTION_FAILED", "SYNC_INVALID_URL"),
        } satisfies RendererResult;
      }
      const passwordEncrypted = request.password
        ? safeStorage.encryptString(request.password).toString("base64")
        : request.id
          ? (servers.find((entry) => entry.id === id)?.passwordEncrypted)
          : undefined;
      const record: SyncServerRecord = {
        id,
        baseUrl: normalized.value,
        username: request.username || undefined,
        passwordEncrypted,
        allowInsecureTls: request.allowInsecureTls ?? false,
      };
      const existing = servers.findIndex((entry) => entry.id === id);
      if (existing >= 0) servers[existing] = record;
      else servers.push(record);
      writeSyncServers(servers);
      return { ok: true, type: "sync.server.saved", id } satisfies RendererResult;
    }

    if (request.type === "sync.servers.delete.request") {
      writeSyncServers(readSyncServers().filter((entry) => entry.id !== request.id));
      return { ok: true, type: "sync.server.deleted", id: request.id } satisfies RendererResult;
    }

    if (request.type === "sync.library.binding.save.request") {
      const bindings = readSyncBindings();
      const previous = bindings[request.libraryId];
      bindings[request.libraryId] = {
        serverId: request.serverId,
        directoryName: request.directoryName,
        lastSyncedAt: previous?.lastSyncedAt,
        enabled: request.enabled ?? previous?.enabled ?? false,
        pollIntervalMs: request.pollIntervalMs ?? previous?.pollIntervalMs,
      };
      writeSyncBindings(bindings);
      // Serpent-7405ef: 保存绑定（含开启自动同步）后立即触发一次同步，
      // 用户不需要等下一个 5s 轮询周期（更不会等不到同步）。
      const savedBinding = bindings[request.libraryId];
      if (savedBinding?.enabled) {
        syncAutoScheduler?.syncNow(request.libraryId);
      }
      return {
        ok: true,
        type: "sync.binding.saved",
        libraryId: request.libraryId,
        serverId: request.serverId,
        directoryName: request.directoryName,
        enabled: request.enabled ?? previous?.enabled ?? false,
      } satisfies RendererResult;
    }

    if (request.type === "sync.library.binding.get.request") {
      const binding = readSyncBindings()[request.libraryId] ?? null;
      return {
        ok: true,
        type: "sync.binding.got",
        libraryId: request.libraryId,
        binding: binding
          ? {
              serverId: binding.serverId,
              directoryName: effectiveSyncDirectoryName(binding),
              lastSyncedAt: binding.lastSyncedAt,
              enabled: binding.enabled ?? false,
              pollIntervalMs: binding.pollIntervalMs,
            }
          : null,
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
          // 手动分析可覆盖已有 AI 结果（8-09 WIP 恢复：worker 已支持）
          forceExisting: true,
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
          // 手动分析可覆盖已有 AI 结果（8-09 WIP 恢复：worker 已支持）
          forceExisting: true,
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
      command = await commandFor(
        request,
        request.type === "library.inspect-billfish.request"
          ? {
              onBillfishSourceSelected: () => {
                operation = "open-billfish";
                lifecyclePublished = true;
                publishLifecycle({
                  type: "library.opening",
                  operation: "open-billfish",
                });
              },
            }
          : undefined,
      );
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
    // Billfish inspection is the first point at which a validated source is
    // ready to replace the active library. Detach the old library before the
    // name panel appears, so a slow archive/metadata read is visible as an
    // opening operation instead of looking like a stale browse session.
    if (command.type === "library.inspect-billfish") operation = "open-billfish";
    if (command.type === "library.open-eagle" || command.type === "library.open-billfish") {
      try {
        const selectedParentPath = resolveWritableLibraryParent({
          selectedParentPath: command.selectedParentPath,
          sourceRootPath: command.sourceRootPath,
          createIfMissing: true,
        });
        command = { ...command, selectedParentPath };
      } catch (error) {
        if (error instanceof LibraryParentError) {
          return {
            ok: false,
            error: createPublicError(error.code, error.reason),
          } satisfies RendererResult;
        }
        throw error;
      }
      if (command.type === "library.open-eagle") {
        pendingEagleOpenSourcePath = undefined;
        operation = "open-eagle";
      } else {
        pendingBillfishOpenSourcePath = undefined;
        operation = "open-billfish";
      }
    }
    if (operation && !lifecyclePublished) publishLifecycle({ type: "library.opening", operation });
    if (command.type === "library.open-eagle" || command.type === "library.open-billfish") {
      previousLibraryPaths = await closeOpenLibrariesBeforeReplacement();
    }

    // 测试连接（sync.probe）：单次超时后自动重试，最大重试后给出提醒
    // （用户决定 2026-08-17；传输数据本身无墙钟超时）。
    const workerResult = command.type === "sync.probe"
      ? await runSyncProbeWithRetry(command)
      : await workerClient.request(command);
    if (!workerResult.ok && previousLibraryPaths.length > 0) {
      await reopenLibrariesAfterFailedReplacement(previousLibraryPaths);
    }

    if (
      request.type === "library.delete-from-disk.request" &&
      !workerResult.ok &&
      workerResult.error.code !== "LIBRARY_NOT_FOUND" &&
      workerResult.error.code !== "NOT_A_LIBRARY"
    ) {
      unblockLibraryMediaReads(request.libraryId);
    }

    if (
      command.type === "library.open-eagle" ||
      command.type === "library.open-billfish" ||
      command.type === "asset.import-eagle" ||
      command.type === "asset.import-billfish"
    ) {
      await cleanupExternalSource(command.sourceRootPath);
    } else if (
      command.type === "library.inspect-eagle" ||
      command.type === "library.inspect-billfish"
    ) {
      const expectedType = command.type === "library.inspect-eagle"
        ? "library.eagle-inspected"
        : "library.billfish-inspected";
      if (workerResult.ok && workerResult.type === expectedType) retainExternalSource = true;
      else await cleanupExternalSource(command.sourceRootPath);
    }

    // Native file drag must be requested during renderer dragstart.
    // Preheat every card-bearing result before it reaches Renderer; a later
    // Worker round trip would miss Electron's native drag window. Upserting
    // instead of replacing avoids an auxiliary count query evicting the cards
    // visible in a concurrent search request.
    //
    // Serpent-v4jf: only the visible first screen (the sorted list head, i.e.
    // what the user actually sees and can drag immediately) blocks the
    // response. The rest primes in fire-and-forget chunks so a 50k browse
    // result no longer stalls the renderer behind a full-cache worker burst.
    const nativeDragAssets = !workerResult.ok
      ? []
      : workerResult.type === "asset.list" ||
          workerResult.type === "collection.assets.list" ||
          workerResult.type === "asset.list-trash"
        ? workerResult.assets
        : workerResult.type === "asset.search.result" ||
            workerResult.type === "smart-collection.executed"
          ? workerResult.items
          : [];
    if (
      nativeDragAssets.length > 0 &&
      "libraryId" in request &&
      typeof request.libraryId === "string"
    ) {
      const dragAssetIds = nativeDragAssets.flatMap((asset) =>
        asset.sequence?.frames.map((frame) => frame.assetId) ?? [asset.assetId],
      );
      await primeNativeAssetDragCache(
        request.libraryId,
        dragAssetIds.slice(0, NATIVE_DRAG_PRIME_VISIBLE_COUNT),
        "upsert",
      );
      const rest = dragAssetIds.slice(NATIVE_DRAG_PRIME_VISIBLE_COUNT);
      if (rest.length > 0) {
        void primeNativeAssetDragCacheInBackground(
          request.libraryId,
          rest,
        );
      }
    }

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
        workerResult.library.libraryId,
      );
    } else if (
      workerResult.ok &&
      workerResult.type === "library.eagle-inspected" &&
      command.type === "library.inspect-eagle"
    ) {
      pendingEagleOpenSourcePath = command.sourceRootPath;
    } else if (
      workerResult.ok &&
      workerResult.type === "library.billfish-inspected" &&
      command.type === "library.inspect-billfish"
    ) {
      pendingBillfishOpenSourcePath = command.sourceRootPath;
    } else if (workerResult.ok && workerResult.type === "library.renamed") {
      rememberOpenedLibrary(
        workerResult.library.libraryPath,
        workerResult.library.displayName,
        workerResult.library.libraryId,
      );
    } else if (workerResult.ok && workerResult.type === "library.imported") {
      rememberOpenedLibrary(workerResult.libraryPath, workerResult.displayName, workerResult.libraryId);
    } else if (workerResult.ok && workerResult.type === "library.deleted") {
      removeRecentLibrary(
        recentLibraryPath(),
        workerResult.libraryPath,
        (error) => {
          logger?.error("recent-library.remove", error);
        },
      );
    }

    // Serpent-xffq: 同步成功即记录绑定与上次同步时间，供“已同步”状态展示。
    if (workerResult.ok && request.type === "sync.run.request") {
      const syncBindings = readSyncBindings();
      const previous = syncBindings[request.libraryId];
      syncBindings[request.libraryId] = {
        serverId: request.serverId,
        directoryName: request.directoryName ?? effectiveSyncDirectoryName(previous),
        lastSyncedAt: new Date().toISOString(),
        enabled: previous?.enabled ?? false,
      };
      writeSyncBindings(syncBindings);
    }

    // 打开同步资源库成功：自动绑定服务器并开启自动同步（用户决定），
    // 免去手动进入资源库设置重选服务器；此后本地变更/云端变更自动同步。
    if (workerResult.ok && request.type === "sync.open-remote-library.request") {
      const syncBindings = readSyncBindings();
      const previous = syncBindings[request.libraryId];
      syncBindings[request.libraryId] = {
        serverId: request.serverId,
        directoryName: request.directoryName ?? effectiveSyncDirectoryName(previous),
        lastSyncedAt: new Date().toISOString(),
        enabled: true,
      };
      writeSyncBindings(syncBindings);
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
          logger?.error("main.open-external", new Error(openError));
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
          logger?.error(
            "main.copy-asset-files",
            new Error("clipboard file copy produced no file list"),
          );
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
      request.type === "asset.resolve-dropped-paths.request" &&
      workerResult.type === "media.asset-ids-resolved"
    ) {
      return {
        ok: true,
        type: "asset.dropped-paths.resolved",
        assetIds: workerResult.assetIds,
      } satisfies RendererResult;
    }
    if (
      workerResult.ok &&
      request.type === "folder.open-in-file-manager.request" &&
      workerResult.type === "folder.path"
    ) {
      try {
        const openError = await shell.openPath(workerResult.absolutePath);
        if (openError) {
          logger?.error(
            "main.open-folder-in-file-manager",
            new Error(openError),
          );
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
          logger?.error(
            "main.copy-folder-files",
            new Error("clipboard file copy produced no file list"),
          );
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

    // Auto-analyze on import: after a successful ordinary import
    // (resolveImport or importFolderAsLinked), enqueue AI analysis for
    // imported images. Eagle/external-library imports intentionally do not
    // enter this branch: importing an external catalogue must never enqueue
    // thousands of AI jobs, even when the global auto-analyze preference is on.
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

    if (
      workerResult.ok &&
      request.type === "library.recovery-report.request" &&
      workerResult.type === "library.recovery-report"
    ) {
      try {
        // Keep the report path Main-owned. Showing the containing directory
        // also lets users inspect the quarantined damaged database beside it.
        shell.showItemInFolder(workerResult.reportPath);
        return {
          ok: true,
          type: "library.recovery-report.requested",
          libraryId: request.libraryId,
        } satisfies RendererResult;
      } catch (error) {
        logger?.error("main.recovery-report", error);
        return {
          ok: false,
          error: createPublicError("INTERNAL_ERROR"),
        } satisfies RendererResult;
      }
    }

    // A Billfish archive has no stable library root name after extraction:
    // the worker sees a temporary `serpent-external-library-*` directory.
    // Keep the archive stem as the user-facing default all the way through
    // the Main→Renderer boundary, even if an older worker response falls
    // back to that temporary directory name.
    const rendererWorkerResult =
      workerResult.ok &&
      workerResult.type === "library.billfish-inspected" &&
      command.type === "library.inspect-billfish" &&
      command.sourceDisplayName
        ? { ...workerResult, displayName: command.sourceDisplayName }
        : workerResult;
    const result = toRendererResult(
      rendererWorkerResult,
      relinkPreviewContext?.previewId,
    );
    if (!result.ok) {
      if (operation) {
        publishLifecycle({
          type: "library.open-failed",
          operation,
          error: result.error,
        });
        // Serpent-s0oq: an invalid recent library (folder gone, corrupt, or
        // unmigratable) must disappear from every recent list — the switcher
        // menu and the no-library create dialog share the same store. Only
        // deterministic invalid-open codes remove the entry; transient
        // failures (picker cancel, busy) keep it.
        if (
          operation === "open" &&
          command.type === "library.open" &&
          (result.error?.code === "LIBRARY_NOT_FOUND" ||
            result.error?.code === "LIBRARY_CORRUPT" ||
            result.error?.code === "LIBRARY_MIGRATION_FAILED" ||
            result.error?.code === "LIBRARY_VERSION_TOO_NEW")
        ) {
          removeRecentLibrary(
            recentLibraryPath(),
            (command as { selectedLibraryPath: string }).selectedLibraryPath,
            (error) => {
              logger?.error("recent-library.remove-invalid", error);
            },
          );
        }
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
      nativeAssetDragCache.clear(result.libraryId);
      clearActiveRecentLibrary(recentLibraryPath(), (error) => {
        logger?.error("recent-library.clear", error);
      });
      publishLifecycle({ type: "library.closed", libraryId: result.libraryId });
    } else if (result.type === "library.deleted") {
      nativeAssetDragCache.clear(result.libraryId);
      publishLifecycle({ type: "library.closed", libraryId: result.libraryId });
    }
    return result;
  } catch (error) {
    if (deleteFromDiskLibraryId) {
      unblockLibraryMediaReads(deleteFromDiskLibraryId);
    }
    if (relinkPreviewContext) {
      pendingRelinkPreviews.cancel(
        relinkPreviewContext.libraryId,
        relinkPreviewContext.previewId,
      );
    }
    logger?.error("main.library-request", error);
    if (previousLibraryPaths.length > 0) {
      await reopenLibrariesAfterFailedReplacement(previousLibraryPaths);
    }
    const publicError = error instanceof LibraryParentError
      ? createPublicError(error.code, error.reason)
      : error instanceof WorkerRequestTimeoutError
        ? createPublicError("INTERNAL_ERROR", "LIBRARY_TRANSFER_TIMEOUT")
        : toPublicError(error);
    if (operation) {
      publishLifecycle({
        type: "library.open-failed",
        operation,
        error: publicError,
      });
    }
    return { ok: false, error: publicError };
  } finally {
    if (!retainExternalSource) {
      const sourceRootPath =
        command?.type === "library.inspect-eagle" ||
        command?.type === "library.open-eagle" ||
        command?.type === "asset.import-eagle" ||
        command?.type === "library.inspect-billfish" ||
        command?.type === "library.open-billfish" ||
        command?.type === "asset.import-billfish"
          ? command.sourceRootPath
          : undefined;
      await cleanupExternalSource(sourceRootPath);
    }
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

async function confirmDesktopAutomationFilePlan(
  plan: DesktopAutomationFilePlanSummary,
  context?: {
    source: AutomationSource;
    executionId: string;
    clientName?: string;
    libraryDisplayName?: string;
  },
): Promise<boolean> {
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
    message: context?.source === 'mcp'
      ? `${context.clientName ?? 'MCP 客户端'} 请求${action} ${plan.executableCount} 项资产${context.libraryDisplayName ? `（资源库“${context.libraryDisplayName}”）` : ''}。`
      : `准备${action} ${plan.executableCount} 项资产。`,
    detail: [
      ...(context?.source === 'mcp'
        ? ['这是 MCP 客户端发起的文件操作；请确认目标和数量后再执行。']
        : []),
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

async function confirmCriticalLibraryDeletion(libraryId: string): Promise<boolean> {
  const manager = criticalConfirmationWindowManager;
  const client = workerClient;
  if (manager === undefined || client === undefined) return false;
  const listed = await client.request({ type: 'library.list' });
  if (!listed.ok || listed.type !== 'library.list') return false;
  const library = listed.libraries.find((candidate) => candidate.libraryId === libraryId);
  if (library === undefined) return false;
  const english = appLocale === 'en';
  return manager.request({
    title: english ? 'Confirm critical operation' : '确认危险操作',
    heading: english ? 'Delete this library from disk?' : '从磁盘删除这个资源库？',
    message: english
      ? `The library “${library.displayName}” and its Serpent-managed directory will be permanently deleted.`
      : `资源库“${library.displayName}”及其 Serpent 管理的目录将被永久删除。`,
    detail: english
      ? 'This cannot be undone. Linked-folder source directories are not included. This confirmation is required every time and cannot be remembered or bypassed by MCP permissions.'
      : '此操作无法撤销。关联文件夹的源目录不会被删除。每次操作都必须确认；不能记住此决定，也不能通过 MCP 权限或“开启所有权限”绕过。',
    cancelLabel: english ? 'Cancel' : '取消',
    confirmLabel: english ? 'Delete from disk' : '从磁盘删除',
  });
}

async function confirmEnableAllMcpPermissions(label: string): Promise<boolean> {
  const manager = criticalConfirmationWindowManager;
  if (manager === undefined) return false;
  const english = appLocale === 'en';
  return manager.request({
    title: english ? 'Confirm full access' : '确认开启完全权限',
    heading: english ? 'Enable Full Access for this MCP client?' : '为这个 MCP 客户端开启完全权限？',
    message: english
      ? `“${label}” will be allowed to execute every MCP operation, including dangerous operations, without asking again.`
      : `客户端“${label}”将可以直接执行所有 MCP 操作，包括永久删除等危险操作，之后不再询问。`,
    detail: english
      ? 'This applies only to this client credential. Serpent still enforces exact targets, path boundaries, version checks, idempotency and worker safety checks. Disable Full Access or revoke the credential to stop it immediately.'
      : '此设置只作用于当前客户端凭据。Serpent 仍会执行精确目标、路径边界、版本校验、幂等和 Worker 安全检查。关闭完全权限或删除凭据即可立即停止。',
    cancelLabel: english ? 'Cancel' : '取消',
    confirmLabel: english ? 'Enable Full Access' : '开启完全权限',
  });
}

function criticalRendererRequest(request: RendererRequest): boolean {
  return request.type === 'library.delete-from-disk.request'
    || request.type === 'folder.delete-from-disk.request'
    || request.type === 'asset.delete-from-disk.request'
    || request.type === 'asset.delete-permanent.request'
    || request.type === 'trash.purge.request'
    || (request.type === 'linked-folder.delete-subtree.request' && request.deleteFromDisk);
}

async function confirmCriticalRendererRequest(request: RendererRequest): Promise<boolean> {
  if (request.type === 'library.delete-from-disk.request') {
    return confirmCriticalLibraryDeletion(request.libraryId);
  }
  const manager = criticalConfirmationWindowManager;
  if (manager === undefined) return false;
  const english = appLocale === 'en';
  const operation = request.type === 'folder.delete-from-disk.request'
    ? 'folder'
    : request.type === 'linked-folder.delete-subtree.request'
      ? 'linked-folder'
      : request.type === 'asset.delete-permanent.request'
        ? 'asset-permanent'
        : request.type === 'trash.purge.request'
          ? 'trash-purge'
          : 'asset';
  const count = request.type === 'asset.delete-from-disk.request'
    || request.type === 'asset.delete-permanent.request'
    ? request.assetIds.length
    : undefined;
  const heading = operation === 'folder'
    ? (english ? 'Delete this folder from disk?' : '从磁盘删除这个文件夹？')
    : operation === 'linked-folder'
      ? (english ? 'Delete linked-folder files from disk?' : '从磁盘删除链接文件夹内容？')
      : operation === 'asset-permanent'
        ? (english ? 'Permanently delete these trash assets?' : '永久删除这些回收站资产？')
        : operation === 'trash-purge'
          ? (english ? 'Empty the Serpent trash permanently?' : '永久清空 Serpent 回收站？')
          : (english ? 'Delete these assets from disk?' : '从磁盘删除这些资产？');
  const message = operation === 'folder'
    ? (english ? 'The selected folder and its managed assets will be permanently deleted.' : '选定文件夹及其中的托管资产将被永久删除。')
    : operation === 'linked-folder'
      ? (english ? 'The selected linked-folder source files will be permanently deleted.' : '选定链接文件夹中的源文件将被永久删除。')
      : operation === 'asset-permanent'
        ? (english ? `${count ?? 0} selected trash asset(s) will be permanently deleted.` : `选定的 ${count ?? 0} 项回收站资产将被永久删除。`)
        : operation === 'trash-purge'
          ? (english ? 'All assets currently in the Serpent trash will be permanently deleted.' : 'Serpent 回收站中的全部资产将被永久删除。')
          : (english ? `${count ?? 0} selected asset(s) will be permanently deleted.` : `选定的 ${count ?? 0} 项资产将被永久删除。`);
  return manager.request({
    title: english ? 'Confirm critical operation' : '确认危险操作',
    heading,
    message,
    detail: english
      ? 'This cannot be undone and the files will not go to the application trash. This confirmation is required every time; it cannot be remembered or bypassed by MCP permissions.'
      : '此操作无法撤销，文件不会进入应用回收站。每次操作都必须确认；不能记住此决定，也不能通过 MCP 权限绕过。',
    cancelLabel: english ? 'Cancel' : '取消',
    confirmLabel: english ? 'Delete permanently' : '永久删除',
  });
}

async function executeMcpLibraryContextCommand(input: {
  commandId: 'library.list-open' | 'library.list-recent' | 'library.open' | 'library.show-in-desktop';
  executionId: string;
  context: AutomationExecutionContext;
  commandInput: unknown;
}): Promise<unknown> {
  if (input.commandId === 'library.list-recent') {
    return readRecentLibraryEntries(recentLibraryPath(), (error) => {
      logger?.error('recent-library.read', error);
    }).map((entry) => ({
      libraryId: entry.libraryId ?? null,
      displayName: entry.name,
    }));
  }
  const journal = automationExecutionJournal;
  const client = workerClient;
  if (!journal || !client) {
    throw new AutomationLibraryContextError('AUTOMATION_LIBRARY_OPEN_FAILED');
  }
  const listed = await client.request({ type: 'library.list' });
  if (!listed.ok || listed.type !== 'library.list') {
    throw new AutomationLibraryContextError('AUTOMATION_LIBRARY_OPEN_FAILED');
  }
  const libraries = listed.libraries;
  if (input.commandId === 'library.list-open') {
    return {
      libraries: libraries.map((library) => ({
        libraryId: library.libraryId,
        displayName: library.displayName,
        active: false,
      })),
      activeLibraryId: null,
      contextRevision: 0,
    };
  }

  const commandInput = input.commandInput as { libraryId?: string };
  let selected = commandInput.libraryId === undefined
    ? undefined
    : libraries.find((library) => library.libraryId === commandInput.libraryId);
  let needsOpen = false;
  if (input.commandId === 'library.open' && selected === undefined && commandInput.libraryId !== undefined) {
    const recent = readRecentLibraryEntries(recentLibraryPath(), (error) => {
      logger?.error('recent-library.read', error);
    }).find((entry) => entry.libraryId === commandInput.libraryId);
    if (recent === undefined) {
      throw new AutomationLibraryContextError('AUTOMATION_LIBRARY_NOT_OPEN');
    }
    selected = {
      libraryId: recent.libraryId!,
      displayName: recent.name,
      libraryPath: recent.path,
    };
    needsOpen = true;
  }
  if (input.commandId === 'library.open' && selected === undefined) {
    throw new AutomationLibraryContextError('AUTOMATION_LIBRARY_NOT_OPEN');
  }
  if (selected === undefined) {
    throw new AutomationLibraryContextError('AUTOMATION_LIBRARY_NOT_OPEN');
  }
  if (input.commandId === 'library.open') {
    if (selected.libraryId === '' || needsOpen) {
      publishLifecycle({ type: 'library.opening', operation: 'open' });
      const opened = await client.request({
        type: 'library.open',
        selectedLibraryPath: selected.libraryPath,
      });
      if (!opened.ok || opened.type !== 'library.opened') {
        throw new AutomationLibraryContextError('AUTOMATION_LIBRARY_OPEN_FAILED');
      }
      selected = opened.library;
      rememberOpenedLibrary(selected.libraryPath, selected.displayName, selected.libraryId);
      await notifyLibraryOpenedSideEffects({
        libraryId: selected.libraryId,
        libraryDirectory: selected.libraryPath,
      });
      publishLifecycle({
        type: 'library.opened',
        source: 'mcp',
        library: {
          libraryId: selected.libraryId,
          displayName: selected.displayName,
          displayPath: selected.libraryPath,
          ...(selected.readOnly === undefined ? {} : { readOnly: selected.readOnly }),
          ...(selected.networkStorage === undefined ? {} : { networkStorage: selected.networkStorage }),
          ...(selected.libraryVersion === undefined ? {} : { libraryVersion: selected.libraryVersion }),
          ...(selected.supportedSchemaVersion === undefined ? {} : { supportedSchemaVersion: selected.supportedSchemaVersion }),
          ...(selected.migrationStuck === undefined ? {} : { migrationStuck: selected.migrationStuck }),
        },
      });
    }
  }
  if (selected.libraryId === '') {
    throw new AutomationLibraryContextError('AUTOMATION_LIBRARY_OPEN_FAILED');
  }
  if (input.commandId === 'library.show-in-desktop') {
    publishLifecycle({
      type: 'library.opened',
      source: 'mcp',
      library: {
        libraryId: selected.libraryId,
        displayName: selected.displayName,
        displayPath: selected.libraryPath,
      },
    });
  }
  return {
    libraryId: selected.libraryId,
    displayName: selected.displayName,
    contextRevision: 0,
  };
}

async function normalizeMcpCommandInput(input: {
  commandId: AutomationCommandId;
  executionId: string;
  context: AutomationExecutionContext;
  commandInput: unknown;
  signal?: AbortSignal;
}): Promise<unknown | undefined> {
  // MCP always supplies explicit paths. Opening a native picker here would
  // make a supposedly stateless/headless request depend on a human and would
  // recreate the repeated confirmation failure this adapter is designed to
  // eliminate. The Registry MCP schemas validate these fields before this
  // normalizer runs.
  if (input.signal?.aborted) return input.commandInput;
  return input.commandInput;
}

/**
 * A Windows installer keeps its executable locked while it is running, and
 * the main process exits immediately after handing it off. Use a detached
 * cmd helper as a last-mile cleanup fallback so an installer directory that
 * could not be removed before app.quit() is removed after setup releases it.
 * The path is generated by the update service under the OS temp directory.
 */
function scheduleWindowsInstallerCleanup(installerPath: string): void {
  if (process.platform !== "win32") return;
  const outputDirectory = path.dirname(installerPath);
  const command = `ping 127.0.0.1 -n 3 >nul & for /l %i in (1,1,30) do @(del /f /q "${installerPath}" >nul 2>&1 && rmdir /s /q "${outputDirectory}" >nul 2>&1 && exit /b 0 || ping 127.0.0.1 -n 2 >nul)`;
  try {
    const cleanupProcess = spawn(
      process.env.ComSpec ?? "cmd.exe",
      ["/d", "/s", "/c", command],
      { detached: true, stdio: "ignore", windowsHide: true },
    );
    cleanupProcess.once("error", (error) => {
      logger?.error("app-update.cleanup", error, { artifact: outputDirectory });
    });
    cleanupProcess.unref();
  } catch (error) {
    logger?.error("app-update.cleanup", error, { artifact: outputDirectory });
  }
}

async function startApplication(): Promise<void> {
  // Serpent-tluf: the macOS About panel is customized here (ready-late is
  // fine for it); app.setName lives at module top level so the application
  // menu's first item shows "Serpent" from the very first frame.
  if (process.platform === "darwin") {
    app.setAboutPanelOptions({
      applicationName: "Serpent",
      applicationVersion: app.getVersion(),
    });
  }
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
  appLogPath = chooseUniqueSessionLogPath(app.getPath("logs"), new Date());
  logger = new AppLogger(appLogPath);
  appUpdateService = createAppUpdateService({
    currentVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    executablePath: app.getPath('exe'),
    tempDirectory: app.getPath('temp'),
    downloadsDirectory: app.getPath('downloads'),
    environment: process.env,
    openPath: (filePath) => shell.openPath(filePath),
    showItemInFolder: (filePath) => shell.showItemInFolder(filePath),
    launchInstaller: async (installerPath) => {
      if (process.platform === 'win32') {
        spawn(installerPath, [], { detached: true, stdio: 'ignore' }).unref();
        scheduleWindowsInstallerCleanup(installerPath);
      } else {
        const openError = await shell.openPath(installerPath);
        if (openError !== '') throw new Error(openError);
      }
      setImmediate(() => {
        app.quit();
      });
    },
    onDownloadProgress: (progress) => {
      mainWindow?.webContents.send(APP_UPDATE_PROGRESS_CHANNEL, progress);
    },
    logger,
  });
  // Serpent-wgmy: 会话日志最多保留最近 100 份，启动时清理最旧；
  // 清理失败不得阻断启动。
  try {
    pruneSessionLogs(app.getPath("logs"));
  } catch (error) {
    logger?.error("session-log.prune", error);
  }
  criticalConfirmationWindowManager = new CriticalConfirmationWindowManager({
    getParentWindow: () => mainWindow ?? null,
    createWindow: (options) => new BrowserWindow(options),
    ipcMain,
    preloadPath: path.join(__dirname, 'critical-confirmation.js'),
    logger,
  });
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
  // Serpent-8ca259: HTML document thumbnails capture the source in a fresh
  // offscreen window in Main; the Worker persists the artifact bytes.
  workerClient.onDocumentThumbnailRenderRequest((request) =>
    renderDocumentThumbnail(request, logger!),
  );
  automationExecutionJournal = new AutomationExecutionJournal({
    store: createJsonFileAutomationExecutionStore(
      path.join(app.getPath('userData'), 'automation-executions.json'),
    ),
    logger,
  });
  const automationIdempotencyStore = createJsonFileAutomationIdempotencyStore(
    path.join(app.getPath('userData'), 'automation-idempotency.json'),
  );
  mcpPermissionPolicyStore = new McpPermissionPolicyStore(app.getPath('userData'));
  mcpOperationChallengeStore = new McpOperationChallengeStore();
  mcpPermissionBroker = new McpPermissionBroker({
    policyStore: mcpPermissionPolicyStore,
    challengeStore: mcpOperationChallengeStore,
    audit: logger,
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
      idempotencyStore: automationIdempotencyStore,
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
          // Serpent review: ui.notify is strictly non-blocking (toast only);
          // the dialog mode was removed from the registry input schema.
          mainWindow.webContents.send(SHELL_NOTIFY_CHANNEL, {
            severity: input.severity,
            mode: 'toast',
            message: input.message.trim().slice(0, 500),
          });
        },
      },
      filePlanApprovalHandler: createDesktopAutomationFilePlanApprovalHandler({
        workerClient: automationWorkerAdapter,
        audit: { info: (scope, message, context) => logger?.info(scope, message, context) },
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
      permissionBroker: mcpPermissionBroker,
      // Plugin executions are library-scoped Host calls, not Automation
      // Executions owned by the journal. They still use the Gateway for
      // domain access, but must not enter the journal's active-context CAS;
      // doing so rejects every plugin command because no journal record exists
      // for the plugin instance execution id.
      contextBarrier: {
        beginCommand: (executionId, contextRevision) => {
          if (pluginAutomationContexts.has(executionId)) {
            return { release: () => undefined };
          }
          return automationExecutionJournal!.beginCommand(executionId, contextRevision);
        },
      },
      libraryContextHandler: {
        execute: executeMcpLibraryContextCommand,
      },
      // Serpent-ihpx: automation imports (MCP/scripts) are no different from
      // human imports — the same automatic AI analysis side effect fires here,
      // converging on the exact function the desktop import IPC uses.
      onImportCompleted: ({ libraryId, importedAssetIds }) => {
        if (importedAssetIds.length === 0) return;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(SHELL_NOTIFY_CHANNEL, {
            severity: 'info',
            mode: 'toast',
            message: `已导入 ${importedAssetIds.length} 项资源`,
          });
        }
        void enqueueAutoAnalyzeAfterImport(libraryId, importedAssetIds);
      },
      historyEntryHandler: {
        onCommitted: ({ executionId, historyEntryId }) => {
          // The Worker owns the executable history.  Main keeps only the
          // path-free receipt so the script compatibility route can undo all
          // mutations made by one execution without maintaining a second
          // inverse-operation journal.
          automationExecutionJournal?.appendHistoryEntry(executionId, historyEntryId);
        },
      },
      mcpInputNormalizer: normalizeMcpCommandInput,
      libraryBindingHandler: {
        onLibraryCreated: async ({ source, library }) => {
          rememberOpenedLibrary(library.libraryPath, library.displayName, library.libraryId);
          await notifyLibraryOpenedSideEffects({
            libraryId: library.libraryId,
            libraryDirectory: library.libraryPath,
          });
          publishLifecycle({
            type: 'library.opened',
            ...(source === 'mcp' ? { source } : {}),
            library: {
              libraryId: library.libraryId,
              displayName: library.displayName,
              displayPath: library.libraryPath,
            },
          });
        },
        onLibraryClosed: async ({ source, libraryId }) => {
          pluginActivationCoordinator?.onLibraryClosed(libraryId);
          for (const [executionId, context] of pluginAutomationContexts) {
            if (context.libraryId === libraryId) pluginAutomationContexts.delete(executionId);
          }
          clearActiveRecentLibrary(recentLibraryPath(), (error) => {
            logger?.error('recent-library.clear', error);
          });
          publishLifecycle({
            type: 'library.closed',
            libraryId,
            ...(source === 'mcp' ? { source } : {}),
          });
        },
        onLibraryRenamed: async ({ source, library }) => {
          rememberOpenedLibrary(library.libraryPath, library.displayName, library.libraryId);
          publishLifecycle({
            type: 'library.opened',
            ...(source === 'mcp' ? { source } : {}),
            library: {
              libraryId: library.libraryId,
              displayName: library.displayName,
              displayPath: library.libraryPath,
            },
          });
        },
        onLibraryDeleted: async ({ source, libraryId, displayName, libraryPath }) => {
          pluginActivationCoordinator?.onLibraryClosed(libraryId);
          for (const [executionId, context] of pluginAutomationContexts) {
            if (context.libraryId === libraryId) pluginAutomationContexts.delete(executionId);
          }
          removeRecentLibrary(recentLibraryPath(), libraryPath, (error) => {
            logger?.error('recent-library.remove', error);
          });
          publishLifecycle({
            type: 'library.closed',
            libraryId,
            ...(source === 'mcp' ? { source } : {}),
          });
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(SHELL_NOTIFY_CHANNEL, {
              severity: 'info',
              mode: 'toast',
              message: `已删除资源库“${displayName}”`,
            });
          }
        },
        onLibraryImported: async ({ source, libraryId, displayName, libraryPath }) => {
          rememberOpenedLibrary(libraryPath, displayName, libraryId);
          await notifyLibraryOpenedSideEffects({
            libraryId,
            libraryDirectory: libraryPath,
          });
          publishLifecycle({
            type: 'library.opened',
            ...(source === 'mcp' ? { source } : {}),
            library: {
              libraryId,
              displayName,
              displayPath: libraryPath,
            },
          });
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(SHELL_NOTIFY_CHANNEL, {
              severity: 'info',
              mode: 'toast',
              message: `资源库“${displayName}”已导入`,
            });
          }
        },
        transitionLibraryContext: async ({ executionId, source, libraryId, displayName, expectedRevision, authorizationSource }) => {
          const libraries = await activeWorkerClient.request({ type: 'library.list' });
          if (!libraries.ok || libraries.type !== 'library.list') {
            throw new AutomationLibraryContextError('AUTOMATION_LIBRARY_OPEN_FAILED');
          }
          const boundLibrary = libraries.libraries.find((library) => library.libraryId === libraryId);
          if (!boundLibrary) {
            throw new AutomationLibraryContextError('AUTOMATION_LIBRARY_OPEN_FAILED');
          }
          const bound = automationExecutionJournal?.authorizeLibrary(executionId, libraryId);
          const transitioned = automationExecutionJournal?.transitionLibraryContext({
            executionId,
            libraryId,
            ...(displayName === undefined ? {} : { displayName }),
            expectedRevision,
            authorizationSource,
          });
          if (transitioned === undefined || transitioned.libraryId !== libraryId) {
            throw new Error('The automation execution could not bind the created library.');
          }
          if (bound === undefined) {
            throw new AutomationLibraryContextError('AUTOMATION_LIBRARY_CONTEXT_CONFLICT');
          }
          rememberOpenedLibrary(boundLibrary.libraryPath, boundLibrary.displayName, boundLibrary.libraryId);
          await notifyLibraryOpenedSideEffects({
            libraryId: boundLibrary.libraryId,
            libraryDirectory: boundLibrary.libraryPath,
          });
          publishLifecycle({
            type: 'library.opened',
            ...(source === 'mcp' ? { source } : {}),
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
      // Serpent-8b5b.2: plugin host commands are never critical; a challenge
      // outcome is mapped defensively to a gateway failure.
      const failure = 'challenge' in result && result.challenge !== undefined
        ? { code: 'AUTOMATION_CHALLENGE_REQUIRED', message: 'Dangerous operation requires agent confirmation.' }
        : (result as { error: { code: string; message: string } }).error;
      logger?.error('plugin.host-command.gateway-failed', new Error(failure.message ?? failure.code), {
        instanceId: context.instanceId,
        pluginId: context.pluginId,
        commandId,
        errorCode: failure.code,
      });
      throw new PluginHostCommandError(failure.code, failure.message ?? failure.code);
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
        embeddedMcpServer?.notifyToolsChanged();
      },
      logger,
    });
    pluginMcpToolProvider = new PluginMcpToolProvider({
      activationCoordinator: pluginActivationCoordinator,
      exposureStore: pluginMcpExposureStore,
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
  if (!automationExecutionJournal || !automationCommandGateway || !workerClient || !logger) {
    throw new Error('Embedded MCP server requires journal, gateway, worker, and logger.');
  }
  try {
    embeddedMcpServer = new EmbeddedMcpServer({
      userDataPath: app.getPath('userData'),
      journal: automationExecutionJournal,
      gateway: automationCommandGateway,
      workerClient,
      logger,
      getPluginTools: () => pluginMcpToolProvider,
      permissionPolicyStore: mcpPermissionPolicyStore,
      permissionBroker: mcpPermissionBroker,
      // Serpent-fmbr: MCP operations speak through the SAME human-facing toasts
      // as manual operations — the renderer composes them from the structured
      // result. No separate "MCP client completed X" notification system.
      onCommandCompleted: ({ commandId, result }) => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.webContents.send(COMMAND_COMPLETED_CHANNEL, { commandId, result });
      },
    });
    embeddedMcpServer.onSnapshot((snapshot) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        const validatedSnapshot = mcpSettingsSnapshotSchema.parse(snapshot);
        mainWindow.webContents.send(MCP_SETTINGS_EVENT_CHANNEL, validatedSnapshot);
      }
    });
  } catch (error) {
    // Serpent review: an unrecoverable MCP construction failure (e.g. the
    // credential pepper ACL cannot be restricted on Windows) must disable the
    // MCP service, never the whole app — the settings IPC answers
    // MCP_SETTINGS_UNAVAILABLE while embeddedMcpServer stays undefined.
    logger?.error('mcp.embedded-server.construction-failed', error);
  }
  ipcMain.handle(MCP_SETTINGS_REQUEST_CHANNEL, async (event, input: unknown) => {
    const server = embeddedMcpServer;
    const response = (value: unknown) => mcpSettingsResponseSchema.parse(value);
    if (!server || !mainWindow || event.sender !== mainWindow.webContents) {
      logger?.info('mcp.settings', 'Rejected MCP settings request.', { code: 'unauthorized_sender' });
      return response({ ok: false, code: 'MCP_SETTINGS_UNAVAILABLE', message: 'MCP settings are unavailable.', snapshot: server?.snapshot() });
    }
    const parsed = mcpSettingsRequestSchema.safeParse(input);
    if (!parsed.success) {
      return response({ ok: false, code: 'MCP_INVALID_REQUEST', message: 'The MCP settings request is invalid.', snapshot: server.snapshot() });
    }
    const request: McpSettingsRequest = parsed.data;
    try {
      if (request.type === 'get') return response({ ok: true, snapshot: server.snapshot() });
      if (request.type === 'set-auto-start') return response({ ok: true, snapshot: await server.setAutoStart(request.enabled) });
      if (request.type === 'set-access-mode') {
        if (request.mode === 'full-access') {
          const credential = server.snapshot().credentials.find(
            (candidate) => candidate.credentialId === request.credentialId,
          );
          if (credential === undefined || credential.revokedAt !== null) {
            return response({
              ok: false,
              code: 'MCP_CLIENT_UNAUTHORIZED',
              message: 'The MCP client credential is unavailable.',
              snapshot: server.snapshot(),
            });
          }
          if (!(await confirmEnableAllMcpPermissions(credential.label))) {
            return response({
              ok: false,
              code: 'MCP_PERMISSION_CONFIRMATION_CANCELLED',
              message: 'The permission change was cancelled.',
              snapshot: server.snapshot(),
            });
          }
        }
        return response({ ok: true, snapshot: await server.setAccessMode(request.credentialId, request.mode) });
      }
      if (request.type === 'set-port') return response({ ok: true, snapshot: await server.setPort(request.port) });
      if (request.type === 'start') return response({ ok: true, snapshot: await server.start() });
      if (request.type === 'stop') return response({ ok: true, snapshot: await server.stop() });
      if (request.type === 'enable') return response({ ok: true, snapshot: await server.setEnabled(request.enabled) });
      if (request.type === 'revoke-credential') {
        return response({ ok: true, snapshot: await server.revokeCredential(request.credentialId) });
      }
      if (request.type === 'rename-credential') {
        return response({ ok: true, snapshot: server.renameCredential(request.credentialId, request.label) });
      }
      if (request.type === 'duplicate-credential') {
        const duplicated = await server.duplicateCredential(request.credentialId, request.format);
        clipboard.writeText(duplicated.configText);
        return response({
          ok: true,
          copied: true,
          credentialId: duplicated.credentialId,
          snapshot: duplicated.snapshot,
        });
      }
      const config = await server.createClientConfig(request.input.format, request.input.label);
      clipboard.writeText(config.configText);
      return response({ ok: true, copied: true, credentialId: config.credentialId, snapshot: config.snapshot });
    } catch (error) {
      const code = error instanceof EmbeddedMcpServerError ? error.code : 'MCP_SERVER_START_FAILED';
      logger?.error('mcp.settings', error, { code });
      return response({
        ok: false,
        code,
        message: error instanceof EmbeddedMcpServerError ? error.message : 'The MCP operation failed.',
        snapshot: server.snapshot(),
      });
    }
  });
  // Global user-scoped plugins have an application lifetime and must be set up
  // before recent-library restore, including when no library can be reopened.
  await pluginActivationCoordinator?.refreshGlobal();
  workerClient.onAssetsChanged(publishAssetChange);
  workerClient.onLibraryChanged(publishLibraryChanged);
  workerClient.onProgress(publishProgress);
  workerClient.onAiProgress(publishAiProgress);
  workerClient.onAiAnalysisCompleted(publishAiCompleted);
  workerClient.onAiContentCleared(publishAiCleared);
  // 视频 contact sheet / 模型缩略图就绪 = 自动分析的视觉输入边界；导入时
  // 入队可能与该媒体队列竞争，输入就绪时重入队该资产（worker 去重已排队/
  // 运行中/已分析）。8-09 WIP 恢复：worker 解析事件但此前 main 无消费者。
  workerClient.onAiInputReady((event) => {
    void enqueueAutoAnalyzeAfterImport(event.libraryId, [event.assetId]);
  });

  // Serpent-bfsb 后续：自动同步调度器。打开同步资源库后自动绑定并开启
  // （见 handleLibraryRequest 的 sync.open-remote-library.request 成功分支）；
  // 本地资产变更 debounce 后自动同步；固定间隔轮询云端 manifest 变化。
  syncAutoScheduler = new SyncAutoScheduler({
    workerClient,
    deviceId: () => syncDeviceId(),
    readBindings: () => readSyncBindings() as unknown as Record<string, SyncBindingLike>,
    writeBindings: (bindings) => writeSyncBindings(bindings as unknown as Record<string, SyncBindingRecord>),
    resolveCredentials: (serverId) => resolveSyncServerCredentials(serverId),
    logger,
  });
  syncAutoScheduler.start();

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
    if (
      event.type === "asset.thumbnail.ready" ||
      event.type === "asset.thumbnail.failed"
    ) {
      void primeNativeAssetDragCache(
        event.libraryId,
        [event.assetId],
        "upsert",
      );
    }
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
      if (isLibraryMediaReadBlocked(libraryId)) {
        return new Response("Library unavailable", { status: 410 });
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
            if (isLibraryMediaReadBlocked(libraryId)) {
              return new Response("Library unavailable", { status: 410 });
            }
            return createArtifactResponse(
              authorizedSource.absolutePath,
              authorizedSource.mimeType,
              {
                rangeHeader: request.headers.get("range"),
                signal: bindLibraryMediaReadSignal(libraryId, request.signal),
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
        if (isLibraryMediaReadBlocked(libraryId)) {
          return new Response("Library unavailable", { status: 410 });
        }
        try {
          return createArtifactResponse(
            sourceResult.absolutePath,
            sourceResult.mimeType,
            {
              rangeHeader: request.headers.get("range"),
              signal: bindLibraryMediaReadSignal(libraryId, request.signal),
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

      const absoluteArtifactPath = await resolveArtifactPathBatched(
        libraryId,
        artifactId,
        url.hostname,
      );
      const ext = path.extname(absoluteArtifactPath).toLowerCase();
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

      if (isLibraryMediaReadBlocked(libraryId)) {
        return new Response("Library unavailable", { status: 410 });
      }

      // Serpent-1e3d4f: image previews are mirrored into userData on first
      // serve; later sessions stream from the local mirror instead of the
      // (possibly remote) origin. Video proxies/posters stay uncached — they
      // are large and Range-streamed.
      const isCacheableImageMime = mimeType.startsWith("image/");
      const cachedMirror = isCacheableImageMime
        ? previewCache?.locateSync(libraryId, artifactId, ext)
        : null;
      if (cachedMirror) {
        try {
          return createArtifactResponse(
            cachedMirror,
            mimeType,
            {
              rangeHeader: request.headers.get("range"),
              signal: bindLibraryMediaReadSignal(libraryId, request.signal),
              onStreamError: (error) =>
                logger?.error("preview-cache.stream", error, {
                  libraryId,
                  artifactId,
                }),
            },
          );
        } catch {
          // Mirror unreadable (evicted mid-stream, permissions): fall through
          // to the origin and let store() refresh the mirror.
        }
      }

      try {
        const response = createArtifactResponse(
          absoluteArtifactPath,
          mimeType,
          {
            rangeHeader: request.headers.get("range"),
            signal: bindLibraryMediaReadSignal(libraryId, request.signal),
            onStreamError: (error) =>
              logger?.error("serpent-protocol.stream", error, {
                libraryId,
                artifactId,
              }),
          },
        );
        if (isCacheableImageMime && !request.headers.get("range")) {
          void previewCache?.store(libraryId, artifactId, absoluteArtifactPath, ext);
        }
        return response;
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

  ipcMain.on(ASSET_NATIVE_DRAG_CHANNEL, (event, input: unknown) => {
    const dragWindow = mainWindow;
    if (
      !dragWindow ||
      dragWindow.isDestroyed() ||
      event.sender !== dragWindow.webContents
    ) {
      return;
    }
    try {
      const request = parseNativeAssetDragRequest(input);
      startNativeAssetDrag({
        cache: nativeAssetDragCache,
        libraryId: request.libraryId,
        assetIds: request.assetIds,
        imageFactory: nativeImage,
        fallbackIcon: appIconImage,
        startDrag: ({ file, files, icon }) => {
          dragWindow.webContents.startDrag({
            file,
            files: [...files],
            icon: icon as NativeImage,
          });
        },
      });
    } catch (error) {
      logger?.info(
        "main.native-asset-drag",
        "Native asset drag was not started.",
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
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
      notifyInstallProgress: (event) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(PLUGIN_INSTALL_PROGRESS_CHANNEL, event);
        }
      },
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
          embeddedMcpServer?.notifyToolsChanged();
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

  ipcMain.handle(
    APP_UPDATE_CHECK_CHANNEL,
    async (event): Promise<AppUpdateCheckResult> => {
      if (!mainWindow || event.sender !== mainWindow.webContents) {
        logger?.info('ipc.app-update', 'Rejected update check request.', {
          code: 'unauthorized-sender',
        });
        return { ok: false, status: 'error', code: 'unauthorized-sender' };
      }
      if (appUpdateService === undefined) {
        return { ok: false, status: 'error', code: 'service-unavailable' };
      }
      return appUpdateService.checkForUpdates();
    },
  );

  ipcMain.handle(
    APP_UPDATE_INSTALL_CHANNEL,
    async (event): Promise<AppUpdateInstallResult> => {
      if (!mainWindow || event.sender !== mainWindow.webContents) {
        logger?.info('ipc.app-update', 'Rejected update install request.', {
          code: 'unauthorized-sender',
        });
        return { ok: false, status: 'error', code: 'unauthorized-sender' };
      }
      if (appUpdateService === undefined) {
        return { ok: false, status: 'error', code: 'service-unavailable' };
      }
      return appUpdateService.downloadAndInstall();
    },
  );

  ipcMain.on(APP_UPDATE_CANCEL_CHANNEL, (event) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) {
      logger?.info('ipc.app-update', 'Rejected update cancel request.', {
        code: 'unauthorized-sender',
      });
      return;
    }
    appUpdateService?.cancelDownload();
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
          fileName: path.basename(appLogPath),
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

  // Serpent-q0b1: the renderer syncs native menu item enabled-state (business
  // undo/redo availability). Only commands from the real window are accepted.
  ipcMain.handle(APPLICATION_MENU_ITEM_STATE_CHANNEL, (event, input: unknown) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) {
      return;
    }
    const record = input as { command?: unknown; enabled?: unknown; label?: unknown } | null;
    if (record === null || typeof record !== "object") return;
    if (typeof record.command !== "string") return;
    if (typeof record.enabled === "boolean") {
      setApplicationMenuCommandEnabled(record.command, record.enabled);
    }
    if (typeof record.label === "string" && record.label.length > 0 && record.label.length <= 200) {
      setApplicationMenuCommandLabel(record.command, record.label);
    }
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

  ipcMain.on(BROWSE_SHORTCUT_MENU_ENABLED_CHANNEL, (_event, input: unknown) => {
    const enabled =
      typeof input === "object" &&
      input !== null &&
      "enabled" in input &&
      Boolean((input as { enabled?: unknown }).enabled);
    setWindowsBrowseShortcutAcceleratorsEnabled(enabled);
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

  await createMainWindow();
  try {
    await embeddedMcpServer?.initialize();
  } catch (error) {
    logger?.error('mcp.server.initialize', error);
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

  initializePreviewCache();

  startupComplete = true;
}

// Serpent-tluf: must run before app ready — the macOS application menu's
// first item always displays the application name, and a ready-late
// setName is too late for it (dev otherwise shows "Electron").
app.setName("Serpent");

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
    if (!startupComplete) return;
    if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
    else focusMainWindow();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("will-quit", () => {
    void cleanupAllExternalSources();
    syncAutoScheduler?.stop();
    syncAutoScheduler = undefined;
    windowsTray?.destroy();
    windowsTray = undefined;
  });

  app.on("before-quit", (event) => {
    aiQueueScheduler.clearAll();
    criticalConfirmationWindowManager?.dispose();
    criticalConfirmationWindowManager = undefined;
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

    const mcpClose = embeddedMcpServer?.close() ?? Promise.resolve();
    void Promise.all([mcpClose])
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
