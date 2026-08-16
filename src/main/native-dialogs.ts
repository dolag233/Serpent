/**
 * Main-process native open/save dialog helpers (Serpent-bwb).
 *
 * Resolves localized title/buttonLabel from the shared catalog and keeps E2E
 * path injection keyed by dialog id (not English title strings).
 */

import path from "node:path";

import {
  dialog,
  type BrowserWindow,
  type OpenDialogOptions,
  type SaveDialogOptions,
} from "electron";

import {
  resolveNativeDialogCopy,
  type AppLocale,
  type NativeDialogId,
} from "../shared/native-dialog-i18n";

export type NativeDialogHost = {
  readonly getLocale: () => AppLocale;
  readonly getMainWindow: () => BrowserWindow | null;
  readonly isE2e: () => boolean;
};

function openOptionsFor(
  locale: AppLocale,
  id: NativeDialogId,
  properties: OpenDialogOptions["properties"],
  extras?: Pick<OpenDialogOptions, "filters">,
): OpenDialogOptions {
  const copy = resolveNativeDialogCopy(locale, id);
  return {
    title: copy.title,
    buttonLabel: copy.buttonLabel,
    properties,
    ...(extras?.filters
      ? {
          filters: extras.filters.map((filter) => ({
            ...filter,
            name: copy.filterName ?? filter.name,
          })),
        }
      : {}),
  };
}

function saveOptionsFor(
  locale: AppLocale,
  id: NativeDialogId,
  extras: Pick<SaveDialogOptions, "defaultPath" | "filters">,
): SaveDialogOptions {
  const copy = resolveNativeDialogCopy(locale, id);
  return {
    title: copy.title,
    buttonLabel: copy.buttonLabel,
    defaultPath: extras.defaultPath,
    ...(extras.filters
      ? {
          filters: extras.filters.map((filter) => ({
            ...filter,
            name: copy.filterName ?? filter.name,
          })),
        }
      : {}),
  };
}

async function showOpen(
  host: NativeDialogHost,
  options: OpenDialogOptions,
): Promise<Electron.OpenDialogReturnValue> {
  const mainWindow = host.getMainWindow();
  return mainWindow
    ? dialog.showOpenDialog(mainWindow, options)
    : dialog.showOpenDialog(options);
}

async function showSave(
  host: NativeDialogHost,
  options: SaveDialogOptions,
): Promise<Electron.SaveDialogReturnValue> {
  const mainWindow = host.getMainWindow();
  return mainWindow
    ? dialog.showSaveDialog(mainWindow, options)
    : dialog.showSaveDialog(options);
}

export async function selectImportSources(
  host: NativeDialogHost,
  sourceKind: "files" | "folder",
  e2eEnv: NodeJS.ProcessEnv = process.env,
): Promise<string[] | undefined> {
  if (host.isE2e()) {
    const value =
      sourceKind === "files"
        ? e2eEnv.SERPENT_E2E_IMPORT_FILES
        : e2eEnv.SERPENT_E2E_IMPORT_FOLDER;
    return value ? value.split(path.delimiter).filter(Boolean) : undefined;
  }

  const id: NativeDialogId =
    sourceKind === "files" ? "importFiles" : "importFolder";
  const options = openOptionsFor(
    host.getLocale(),
    id,
    sourceKind === "files"
      ? ["openFile", "multiSelections"]
      : ["openDirectory"],
  );
  const result = await showOpen(host, options);
  return result.canceled || result.filePaths.length === 0
    ? undefined
    : result.filePaths;
}

export async function selectLibraryDirectory(
  host: NativeDialogHost,
  dialogId: "createLibrary" | "openLibrary",
  e2eEnv: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  if (host.isE2e()) {
    return dialogId === "createLibrary"
      ? e2eEnv.SERPENT_E2E_CREATE_PARENT_PATH
      : e2eEnv.SERPENT_E2E_OPEN_LIBRARY_PATH;
  }

  const options = openOptionsFor(host.getLocale(), dialogId, [
    "openDirectory",
    "createDirectory",
  ]);
  const result = await showOpen(host, options);
  return result.canceled ? undefined : result.filePaths[0];
}

export async function selectOpenDirectory(
  host: NativeDialogHost,
  dialogId: NativeDialogId,
  e2ePath: string | undefined,
  options?: { readonly createDirectory?: boolean },
): Promise<string | undefined> {
  if (host.isE2e()) return e2ePath;
  const properties: OpenDialogOptions["properties"] = options?.createDirectory
    ? ["openDirectory", "createDirectory"]
    : ["openDirectory"];
  const result = await showOpen(
    host,
    openOptionsFor(host.getLocale(), dialogId, properties),
  );
  return result.canceled ? undefined : result.filePaths[0];
}

/**
 * Select either a directory or an archive file. Electron's native open panel
 * supports both choices in one panel; the filter only affects file entries,
 * while directories remain selectable on every desktop platform.
 */
export async function selectOpenLibrarySource(
  host: NativeDialogHost,
  dialogId: NativeDialogId,
  e2ePath: string | undefined,
  archiveExtensions: readonly string[],
): Promise<string | undefined> {
  if (host.isE2e()) return e2ePath;
  const result = await showOpen(
    host,
    openOptionsFor(host.getLocale(), dialogId, ["openFile", "openDirectory"], {
      filters: [
        {
          name: "Library archives",
          extensions: archiveExtensions.map((extension) => extension.replace(/^\./u, "")),
        },
      ],
    }),
  );
  return result.canceled ? undefined : result.filePaths[0];
}

export async function selectOpenFile(
  host: NativeDialogHost,
  dialogId: NativeDialogId,
  e2ePath: string | undefined,
  filters?: OpenDialogOptions["filters"],
): Promise<string | undefined> {
  if (host.isE2e()) return e2ePath;
  const result = await showOpen(
    host,
    openOptionsFor(host.getLocale(), dialogId, ["openFile"], { filters }),
  );
  return result.canceled ? undefined : result.filePaths[0];
}

export async function selectSavePath(
  host: NativeDialogHost,
  dialogId: NativeDialogId,
  e2ePath: string | undefined,
  extras: Pick<SaveDialogOptions, "defaultPath" | "filters">,
): Promise<string | undefined> {
  if (host.isE2e()) return e2ePath;
  const result = await showSave(
    host,
    saveOptionsFor(host.getLocale(), dialogId, extras),
  );
  return result.canceled ? undefined : result.filePath;
}
