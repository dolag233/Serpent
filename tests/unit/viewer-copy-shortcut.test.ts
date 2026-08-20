import { describe, expect, it } from "vitest";

import { shouldCopyAssetOnShortcut } from "../../src/renderer/viewer-copy-shortcut";

function ctx(overrides: Partial<Parameters<typeof shouldCopyAssetOnShortcut>[0]> = {}) {
  return {
    isTextViewer: false,
    metaOrCtrl: true,
    key: "c",
    targetTag: null,
    contentEditable: false,
    ...overrides,
  };
}

describe("shouldCopyAssetOnShortcut (Serpent-f8e175)", () => {
  it("copies on Ctrl+C / Cmd+C outside editable targets", () => {
    expect(shouldCopyAssetOnShortcut(ctx())).toBe(true);
    expect(shouldCopyAssetOnShortcut(ctx({ key: "C" }))).toBe(true);
  });

  it("ignores other keys even with a modifier", () => {
    expect(shouldCopyAssetOnShortcut(ctx({ key: "v" }))).toBe(false);
    expect(shouldCopyAssetOnShortcut(ctx({ key: "x", metaOrCtrl: false }))).toBe(false);
  });

  it("never intercepts inside the text viewer (native selection copy wins)", () => {
    expect(shouldCopyAssetOnShortcut(ctx({ isTextViewer: true }))).toBe(false);
  });

  it("does not steal the shortcut from focused form controls", () => {
    expect(shouldCopyAssetOnShortcut(ctx({ targetTag: "INPUT" }))).toBe(false);
    expect(shouldCopyAssetOnShortcut(ctx({ targetTag: "TEXTAREA" }))).toBe(false);
    expect(shouldCopyAssetOnShortcut(ctx({ targetTag: "SELECT" }))).toBe(false);
  });

  it("does not steal the shortcut from contentEditable regions", () => {
    expect(shouldCopyAssetOnShortcut(ctx({ contentEditable: true }))).toBe(false);
  });

  it("copies when the target is an ordinary image/figure element", () => {
    expect(shouldCopyAssetOnShortcut(ctx({ targetTag: "DIV" }))).toBe(true);
    expect(shouldCopyAssetOnShortcut(ctx({ targetTag: "IMG" }))).toBe(true);
  });
});