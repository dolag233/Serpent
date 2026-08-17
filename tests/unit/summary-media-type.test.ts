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
    // OBJ/STL are ASCII by nature, but they are model assets, not text files;
    // .dae/.3ds/.blend stay `other` until slice G.
    expect(LibraryService.detectMediaType("scene.dae")).toBe("other");
    expect(LibraryService.detectMediaType("mesh.3ds")).toBe("other");
    expect(LibraryService.detectMediaType("project.blend")).toBe("other");
    expect(LibraryService.detectMediaType("readme.obj.txt")).toBe("text");
  });
});
