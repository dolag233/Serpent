/**
 * Native file-dialog / Main-process copy by app locale (Serpent-bwb).
 *
 * Renderer UI catalogs stay in `src/renderer/i18n`. This module is shared so
 * Main can resolve dialog titles/buttons without importing Renderer code, and
 * unit tests can assert both locales without Electron.
 */

import { z } from "zod";

export type AppLocale = "zh-CN" | "en";

export const appLocaleSchema = z.enum(["zh-CN", "en"]);

export const appLocaleSyncSchema = z.strictObject({
  locale: appLocaleSchema,
});

export type AppLocaleSyncPayload = z.infer<typeof appLocaleSyncSchema>;

export type AppLocaleParseResult =
  | { ok: true; locale: AppLocale }
  | { ok: false; code: "invalid_payload"; issuePaths: string[] };

export function tryParseAppLocaleSync(input: unknown): AppLocaleParseResult {
  const parsed = appLocaleSyncSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "invalid_payload",
      issuePaths: parsed.error.issues.map((issue) => issue.path.join(".")),
    };
  }
  return { ok: true, locale: parsed.data.locale };
}

/** Map Electron `app.getLocale()` / BCP-47 tags to Serpent catalogs. */
export function mapSystemLocaleToAppLocale(raw: string): AppLocale {
  const tag = raw.toLowerCase();
  if (tag === "zh" || tag.startsWith("zh-")) return "zh-CN";
  return "en";
}

export type NativeDialogId =
  | "importFiles"
  | "importFolder"
  | "importEagleLibrary"
  | "importBillfishLibrary"
  | "openEagleLibrary"
  | "openBillfishLibrary"
  | "openEagleLibraryDestination"
  | "openSyncLibraryDestination"
  | "createLibrary"
  | "openLibrary"
  | "linkFolder"
  | "relinkFolder"
  | "locateMissingAsset"
  | "selectRelinkRoot"
  | "exportZip"
  | "exportFolder"
  | "importLibraryFolder"
  | "importZip"
  | "importZipDestination"
  | "importCopyDestination"
  | "openAutomationScript"
  | "saveAutomationScript"
  /** macOS application picker for "Open With…" (Serpent-w29). */
  | "chooseApplication";

export type NativeDialogCopy = {
  readonly title: string;
  readonly buttonLabel: string;
  /** Optional file-filter display name (ZIP, etc.). */
  readonly filterName?: string;
};

type DialogCatalog = Record<NativeDialogId, NativeDialogCopy>;

const EN: DialogCatalog = {
  importFiles: { title: "Import Files", buttonLabel: "Import" },
  importFolder: { title: "Import Folder", buttonLabel: "Import Folder" },
  importEagleLibrary: {
    title: "Import Eagle Library",
    buttonLabel: "Import Eagle Library",
  },
  importBillfishLibrary: {
    title: "Import Billfish Library",
    buttonLabel: "Import Billfish Library",
  },
  openEagleLibrary: {
    title: "Open Eagle Library",
    buttonLabel: "Open Eagle Library",
  },
  openBillfishLibrary: {
    title: "Open Billfish Library",
    buttonLabel: "Open Billfish Library",
  },
  openEagleLibraryDestination: {
    title: "Choose the parent folder for the new Serpent library",
    buttonLabel: "Save here",
  },
  openSyncLibraryDestination: {
    title: "Choose where to create the synced library",
    buttonLabel: "Create here",
  },
  createLibrary: { title: "Create Library", buttonLabel: "Choose Folder" },
  openLibrary: { title: "Open Library", buttonLabel: "Open" },
  linkFolder: {
    title: "Link Folder to Library",
    buttonLabel: "Link Folder",
  },
  relinkFolder: {
    title: "Relink Folder",
    buttonLabel: "Select New Location",
  },
  locateMissingAsset: {
    title: "Locate Missing Asset",
    buttonLabel: "Select File",
  },
  selectRelinkRoot: {
    title: "Select New Root for Relinking",
    buttonLabel: "Select Folder",
  },
  exportZip: {
    title: "Export as ZIP",
    buttonLabel: "Export ZIP",
    filterName: "ZIP files",
  },
  exportFolder: {
    title: "Export as Folder",
    buttonLabel: "Create Export Folder",
  },
  importLibraryFolder: {
    title: "Select library folder to import",
    buttonLabel: "Import this library",
  },
  importZip: {
    title: "Select ZIP file to import",
    buttonLabel: "Import this ZIP",
    filterName: "ZIP files",
  },
  importZipDestination: {
    title: "Choose where to extract the library",
    buttonLabel: "Extract here",
  },
  importCopyDestination: {
    title: "Choose where to copy the library",
    buttonLabel: "Copy here",
  },
  openAutomationScript: {
    title: "Open Automation Script",
    buttonLabel: "Open Script",
    filterName: "Serpent scripts",
  },
  saveAutomationScript: {
    title: "Save Automation Script",
    buttonLabel: "Save Script",
    filterName: "Serpent scripts",
  },
  chooseApplication: {
    title: "Choose Application",
    buttonLabel: "Open",
    filterName: "Applications",
  },
};

const ZH_CN: DialogCatalog = {
  importFiles: { title: "\u5bfc\u5165\u6587\u4ef6", buttonLabel: "\u5bfc\u5165" },
  importFolder: {
    title: "\u5bfc\u5165\u6587\u4ef6\u5939",
    buttonLabel: "\u5bfc\u5165\u6587\u4ef6\u5939",
  },
  importEagleLibrary: {
    title: "\u5bfc\u5165 Eagle \u8d44\u6e90\u5e93",
    buttonLabel: "\u5bfc\u5165 Eagle \u8d44\u6e90\u5e93",
  },
  importBillfishLibrary: {
    title: "\u5bfc\u5165 Billfish \u8d44\u6e90\u5e93",
    buttonLabel: "\u5bfc\u5165 Billfish \u8d44\u6e90\u5e93",
  },
  openEagleLibrary: {
    title: "\u6253\u5f00 Eagle \u8d44\u6e90\u5e93",
    buttonLabel: "\u6253\u5f00 Eagle \u8d44\u6e90\u5e93",
  },
  openBillfishLibrary: {
    title: "\u6253\u5f00 Billfish \u8d44\u6e90\u5e93",
    buttonLabel: "\u6253\u5f00 Billfish \u8d44\u6e90\u5e93",
  },
  openEagleLibraryDestination: {
    title: "\u9009\u62e9\u7528\u6765\u5b58\u653e\u65b0 Serpent \u8d44\u6e90\u5e93\u7684\u7236\u6587\u4ef6\u5939",
    buttonLabel: "\u4fdd\u5b58\u5230\u6b64\u5904",
  },
  openSyncLibraryDestination: {
    title: "\u9009\u62e9\u540c\u6b65\u8d44\u6e90\u5e93\u521b\u5efa\u4f4d\u7f6e",
    buttonLabel: "\u521b\u5efa\u5728\u6b64\u5904",
  },
  createLibrary: {
    title: "\u521b\u5efa\u8d44\u6e90\u5e93",
    buttonLabel: "\u9009\u62e9\u6587\u4ef6\u5939",
  },
  openLibrary: {
    title: "\u6253\u5f00\u8d44\u6e90\u5e93",
    buttonLabel: "\u6253\u5f00",
  },
  linkFolder: {
    title: "\u94fe\u63a5\u6587\u4ef6\u5939\u5230\u8d44\u6e90\u5e93",
    buttonLabel: "\u94fe\u63a5\u6587\u4ef6\u5939",
  },
  relinkFolder: {
    title: "\u91cd\u65b0\u94fe\u63a5\u6587\u4ef6\u5939",
    buttonLabel: "\u9009\u62e9\u65b0\u4f4d\u7f6e",
  },
  locateMissingAsset: {
    title: "\u5b9a\u4f4d\u4e22\u5931\u8d44\u4ea7",
    buttonLabel: "\u9009\u62e9\u6587\u4ef6",
  },
  selectRelinkRoot: {
    title: "\u9009\u62e9\u91cd\u65b0\u5b9a\u4f4d\u7684\u65b0\u6839\u76ee\u5f55",
    buttonLabel: "\u9009\u62e9\u6587\u4ef6\u5939",
  },
  exportZip: {
    title: "\u5bfc\u51fa\u4e3a ZIP",
    buttonLabel: "\u5bfc\u51fa ZIP",
    filterName: "ZIP \u6587\u4ef6",
  },
  exportFolder: {
    title: "\u5bfc\u51fa\u4e3a\u6587\u4ef6\u5939",
    buttonLabel: "\u521b\u5efa\u5bfc\u51fa\u6587\u4ef6\u5939",
  },
  importLibraryFolder: {
    title: "\u9009\u62e9\u8981\u5bfc\u5165\u7684\u8d44\u6e90\u5e93\u6587\u4ef6\u5939",
    buttonLabel: "\u5bfc\u5165\u6b64\u8d44\u6e90\u5e93",
  },
  importZip: {
    title: "\u9009\u62e9\u8981\u5bfc\u5165\u7684 ZIP \u6587\u4ef6",
    buttonLabel: "\u5bfc\u5165\u6b64 ZIP",
    filterName: "ZIP \u6587\u4ef6",
  },
  importZipDestination: {
    title:
      "\u9009\u62e9\u8d44\u6e90\u5e93\u4fdd\u5b58\u8def\u5f84\uff08\u8d44\u6e90\u5e93\u5c06\u89e3\u538b\u5230\u6b64\u6587\u4ef6\u5939\u5185\uff09",
    buttonLabel: "\u89e3\u538b\u5230\u6b64\u5904",
  },
  importCopyDestination: {
    title:
      "\u9009\u62e9\u5bfc\u5165\u76ee\u6807\u4f4d\u7f6e\uff08\u8d44\u6e90\u5e93\u5c06\u590d\u5236\u5230\u6b64\u6587\u4ef6\u5939\u5185\uff09",
    buttonLabel: "\u590d\u5236\u5230\u6b64\u5904",
  },
  openAutomationScript: {
    title: "\u6253\u5f00\u81ea\u52a8\u5316\u811a\u672c",
    buttonLabel: "\u6253\u5f00\u811a\u672c",
    filterName: "Serpent \u811a\u672c",
  },
  saveAutomationScript: {
    title: "\u4fdd\u5b58\u81ea\u52a8\u5316\u811a\u672c",
    buttonLabel: "\u4fdd\u5b58\u811a\u672c",
    filterName: "Serpent \u811a\u672c",
  },
  chooseApplication: {
    title: "\u9009\u62e9\u5e94\u7528",
    buttonLabel: "\u6253\u5f00",
    filterName: "\u5e94\u7528\u7a0b\u5e8f",
  },
};

const CATALOGS: Record<AppLocale, DialogCatalog> = {
  en: EN,
  "zh-CN": ZH_CN,
};

export const NATIVE_DIALOG_IDS = Object.keys(EN) as NativeDialogId[];

export function resolveNativeDialogCopy(
  locale: AppLocale,
  id: NativeDialogId,
): NativeDialogCopy {
  return CATALOGS[locale][id];
}
