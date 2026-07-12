import path from 'node:path';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

import { app, BrowserWindow, dialog, ipcMain, safeStorage, type OpenDialogOptions } from 'electron';

import {
  ASSET_CHANGE_CHANNEL,
  ACTIVE_CONTEXT_CHANNEL,
  LIBRARY_LIFECYCLE_CHANNEL,
  LIBRARY_REQUEST_CHANNEL,
  PROGRESS_CHANNEL,
} from '../shared/protocol/channels';
import { createPublicError, toPublicError } from '../shared/protocol/errors';
import { parseRendererRequest, parseActiveContext, type RendererRequest, type WorkerCommand } from '../shared/protocol/requests';
import {
  parseRendererResult,
  parseRendererLifecycleEvent,
  type RendererLifecycleEvent,
  type RendererResult,
  type WorkerResult,
  type AssetChangeEvent,
  parseAssetChangeEvent,
  type ProgressEvent,
} from '../shared/protocol/responses';
import { LibraryWorkerClient } from './worker-client';
import { AppLogger } from './app-logger';
import { createExtensionServer, type ExtensionServer, type SaveIntent } from './extension-server';

app.enableSandbox();

const hasSingleInstanceLock = app.requestSingleInstanceLock();

let mainWindow: BrowserWindow | undefined;
let workerClient: LibraryWorkerClient | undefined;
let quitAfterShutdown = false;
let startupComplete = false;
let logger: AppLogger | undefined;

let extensionServer: ExtensionServer | undefined;

// Maps BrowserWindow.id to the active library/folder context for extension save.
const focusedContexts = new Map<number, { libraryId: string | null; selectedFolderId?: string }>();

// Pending relink-batch root paths (libraryId -> rootPath), cleared after apply/abandon.
const pendingRelinkRoots = new Map<string, string>();

// Pending import source path (importId -> sourceFolderPath), remembered after validation.
const pendingImportSources = new Map<string, string>();

// ── AI Config ────────────────────────────────────────────────────────────

interface AiConfig {
  provider: 'openai' | 'gemini' | 'anthropic';
  model: string;
  labelEnabled: boolean;
  descriptionEnabled: boolean;
  tagEnabled: boolean;
  structuredMetadataEnabled: boolean;
  language: string;
  autoAnalyzeEnabled: boolean;
  disclaimerAccepted: boolean;
}

const DEFAULT_AI_CONFIG: AiConfig = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  labelEnabled: true,
  descriptionEnabled: true,
  tagEnabled: true,
  structuredMetadataEnabled: false,
  language: 'auto',
  autoAnalyzeEnabled: false,
  disclaimerAccepted: false,
};

function aiConfigPath(): string {
  return path.join(app.getPath('userData'), 'ai-config.json');
}

function aiKeyPath(): string {
  return path.join(app.getPath('userData'), 'ai-key.enc');
}

function loadAiConfig(): AiConfig & { hasKey: boolean } {
  try {
    const raw = readFileSync(aiConfigPath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AiConfig>;
    const merged = { ...DEFAULT_AI_CONFIG, ...parsed };
    // Ensure provider is never null (default to 'openai')
    if (!merged.provider) merged.provider = DEFAULT_AI_CONFIG.provider;
    const hasKey = existsSync(aiKeyPath());
    return { ...merged, hasKey };
  } catch {
    const hasKey = existsSync(aiKeyPath());
    return { ...DEFAULT_AI_CONFIG, hasKey };
  }
}

function saveAiConfig(config: Omit<AiConfig, 'disclaimerAccepted'>): void {
  const toSave: Record<string, unknown> = {};
  toSave.provider = config.provider;
  toSave.model = config.model;
  toSave.labelEnabled = config.labelEnabled;
  toSave.descriptionEnabled = config.descriptionEnabled;
  toSave.tagEnabled = config.tagEnabled;
  toSave.structuredMetadataEnabled = config.structuredMetadataEnabled;
  toSave.language = config.language;
  toSave.autoAnalyzeEnabled = config.autoAnalyzeEnabled;
  writeFileSync(aiConfigPath(), JSON.stringify(toSave, null, 2), 'utf-8');
}

function getDecryptedApiKey(): string {
  try {
    const encrypted = readFileSync(aiKeyPath());
    return safeStorage.decryptString(encrypted);
  } catch {
    throw new Error('AI API key not configured or could not be decrypted.');
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

async function createMainWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    backgroundColor: '#111417',
    webPreferences: {
      preload: path.join(__dirname, 'index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow = window;
  window.on('ready-to-show', () => window.show());
  window.on('closed', () => {
    if (mainWindow === window) {
      focusedContexts.delete(window.id);
      mainWindow = undefined;
    }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    await window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    await window.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
}

function cancelled(): RendererResult {
  return { ok: false, error: createPublicError('CANCELLED') };
}

function handleSaveIntent(intent: SaveIntent): void {
  if (!workerClient) return;

  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (!focusedWindow) {
    logger?.info('extension-server.save', 'No focused window; dropping save intent.');
    return;
  }

  const context = focusedContexts.get(focusedWindow.id);
  const libraryId = context?.libraryId;
  if (!libraryId) {
    logger?.info('extension-server.save', 'No active library in focused window; dropping save intent.');
    return;
  }

  const command: WorkerCommand = {
    type: 'extension.save-from-url',
    libraryId,
    targetFolderId: context.selectedFolderId,
    sourcePageUrl: intent.sourcePageUrl,
    mediaUrl: intent.mediaUrl,
    mediaType: intent.mediaType,
  };

  workerClient.request(command).then(
    (result) => {
      if (!result.ok) {
        logger?.error('extension-server.save', new Error(`Save failed: ${result.error.message}`), {
          code: result.error.code,
          reason: result.error.reason,
        });
      } else {
        logger?.info('extension-server.save', 'Asset saved successfully.', {
          type: result.type,
        });
      }
    },
    (error) => {
      logger?.error('extension-server.save', error);
    },
  );
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
  mainWindow.webContents.send(ASSET_CHANGE_CHANNEL, parseAssetChangeEvent(event));
}

function publishProgress(event: ProgressEvent): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(PROGRESS_CHANNEL, event);
}

function toRendererResult(result: WorkerResult): RendererResult {
  if (!result.ok) return parseRendererResult(result);
  if (result.type === 'library.opened') {
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
  if (result.type === 'library.list') {
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
  if (result.type === 'library.imported') {
    // Use libraryPath for lifecycle but strip from renderer result.
    // The lifecycle is published in handleLibraryRequest above.
    return parseRendererResult({
      ok: true,
      type: 'library.imported',
      importId: result.importId,
      libraryId: result.libraryId,
      displayName: result.displayName,
    });
  }
  return parseRendererResult(result);
}

async function selectImportSources(sourceKind: 'files' | 'folder'): Promise<string[] | undefined> {
  if (!app.isPackaged && process.env.SERPENT_E2E === '1') {
    const value = sourceKind === 'files'
      ? process.env.SERPENT_E2E_IMPORT_FILES
      : process.env.SERPENT_E2E_IMPORT_FOLDER;
    return value ? value.split(path.delimiter).filter(Boolean) : undefined;
  }

  const options: OpenDialogOptions = sourceKind === 'files'
    ? {
        title: 'Import Files',
        buttonLabel: 'Import',
        properties: ['openFile', 'multiSelections'],
      }
    : {
        title: 'Import Folder',
        buttonLabel: 'Import Folder',
        properties: ['openDirectory'],
      };
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);
  return result.canceled || result.filePaths.length === 0 ? undefined : result.filePaths;
}

async function selectDirectory(title: string, buttonLabel: string): Promise<string | undefined> {
  if (!app.isPackaged && process.env.SERPENT_E2E === '1') {
    return title === 'Create Library'
      ? process.env.SERPENT_E2E_CREATE_PARENT_PATH
      : process.env.SERPENT_E2E_OPEN_LIBRARY_PATH;
  }

  const options: OpenDialogOptions = {
    title,
    buttonLabel,
    properties: ['openDirectory', 'createDirectory'],
  };
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? undefined : result.filePaths[0];
}

async function commandFor(request: RendererRequest): Promise<WorkerCommand | undefined> {
  switch (request.type) {
    case 'library.create.request': {
      const selectedParentPath = await selectDirectory('Create Library', 'Choose Folder');
      return selectedParentPath
        ? { type: 'library.create', displayName: request.displayName, selectedParentPath }
        : undefined;
    }
    case 'library.open.request': {
      const selectedLibraryPath = await selectDirectory('Open Library', 'Open');
      return selectedLibraryPath ? { type: 'library.open', selectedLibraryPath } : undefined;
    }
    case 'library.close.request':
      return { type: 'library.close', libraryId: request.libraryId };
    case 'library.list.request':
      return { type: 'library.list' };
    case 'folder.create.request':
      return {
        type: 'folder.create',
        libraryId: request.libraryId,
        parentFolderId: request.parentFolderId,
        name: request.name,
      };
    case 'folder.list.request':
      return { type: 'folder.list', libraryId: request.libraryId };
    case 'asset.list.request':
      return {
        type: 'asset.list',
        libraryId: request.libraryId,
        folderId: request.folderId,
        recursive: request.recursive,
      };
    case 'asset.import-files.request': {
      const sourcePaths = await selectImportSources('files');
      return sourcePaths
        ? {
            type: 'asset.import.prepare',
            libraryId: request.libraryId,
            targetFolderId: request.targetFolderId,
            sourceKind: 'files',
            sourcePaths,
          }
        : undefined;
    }
    case 'asset.import-folder.request': {
      const sourcePaths = await selectImportSources('folder');
      return sourcePaths
        ? {
            type: 'asset.import.prepare',
            libraryId: request.libraryId,
            targetFolderId: request.targetFolderId,
            sourceKind: 'folder',
            sourcePaths,
          }
        : undefined;
    }
    case 'asset.import.resolve':
      return {
        type: 'asset.import.resolve',
        importId: request.importId,
        suspectedDuplicate: request.suspectedDuplicate,
        nameConflict: request.nameConflict,
      };
    case 'asset.import.abandon':
      return { type: 'asset.import.abandon', importId: request.importId };
    case 'asset.refresh.request':
      return { type: 'asset.refresh', libraryId: request.libraryId };
    case 'asset.import-linked.request': {
      let sourceRootPath: string | undefined;
      if (!app.isPackaged && process.env.SERPENT_E2E === '1') {
        sourceRootPath = process.env.SERPENT_E2E_LINKED_SOURCE;
      } else {
        const result = mainWindow
          ? await dialog.showOpenDialog(mainWindow, {
              title: 'Link Folder to Library',
              buttonLabel: 'Link Folder',
              properties: ['openDirectory'],
            })
          : await dialog.showOpenDialog({
              title: 'Link Folder to Library',
              buttonLabel: 'Link Folder',
              properties: ['openDirectory'],
            });
        sourceRootPath = result.canceled ? undefined : result.filePaths[0];
      }
      return sourceRootPath
        ? {
            type: 'asset.import-linked',
            libraryId: request.libraryId,
            displayName: request.displayName,
            sourceRootPath,
          }
        : undefined;
    }
    case 'linked-folder.list.request':
      return { type: 'linked-folder.list', libraryId: request.libraryId };
    case 'linked-folder.relink.request': {
      let newRootPath: string | undefined;
      if (!app.isPackaged && process.env.SERPENT_E2E === '1') {
        newRootPath = process.env.SERPENT_E2E_LINKED_NEW_ROOT;
      } else {
        const result = mainWindow
          ? await dialog.showOpenDialog(mainWindow, {
              title: 'Relink Folder',
              buttonLabel: 'Select New Location',
              properties: ['openDirectory'],
            })
          : await dialog.showOpenDialog({
              title: 'Relink Folder',
              buttonLabel: 'Select New Location',
              properties: ['openDirectory'],
            });
        newRootPath = result.canceled ? undefined : result.filePaths[0];
      }
      return newRootPath
        ? { type: 'linked-folder.relink', libraryId: request.libraryId, folderId: request.folderId, newRootPath }
        : undefined;
    }
    case 'tag.list.request':
      return { type: 'tag.list', libraryId: request.libraryId };
    case 'tag.create.request':
      return { type: 'tag.create', libraryId: request.libraryId, name: request.name };
    case 'tag.rename.request':
      return { type: 'tag.rename', libraryId: request.libraryId, tagId: request.tagId, name: request.name };
    case 'tag.delete.request':
      return { type: 'tag.delete', libraryId: request.libraryId, tagId: request.tagId };
    case 'tag.assign.request':
      return { type: 'tag.assign', libraryId: request.libraryId, assetIds: request.assetIds, tagIds: request.tagIds };
    case 'tag.remove.request':
      return { type: 'tag.remove', libraryId: request.libraryId, assetIds: request.assetIds, tagIds: request.tagIds };
    case 'collection.list.request':
      return { type: 'collection.list', libraryId: request.libraryId };
    case 'collection.create.request':
      return { type: 'collection.create', libraryId: request.libraryId, parentId: request.parentId, name: request.name };
    case 'collection.update.request':
      return {
        type: 'collection.update',
        libraryId: request.libraryId,
        collectionId: request.collectionId,
        name: request.name,
        description: request.description,
        coverAssetId: request.coverAssetId,
        position: request.position,
      };
    case 'collection.delete.request':
      return { type: 'collection.delete', libraryId: request.libraryId, collectionId: request.collectionId };
    case 'collection.assets.add.request':
      return { type: 'collection.assets.add', libraryId: request.libraryId, collectionId: request.collectionId, assetIds: request.assetIds };
    case 'collection.assets.remove.request':
      return { type: 'collection.assets.remove', libraryId: request.libraryId, collectionId: request.collectionId, assetIds: request.assetIds };
    case 'collection.assets.reorder.request':
      return { type: 'collection.assets.reorder', libraryId: request.libraryId, collectionId: request.collectionId, orderedAssetIds: request.orderedAssetIds };
    case 'collection.assets.list.request':
      return { type: 'collection.assets.list', libraryId: request.libraryId, collectionId: request.collectionId, recursive: request.recursive };
    case 'asset.metadata.get.request':
      return { type: 'asset.metadata.get', libraryId: request.libraryId, assetId: request.assetId };
    case 'asset.metadata.set.request':
      return {
        type: 'asset.metadata.set',
        libraryId: request.libraryId,
        assetId: request.assetId,
        expectedVersion: request.expectedVersion,
        label: request.label,
        description: request.description,
        rating: request.rating,
        favorite: request.favorite,
        palette: request.palette,
        sourcePageUrl: request.sourcePageUrl,
      };
    case 'asset.metadata.backfill.request':
      return { type: 'asset.metadata.backfill', libraryId: request.libraryId };
    case 'asset.search.request':
      return {
        type: 'asset.search',
        libraryId: request.libraryId,
        query: request.query,
        filters: request.filters,
        sort: request.sort,
        limit: request.limit,
        offset: request.offset,
      };
    case 'smart-collection.list.request':
      return { type: 'smart-collection.list', libraryId: request.libraryId };
    case 'smart-collection.create.request':
      return {
        type: 'smart-collection.create',
        libraryId: request.libraryId,
        name: request.name,
        queryDefinitionJson: request.queryDefinitionJson,
      };
    case 'smart-collection.update.request':
      return {
        type: 'smart-collection.update',
        libraryId: request.libraryId,
        collectionId: request.collectionId,
        name: request.name,
        queryDefinitionJson: request.queryDefinitionJson,
        position: request.position,
      };
    case 'smart-collection.delete.request':
      return {
        type: 'smart-collection.delete',
        libraryId: request.libraryId,
        collectionId: request.collectionId,
      };
    case 'smart-collection.execute.request':
      return {
        type: 'smart-collection.execute',
        libraryId: request.libraryId,
        collectionId: request.collectionId,
      };
    case 'asset.trash.request':
      return { type: 'asset.trash', libraryId: request.libraryId, assetIds: request.assetIds };
    case 'asset.restore.request':
      return { type: 'asset.restore', libraryId: request.libraryId, assetIds: request.assetIds, targetFolderId: request.targetFolderId };
    case 'asset.delete-permanent.request':
      return { type: 'asset.delete-permanent', libraryId: request.libraryId, assetIds: request.assetIds };
    case 'trash.list.request':
      return { type: 'asset.list-trash', libraryId: request.libraryId };
    case 'trash.purge.request':
      return { type: 'asset.purge-trash', libraryId: request.libraryId };
    case 'asset.delete-linked.request':
      return { type: 'asset.delete-linked', libraryId: request.libraryId, assetIds: request.assetIds, deleteSourceFile: request.deleteSourceFile };
    case 'asset.relink.request': {
      let newAbsolutePath: string | undefined;
      if (!app.isPackaged && process.env.SERPENT_E2E === '1') {
        newAbsolutePath = process.env.SERPENT_E2E_RELINK_FILE;
      } else {
        const result = mainWindow
          ? await dialog.showOpenDialog(mainWindow, {
              title: 'Locate Missing Asset',
              buttonLabel: 'Select File',
              properties: ['openFile'],
            })
          : await dialog.showOpenDialog({
              title: 'Locate Missing Asset',
              buttonLabel: 'Select File',
              properties: ['openFile'],
            });
        newAbsolutePath = result.canceled ? undefined : result.filePaths[0];
      }
      return newAbsolutePath
        ? { type: 'asset.relink', libraryId: request.libraryId, assetId: request.assetId, newAbsolutePath }
        : undefined;
    }
    case 'asset.relink-batch.request': {
      let newRootPath: string | undefined;
      if (!app.isPackaged && process.env.SERPENT_E2E === '1') {
        newRootPath = process.env.SERPENT_E2E_RELINK_ROOT;
      } else {
        const result = mainWindow
          ? await dialog.showOpenDialog(mainWindow, {
              title: 'Select New Root for Relinking',
              buttonLabel: 'Select Folder',
              properties: ['openDirectory'],
            })
          : await dialog.showOpenDialog({
              title: 'Select New Root for Relinking',
              buttonLabel: 'Select Folder',
              properties: ['openDirectory'],
            });
        newRootPath = result.canceled ? undefined : result.filePaths[0];
      }
      if (newRootPath) {
        pendingRelinkRoots.set(request.libraryId, newRootPath);
        return { type: 'asset.relink-batch.preview', libraryId: request.libraryId, newRootPath };
      }
      return undefined;
    }
    case 'asset.relink-batch.apply.request': {
      const newRootPath = pendingRelinkRoots.get(request.libraryId);
      if (!newRootPath) return undefined;
      pendingRelinkRoots.delete(request.libraryId);
      return { type: 'asset.relink-batch.apply', libraryId: request.libraryId, newRootPath, keepMetadata: request.keepMetadata };
    }
    case 'library.export.request': {
      let destinationPath: string | undefined;
      if (!app.isPackaged && process.env.SERPENT_E2E === '1') {
        destinationPath = process.env.SERPENT_E2E_EXPORT_DEST;
      } else {
        const result = mainWindow
          ? await dialog.showOpenDialog(mainWindow, {
              title: '选择导出目标文件夹',
              buttonLabel: '导出到此处',
              properties: ['openDirectory', 'createDirectory'],
            })
          : await dialog.showOpenDialog({
              title: '选择导出目标文件夹',
              buttonLabel: '导出到此处',
              properties: ['openDirectory', 'createDirectory'],
            });
        destinationPath = result.canceled ? undefined : result.filePaths[0];
      }
      return destinationPath
        ? {
            type: 'library.export',
            libraryId: request.libraryId,
            destinationPath,
            format: 'folder' as const,
            includeLinkedContent: request.includeLinkedContent,
          }
        : undefined;
    }
    case 'library.import.request': {
      let sourceFolderPath: string | undefined;
      if (!app.isPackaged && process.env.SERPENT_E2E === '1') {
        sourceFolderPath = process.env.SERPENT_E2E_IMPORT_SOURCE;
      } else {
        const result = mainWindow
          ? await dialog.showOpenDialog(mainWindow, {
              title: '选择要导入的资源库文件夹',
              buttonLabel: '导入此资源库',
              properties: ['openDirectory'],
            })
          : await dialog.showOpenDialog({
              title: '选择要导入的资源库文件夹',
              buttonLabel: '导入此资源库',
              properties: ['openDirectory'],
            });
        sourceFolderPath = result.canceled ? undefined : result.filePaths[0];
      }
      if (!sourceFolderPath) return undefined;
      // Store source path for later use in copy/in-place decision.
      const importId = `import-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      pendingImportSources.set(importId, sourceFolderPath);
      return { type: 'library.import-validate', sourceFolderPath };
    }
    case 'library.import.copy.request': {
      const importId = request.importId;
      const sourcePath = pendingImportSources.get(importId);
      if (!sourcePath) return undefined;
      let copyToParentPath: string | undefined;
      if (!app.isPackaged && process.env.SERPENT_E2E === '1') {
        copyToParentPath = process.env.SERPENT_E2E_IMPORT_COPY_PARENT;
      } else {
        const result = mainWindow
          ? await dialog.showOpenDialog(mainWindow, {
              title: '选择导入目标位置（资源库将复制到此文件夹内）',
              buttonLabel: '复制到此处',
              properties: ['openDirectory', 'createDirectory'],
            })
          : await dialog.showOpenDialog({
              title: '选择导入目标位置（资源库将复制到此文件夹内）',
              buttonLabel: '复制到此处',
              properties: ['openDirectory', 'createDirectory'],
            });
        copyToParentPath = result.canceled ? undefined : result.filePaths[0];
      }
      pendingImportSources.delete(importId);
      if (!copyToParentPath) return undefined;
      return { type: 'library.import-folder', sourceFolderPath: sourcePath, copyToParentPath };
    }
    case 'library.import.open-in-place.request': {
      const importId = request.importId;
      const sourcePath = pendingImportSources.get(importId);
      if (!sourcePath) return undefined;
      pendingImportSources.delete(importId);
      return { type: 'library.import-folder', sourceFolderPath: sourcePath };
    }
    case 'ai.config.get.request':
    case 'ai.config.set.request':
      // Handled directly in handleLibraryRequest — should never reach here.
      return undefined;
    case 'asset.analyze.request': {
      const config = loadAiConfig();
      if (!config.hasKey) return undefined; // Will be handled as error downstream.
      if (!config.provider) return undefined;
      let apiKey: string;
      try {
        apiKey = getDecryptedApiKey();
      } catch {
        return undefined;
      }
      return {
        type: 'asset.analyze',
        libraryId: request.libraryId,
        assetId: request.assetId,
        provider: config.provider,
        model: config.model,
        apiKey,
        enabledFields: {
          label: config.labelEnabled,
          description: config.descriptionEnabled,
          tags: config.tagEnabled,
          structuredMetadata: config.structuredMetadataEnabled,
        },
        language: config.language,
      };
    }
    default:
      return assertNever(request);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Renderer request: ${String(value)}`);
}

async function handleLibraryRequest(input: unknown): Promise<RendererResult> {
  let operation: 'create' | 'open' | 'import' | undefined;
  try {
    const request = parseRendererRequest(input);

    // Handle AI config requests entirely in the main process — no Worker involved.
    if (request.type === 'ai.config.get.request') {
      const config = loadAiConfig();
      return {
        ok: true,
        type: 'ai.config.got',
        provider: config.provider,
        model: config.model,
        hasKey: config.hasKey,
        enabledFields: {
          label: config.labelEnabled,
          description: config.descriptionEnabled,
          tags: config.tagEnabled,
          structuredMetadata: config.structuredMetadataEnabled,
        },
        language: config.language,
      } satisfies RendererResult;
    }

    if (request.type === 'ai.config.set.request') {
      saveAiConfig({
        provider: request.provider,
        model: request.model,
        labelEnabled: request.enabledFields?.label ?? true,
        descriptionEnabled: request.enabledFields?.description ?? true,
        tagEnabled: request.enabledFields?.tags ?? true,
        structuredMetadataEnabled: request.enabledFields?.structuredMetadata ?? false,
        language: request.language ?? 'auto',
        autoAnalyzeEnabled: false,
      });
      saveEncryptedApiKey(request.apiKey);
      return { ok: true, type: 'ai.config.saved' } satisfies RendererResult;
    }

    const command = await commandFor(request);
    if (!command) return cancelled();
    if (!workerClient) throw new Error('Library Worker is unavailable.');
    if (command.type === 'library.create') operation = 'create';
    if (command.type === 'library.open') operation = 'open';
    if (command.type === 'library.import-folder') operation = 'import';
    if (operation) publishLifecycle({ type: 'library.opening', operation });

    const workerResult = await workerClient.request(command);
    const result = toRendererResult(workerResult);
    if (!result.ok) {
      if (operation) {
        publishLifecycle({
          type: 'library.open-failed',
          operation,
          error: result.error,
        });
      }
      return result;
    }
    if (result.type === 'library.opened') {
      publishLifecycle({ type: 'library.opened', library: result.library });
    } else if (workerResult.ok && workerResult.type === 'library.imported') {
      publishLifecycle({
        type: 'library.opened',
        library: {
          libraryId: workerResult.libraryId,
          displayName: workerResult.displayName,
          displayPath: workerResult.libraryPath,
        },
      });
    } else if (result.type === 'library.closed') {
      publishLifecycle({ type: 'library.closed', libraryId: result.libraryId });
    }
    return result;
  } catch (error) {
    logger?.error('main.library-request', error);
    const publicError = toPublicError(error);
    if (operation) {
      publishLifecycle({ type: 'library.open-failed', operation, error: publicError });
    }
    return { ok: false, error: publicError };
  }
}

async function startApplication(): Promise<void> {
  app.setAppLogsPath();
  logger = new AppLogger(path.join(app.getPath('logs'), 'serpent.log'));
  workerClient = new LibraryWorkerClient(path.join(__dirname, 'library_worker.js'), logger);
  await workerClient.start();
  workerClient.onAssetsChanged(publishAssetChange);
  workerClient.onProgress(publishProgress);

  ipcMain.handle(LIBRARY_REQUEST_CHANNEL, (event, input: unknown) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) {
      return { ok: false, error: createPublicError('INTERNAL_ERROR') } satisfies RendererResult;
    }
    return handleLibraryRequest(input);
  });

  ipcMain.on(ACTIVE_CONTEXT_CHANNEL, (event, input: unknown) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return;
    try {
      const context = parseActiveContext(input);
      const windowId = BrowserWindow.fromWebContents(event.sender)?.id;
      if (windowId !== undefined) {
        focusedContexts.set(windowId, context);
      }
    } catch {
      // Malformed input is silently dropped.
    }
  });

  await createMainWindow();

  // Start the browser-extension HTTP server on 127.0.0.1.
  try {
    extensionServer = await createExtensionServer({
      port: 19876,
      onSaveIntent: (intent) => handleSaveIntent(intent),
      onError: (err) => logger?.error('extension-server', err),
    });
    logger?.info('extension-server', `Browser extension server started on port ${extensionServer.port}.`);
  } catch (error) {
    logger?.error('extension-server', error);
    // Extension server failure is non-fatal; the app continues without it.
  }

  startupComplete = true;
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', focusMainWindow);

  app.whenReady().then(startApplication).catch((error: unknown) => {
    logger?.error('main.startup', error);
    dialog.showErrorBox('Serpent could not start', toPublicError(error).message);
    app.quit();
  });

  app.on('activate', () => {
    if (!startupComplete) return;
    if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
    else focusMainWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', (event) => {
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
