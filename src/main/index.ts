import path from 'node:path';

import { app, BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron';

import {
  LIBRARY_LIFECYCLE_CHANNEL,
  LIBRARY_REQUEST_CHANNEL,
} from '../shared/protocol/channels';
import { createPublicError, toPublicError } from '../shared/protocol/errors';
import { parseRendererRequest, type RendererRequest, type WorkerCommand } from '../shared/protocol/requests';
import {
  parseRendererResult,
  parseRendererLifecycleEvent,
  type RendererLifecycleEvent,
  type RendererResult,
  type WorkerResult,
} from '../shared/protocol/responses';
import { LibraryWorkerClient } from './worker-client';

app.enableSandbox();

const hasSingleInstanceLock = app.requestSingleInstanceLock();

let mainWindow: BrowserWindow | undefined;
let workerClient: LibraryWorkerClient | undefined;
let quitAfterShutdown = false;
let startupComplete = false;

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
    if (mainWindow === window) mainWindow = undefined;
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

function publishLifecycle(event: RendererLifecycleEvent): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(
    LIBRARY_LIFECYCLE_CHANNEL,
    parseRendererLifecycleEvent(event),
  );
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
  return parseRendererResult(result);
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
  }
}

async function handleLibraryRequest(input: unknown): Promise<RendererResult> {
  let operation: 'create' | 'open' | undefined;
  try {
    const request = parseRendererRequest(input);
    const command = await commandFor(request);
    if (!command) return cancelled();
    if (!workerClient) throw new Error('Library Worker is unavailable.');
    if (command.type === 'library.create') operation = 'create';
    if (command.type === 'library.open') operation = 'open';
    if (operation) publishLifecycle({ type: 'library.opening', operation });

    const result = toRendererResult(await workerClient.request(command));
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
    } else if (result.type === 'library.closed') {
      publishLifecycle({ type: 'library.closed', libraryId: result.libraryId });
    }
    return result;
  } catch (error) {
    const publicError = toPublicError(error);
    if (operation) {
      publishLifecycle({ type: 'library.open-failed', operation, error: publicError });
    }
    return { ok: false, error: publicError };
  }
}

async function startApplication(): Promise<void> {
  workerClient = new LibraryWorkerClient(path.join(__dirname, 'library_worker.js'));
  await workerClient.start();

  ipcMain.handle(LIBRARY_REQUEST_CHANNEL, (event, input: unknown) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) {
      return { ok: false, error: createPublicError('INTERNAL_ERROR') } satisfies RendererResult;
    }
    return handleLibraryRequest(input);
  });
  await createMainWindow();
  startupComplete = true;
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', focusMainWindow);

  app.whenReady().then(startApplication).catch((error: unknown) => {
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
    void workerClient.shutdown().finally(() => {
      quitAfterShutdown = true;
      app.quit();
    });
  });
}
