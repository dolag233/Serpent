import { describe, expect, it } from "vitest";

import { LibraryService } from "../../src/worker/library-service";

describe("LibraryService.toSummaryMediaType (Serpent-671)", () => {
  it("preserves audio and text instead of collapsing to other", () => {
    expect(LibraryService.toSummaryMediaType("audio")).toBe("audio");
    expect(LibraryService.toSummaryMediaType("text")).toBe("text");
    expect(LibraryService.toSummaryMediaType("image")).toBe("image");
    expect(LibraryService.toSummaryMediaType("video")).toBe("video");
    expect(LibraryService.toSummaryMediaType("model")).toBe("model");
    expect(LibraryService.toSummaryMediaType("other")).toBe("other");
  });

  it("detects mp3 as audio for summary mapping", () => {
    expect(
      LibraryService.toSummaryMediaType(
        LibraryService.detectMediaType("track.mp3"),
      ),
    ).toBe("audio");
  });

  it("classifies Adobe Illustrator files as documents", () => {
    expect(LibraryService.detectMediaType("illustration.ai")).toBe("document");
    expect(LibraryService.toSummaryMediaType(
      LibraryService.detectMediaType("illustration.ai"),
    )).toBe("document");
  });

  it("classifies the T1 3D formats as model (slice A)", () => {
    for (const filename of [
      "character.fbx",
      "asset.OBJ",
      "scene.gltf",
      "baked.GLB",
      "part.stl",
    ]) {
      expect(LibraryService.detectMediaType(filename)).toBe("model");
      expect(
        LibraryService.toSummaryMediaType(
          LibraryService.detectMediaType(filename),
        ),
      ).toBe("model");
    }
  });

  it("does not classify adjacent formats as model", () => {
    // .dae/.3ds/.blend stay `other`. DCC project files are not in the T1 set.
    expect(LibraryService.detectMediaType("scene.dae")).toBe("other");
    expect(LibraryService.detectMediaType("mesh.3ds")).toBe("other");
    expect(LibraryService.detectMediaType("project.blend")).toBe("other");
    expect(LibraryService.detectMediaType("readme.obj.txt")).toBe("text");
  });

  // Serpent-485aeb：字体不再落到 other，也不再和纯文本抢分类。
  it("classifies font formats as font", () => {
    for (const filename of [
      "Inter.ttf",
      "SourceHanSans.OTF",
      "webfont.woff",
      "webfont.WOFF2",
      "collection.ttc",
    ]) {
      expect(LibraryService.detectMediaType(filename)).toBe("font");
      expect(
        LibraryService.toSummaryMediaType(
          LibraryService.detectMediaType(filename),
        ),
      ).toBe("font");
    }
    expect(LibraryService.toSummaryMediaType("font")).toBe("font");
    // 未知/相邻扩展名不受影响
    expect(LibraryService.detectMediaType("font.eot")).toBe("other");
    expect(LibraryService.detectMediaType("font.pfb")).toBe("other");
  });
});
