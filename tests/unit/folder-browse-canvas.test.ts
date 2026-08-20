import { describe, expect, it } from "vitest";

import {
  resolveBrowseCanvasBodyLayout,
  shouldShowFolderBrowseCards,
} from "../../src/renderer/folder-browse-canvas";

describe("resolveBrowseCanvasBodyLayout (CANVAS-022 / Serpent-an1)", () => {
  it("returns empty when there are no folders and no assets", () => {
    expect(resolveBrowseCanvasBodyLayout(0, 0)).toEqual({ mode: "empty" });
  });

  it("skips the asset grid when only child folders are present", () => {
    expect(resolveBrowseCanvasBodyLayout(0, 3)).toEqual({
      mode: "folders-only",
      showFolders: true,
      showAssetGrid: false,
    });
  });

  it("shows the asset grid when assets are present without folders", () => {
    expect(resolveBrowseCanvasBodyLayout(5, 0)).toEqual({
      mode: "assets",
      showFolders: false,
      showAssetGrid: true,
    });
  });

  it("shows folders and the asset grid when both are present", () => {
    expect(resolveBrowseCanvasBodyLayout(2, 1)).toEqual({
      mode: "assets",
      showFolders: true,
      showAssetGrid: true,
    });
  });
});

describe("shouldShowFolderBrowseCards (Serpent-7a9e89)", () => {
  it("hides child folder cards when recursive browse is on for a folder scope", () => {
    expect(shouldShowFolderBrowseCards("folder-1", true)).toBe(false);
  });

  it("keeps folder cards when recursive browse is off", () => {
    expect(shouldShowFolderBrowseCards("folder-1", false)).toBe(true);
  });

  it("never hides folder cards for all/root scopes", () => {
    expect(shouldShowFolderBrowseCards("all", true)).toBe(true);
    expect(shouldShowFolderBrowseCards("root", true)).toBe(true);
  });

  it("is scoped to a concrete folder id only (recursive is never set outside it)", () => {
    expect(shouldShowFolderBrowseCards("all", false)).toBe(true);
    expect(shouldShowFolderBrowseCards("root", false)).toBe(true);
  });
});
