import { describe, expect, it } from "vitest";

import {
  NATIVE_DIALOG_IDS,
  mapSystemLocaleToAppLocale,
  resolveNativeDialogCopy,
  tryParseAppLocaleSync,
} from "../../src/shared/native-dialog-i18n";

describe("native dialog i18n (Serpent-bwb)", () => {
  it("parses locale sync payloads and rejects junk", () => {
    expect(tryParseAppLocaleSync({ locale: "en" })).toEqual({
      ok: true,
      locale: "en",
    });
    expect(tryParseAppLocaleSync({ locale: "zh-CN" })).toEqual({
      ok: true,
      locale: "zh-CN",
    });
    expect(tryParseAppLocaleSync({ locale: "fr" }).ok).toBe(false);
    expect(tryParseAppLocaleSync({ locale: "en", extra: true }).ok).toBe(false);
    expect(tryParseAppLocaleSync("en").ok).toBe(false);
  });

  it("maps system locale tags to app catalogs", () => {
    expect(mapSystemLocaleToAppLocale("zh-Hans-CN")).toBe("zh-CN");
    expect(mapSystemLocaleToAppLocale("zh")).toBe("zh-CN");
    expect(mapSystemLocaleToAppLocale("en-US")).toBe("en");
    expect(mapSystemLocaleToAppLocale("ja-JP")).toBe("en");
  });

  it("resolves every dialog id in both locales without empty strings", () => {
    for (const id of NATIVE_DIALOG_IDS) {
      const en = resolveNativeDialogCopy("en", id);
      const zh = resolveNativeDialogCopy("zh-CN", id);
      expect(en.title.trim().length).toBeGreaterThan(0);
      expect(en.buttonLabel.trim().length).toBeGreaterThan(0);
      expect(zh.title.trim().length).toBeGreaterThan(0);
      expect(zh.buttonLabel.trim().length).toBeGreaterThan(0);
      expect(en.title).not.toBe(zh.title);
    }
  });

  it("keeps import/export families locale-consistent (no EN/ZH mix)", () => {
    const enImport = resolveNativeDialogCopy("en", "importFiles");
    const zhImport = resolveNativeDialogCopy("zh-CN", "importFiles");
    const enExport = resolveNativeDialogCopy("en", "exportZip");
    const zhExport = resolveNativeDialogCopy("zh-CN", "exportZip");

    expect(enImport.title).toBe("Import Files");
    expect(enImport.buttonLabel).toBe("Import");
    expect(zhImport.title).toBe("\u5bfc\u5165\u6587\u4ef6");
    expect(zhImport.buttonLabel).toBe("\u5bfc\u5165");

    expect(enExport.title).toBe("Export as ZIP");
    expect(enExport.filterName).toBe("ZIP files");
    expect(zhExport.title).toBe("\u5bfc\u51fa\u4e3a ZIP");
    expect(zhExport.filterName).toBe("ZIP \u6587\u4ef6");
  });

  it('keeps Eagle open as two folder pickers: source then Serpent save location', () => {
    const enSource = resolveNativeDialogCopy("en", "openEagleLibrary");
    const zhSource = resolveNativeDialogCopy("zh-CN", "openEagleLibrary");
    const enDest = resolveNativeDialogCopy("en", "openEagleLibraryDestination");
    const zhDest = resolveNativeDialogCopy("zh-CN", "openEagleLibraryDestination");
    expect(enSource.title).toBe("Open Eagle Library");
    expect(zhSource.title).toBe("\u6253\u5f00 Eagle \u8d44\u6e90\u5e93");
    expect(enDest.title).toBe("Choose where to save the Serpent library");
    expect(zhDest.title).toBe("\u9009\u62e9 Serpent \u8d44\u6e90\u5e93\u4fdd\u5b58\u4f4d\u7f6e");
    expect(enDest.title).not.toBe(enSource.title);
    expect(zhDest.title).not.toBe(zhSource.title);
  });
});
