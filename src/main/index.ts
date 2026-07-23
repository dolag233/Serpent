import path from "node:path";
import { tmpdir } from "node:os";
import {
  readFileSync,
  writeFileSync,
  existsSync,
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
} from "electron";

import { installApplicationMenu } from "./application-menu";
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
  ASSET_CHANGE_CHANNEL,
  THUMBNAIL_CHANNEL,
  ACTIVE_CONTEXT_CHANNEL,
  APP_LOCALE_CHANNEL,
  LIBRARY_LIFECYCLE_CHANNEL,
  LIBRARY_REQUEST_CHANNEL,
  PROGRESS_CHANNEL,
  AI_PROGRESS_CHANNEL,
  AI_COMPLETED_CHANNEL,
  AI_CLEARED_CHANNEL,
  EXTENSION_PAIRING_CHANNEL,
  OPEN_EXTERNAL_URL_CHANNEL,
  REVEAL_APP_LOG_CHANNEL,
  SHOW_EDIT_CONTEXT_MENU_CHANNEL,
  SHELL_SWIPE_CHANNEL,
  WINDOW_FOCUS_CHANNEL,
  NATIVE_EDIT_COPY_CHANNEL,
} from "../shared/protocol/channels";
import { shouldUseFramelessTitleBar } from "../shared/window-controls";
import {
  resolveOpenExternalUrlTarget,
  type OpenExternalUrlResult,
  type RevealAppLogResult,
} from "../shared/external-url";
import type { ShowEditContextMenuResult } from "../shared/edit-context-menu";
import {
  parseExtensionPairingRequest,
  type ExtensionPairingResult,
} from "../shared/extension-pairing";
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
  type ProgressEvent,
  type AiProgressEvent,
  type AiAnalysisCompletedEvent,
  type AiContentClearedEvent,
  parseAiProgressEvent,
  parseAiAnalysisCompletedEvent,
  parseAiContentClearedEvent,
} from "../shared/protocol/responses";
import { LibraryWorkerClient } from "./worker-client";
import { AppLogger } from "./app-logger";
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
  createExtensionServer,
  type ExtensionServer,
  type SaveIntent,
  type SaveIntentDisposition,
} from "./extension-server";
import { ExtensionPairingStore } from "./extension-pairing-store";
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

app.enableSandbox();

const hasSingleInstanceLock = allowMultiInstance
  ? true
  : app.requestSingleInstanceLock();

let mainWindow: BrowserWindow | undefined;
/** Effective UI locale for native dialogs; synced from Renderer (Serpent-bwb). */
let appLocale: AppLocale = "en";
let workerClient: LibraryWorkerClient | undefined;
let quitAfterShutdown = false;
let startupComplete = false;
let logger: AppLogger | undefined;
let appLogPath: string | undefined;

function recentLibraryPath(): string {
  return path.join(app.getPath("userData"), "recent-library.json");
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
let extensionPairingStore: ExtensionPairingStore | undefined;
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

// Keeps selected roots in Main. Renderer receives only an opaque, one-shot token.
const pendingRelinkPreviews = new RelinkPreviewStore();

// Pending import source path (importId -> sourceFolderPath), remembered after validation.
const pendingImportSources = new Map<string, string>();

// Pending import libraryId (importId -> libraryId), for auto-analyze after import.
const pendingImportLibraries = new Map<string, string>();

// Pending drop/paste collection destinations survive the conflict dialog. The
// actual import is already durable in Worker staging before Main stores this.
const pendingImportCollections = new Map<string, string>();

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

function focusMainWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/**
 * Isolated-session placement for `SERPENT_E2E_ISOLATED=1`: real E2E must keep
 * real `show()`/focus semantics (an earlier `showInactive` attempt broke
 * keyboard/focus tests and was reverted — see
 * docs/development/2026-07-19-e2e-isolated-session-development-log.md), so
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

async function createMainWindow(): Promise<void> {
  const defaultWidth = 1440;
  const defaultHeight = 900;
  const isolatedPlacement = resolveE2eIsolatedPlacement({
    width: defaultWidth,
    height: defaultHeight,
  });

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
  window.on("ready-to-show", () => window.show());
  window.on("closed", () => {
    if (mainWindow === window) {
      focusedContexts.delete(window.id);
      mainWindow = undefined;
    }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
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
    window.webContents.send(WINDOW_FOCUS_CHANNEL, {
      focused: window.isFocused(),
    });
  };
  window.on("focus", publishWindowFocus);
  window.on("blur", publishWindowFocus);
  window.once("ready-to-show", publishWindowFocus);

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
    await window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    await window.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
}

function cancelled(): RendererResult {
  return { ok: false, error: createPublicError("CANCELLED") };
}

async function handleSaveIntent(
  intent: SaveIntent,
): Promise<SaveIntentDisposition> {
  if (!workerClient) {
    return { accepted: false, status: 503, reason: "worker unavailable" };
  }

  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (!focusedWindow) {
    logger?.info(
      "extension-server.save",
      "No focused window; dropping save intent.",
    );
    return { accepted: false, status: 503, reason: "no active library" };
  }

  const context = focusedContexts.get(focusedWindow.id);
  const libraryId = context?.libraryId;
  if (!libraryId) {
    logger?.info(
      "extension-server.save",
      "No active library in focused window; dropping save intent.",
    );
    return { accepted: false, status: 503, reason: "no active library" };
  }

  const command: WorkerCommand = {
    type: "extension.save-from-url",
    libraryId,
    targetFolderId: context.selectedFolderId,
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
    return { accepted: true };
  } catch (error) {
    logger?.error("extension-server.save", error);
    throw error;
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
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(
    ASSET_CHANGE_CHANNEL,
    parseAssetChangeEvent(event),
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
      return { type: "folder.list", libraryId: request.libraryId };
    case "folder.browse-entries.request":
      return {
        type: "folder.browse-entries",
        libraryId: request.libraryId,
        parentFolderId: request.parentFolderId,
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
      };
    case "asset.import-files.request": {
      const sourcePaths = await selectImportSources("files");
      return sourcePaths
        ? {
            type: "asset.import.prepare",
            libraryId: request.libraryId,
            targetFolderId: request.targetFolderId,
            sourceKind: "files",
            sourcePaths,
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
        limit: request.limit,
        offset: request.offset,
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
        limit: request.limit,
        offset: request.offset,
      };
    case "asset.trash.request":
      return {
        type: "asset.trash",
        libraryId: request.libraryId,
        assetIds: request.assetIds,
      };
    case "asset.restore.request":
      return {
        type: "asset.restore",
        libraryId: request.libraryId,
        assetIds: request.assetIds,
        targetFolderId: request.targetFolderId,
        conflictStrategy: request.conflictStrategy,
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
      const destinationPath =
        request.format === "zip"
          ? await selectSavePath(
              host,
              "exportZip",
              process.env.SERPENT_E2E_EXPORT_DEST_ZIP,
              {
                defaultPath: "serpent-library-export.zip",
                filters: [{ name: "ZIP", extensions: ["zip"] }],
              },
            )
          : await selectSavePath(
              host,
              "exportFolder",
              process.env.SERPENT_E2E_EXPORT_DEST,
              { defaultPath: "serpent-library-export" },
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
    case "asset.preview.request":
      // Handled directly in handleLibraryRequest because it requires constructing
      // a serpent:// URL after the Worker lookup.
      return {
        type: "media.get-preview-artifact",
        libraryId: request.libraryId,
        assetId: request.assetId,
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
      command = {
        type: "asset.import.prepare",
        libraryId: request.libraryId,
        targetFolderId: request.targetFolderId,
        sourceKind,
        sourcePaths: request.sourcePaths,
      };
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
          targetFolderId: request.folderId,
          sourceKind,
          sourcePaths,
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
      request.type === "asset.relink-batch.request" &&
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
      void processAiQueue(openedLibraryId);
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
              ? `serpent://${workerResult.mediaType === "video" ? "proxy" : "preview"}/${request.libraryId}/${workerResult.artifactId}`
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

async function startApplication(): Promise<void> {
  app.setAppLogsPath();
  appLogPath = path.join(app.getPath("logs"), "serpent.log");
  logger = new AppLogger(appLogPath);
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
  extensionPairingStore = new ExtensionPairingStore(
    path.join(app.getPath("userData"), "extension-pairing-token.enc"),
    safeStorage,
  );
  workerClient = new LibraryWorkerClient(
    path.join(__dirname, "library_worker.js"),
    logger,
  );
  await workerClient.start();
  workerClient.onAssetsChanged(publishAssetChange);
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
        const revisionId = url.searchParams.get("revision");
        if (!revisionId || !/^[A-Za-z0-9_-]{1,255}$/.test(revisionId)) {
          logger?.info(
            "serpent-protocol.invalid-revision",
            "Rejected malformed source revision token.",
          );
          return new Response("Invalid revision", { status: 400 });
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

  ipcMain.handle(LIBRARY_REQUEST_CHANNEL, (event, input: unknown) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) {
      return {
        ok: false,
        error: createPublicError("INTERNAL_ERROR"),
      } satisfies RendererResult;
    }
    return handleLibraryRequest(input);
  });

  ipcMain.handle(
    EXTENSION_PAIRING_CHANNEL,
    (event, input: unknown): ExtensionPairingResult => {
      if (
        !mainWindow ||
        event.sender !== mainWindow.webContents ||
        !extensionPairingStore
      ) {
        return {
          ok: false,
          message: "Browser-extension pairing is unavailable.",
        };
      }
      try {
        const request = parseExtensionPairingRequest(input);
        const token =
          request.type === "extension-pairing.rotate"
            ? extensionPairingStore.rotate()
            : extensionPairingStore.current();
        return { ok: true, token };
      } catch (error) {
        logger?.error("extension-pairing", error);
        return {
          ok: false,
          message: "Browser-extension pairing is unavailable.",
        };
      }
    },
  );

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
    }
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

  // Start the browser-extension HTTP server on 127.0.0.1.
  try {
    extensionPairingStore.current();
    extensionServer = await createExtensionServer({
      port: 19876,
      getPairingToken: () => extensionPairingStore!.current(),
      onSaveIntent: handleSaveIntent,
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
  app.on("second-instance", focusMainWindow);

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

  app.on("before-quit", (event) => {
    aiQueueScheduler.clearAll();
    if (quitAfterShutdown || !workerClient) return;
    event.preventDefault();

    // Close the extension server early; stop accepting new save intents.
    try {
      extensionServer?.server.close();
      extensionServer = undefined;
    } catch {
      // Best effort.
    }

    void workerClient.shutdown().finally(() => {
      quitAfterShutdown = true;
      app.quit();
    });
  });
}
