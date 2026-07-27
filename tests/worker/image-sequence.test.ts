import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  LibraryService,
  LibraryServiceError,
} from "../../src/worker/library-service";

const roots: string[] = [];
const services: LibraryService[] = [];

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "serpent-sequence-"));
  roots.push(root);
  const service = new LibraryService();
  services.push(service);
  const library = service.createLibrary({
    displayName: "Sequences",
    selectedParentPath: root,
  });
  return { library, root, service };
}

function writeFrames(directory: string, names: readonly string[]): string[] {
  mkdirSync(directory, { recursive: true });
  return names.map((name, index) => {
    const filePath = path.join(directory, name);
    writeFileSync(filePath, `frame-${index}-${name}`);
    return filePath;
  });
}

afterEach(() => {
  for (const service of services.splice(0)) service.closeAll();
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("image sequence persistence", () => {
  it("expands a single selected frame to its continuous sibling run", () => {
    const { library, root, service } = fixture();
    const frames = writeFrames(path.join(root, "source"), [
      "shot_001.png",
      "shot_002.png",
      "shot_003.png",
      "shot_005.png",
    ]);

    const completion = service.prepareOrExecuteImport({
      libraryId: library.libraryId,
      sourceKind: "files",
      sourcePaths: [frames[1]!],
    });

    expect("importId" in completion).toBe(false);
    if ("importId" in completion) return;
    expect(completion.importedCount).toBe(3);
    const assets = service.listAssets({
      libraryId: library.libraryId,
      recursive: true,
    });
    expect(assets).toHaveLength(1);
    expect(assets[0]!.sequence).toMatchObject({
      fps: 24,
      frameCount: 3,
      frames: [
        { frameNumber: 1, displayName: "shot_001.png" },
        { frameNumber: 2, displayName: "shot_002.png" },
        { frameNumber: 3, displayName: "shot_003.png" },
      ],
    });
  });

  it("splits folder-import gaps into separate visible sequence cards", () => {
    const { library, root, service } = fixture();
    const source = path.join(root, "source");
    writeFrames(source, [
      "img_1.png",
      "img_2.png",
      "img_3.png",
      "img_5.png",
      "img_6.png",
      "img_7.png",
    ]);

    const completion = service.prepareOrExecuteImport({
      libraryId: library.libraryId,
      sourceKind: "folder",
      sourcePaths: [source],
    });
    expect("importId" in completion).toBe(false);
    const assets = service.listAssets({
      libraryId: library.libraryId,
      recursive: true,
    });
    expect(assets).toHaveLength(2);
    expect(assets.map((asset) =>
      asset.sequence?.frames.map((frame) => frame.frameNumber),
    )).toEqual([[1, 2, 3], [5, 6, 7]]);
  });

  it("groups linked frames that arrive across separate refreshes", () => {
    const { library, root, service } = fixture();
    const linkedRoot = path.join(root, "linked-sequence");
    mkdirSync(linkedRoot, { recursive: true });
    service.importFolderAsLinked({
      libraryId: library.libraryId,
      sourceRootPath: linkedRoot,
    });

    for (let frame = 0; frame < 3; frame += 1) {
      writeFrames(linkedRoot, [`capture_${frame}.png`]);
      service.refreshManagedAssets(library.libraryId);
    }

    const assets = service.listAssets({
      libraryId: library.libraryId,
      recursive: true,
    });
    expect(assets).toHaveLength(1);
    expect(assets[0]!.sequence?.frames.map((frame) => frame.frameNumber))
      .toEqual([0, 1, 2]);
  });

  it("creates and dissolves a manual sequence with a chosen fps", () => {
    const { library, root, service } = fixture();
    const frames = ["anim_10.png", "anim_11.png", "anim_12.png"].map(
      (name, index) =>
        writeFrames(path.join(root, `source-${index}`), [name])[0]!,
    );
    for (const frame of frames) {
      const result = service.prepareOrExecuteImport({
        libraryId: library.libraryId,
        sourceKind: "files",
        sourcePaths: [frame],
      });
      expect("importId" in result).toBe(false);
    }
    const automaticallyDetected = service.listAssets({
      libraryId: library.libraryId,
      recursive: true,
    });
    expect(automaticallyDetected).toHaveLength(1);
    service.dissolveImageSequence({
      libraryId: library.libraryId,
      sequenceId: automaticallyDetected[0]!.sequence!.sequenceId,
    });
    const before = service.listAssets({
      libraryId: library.libraryId,
      recursive: true,
    });
    expect(before).toHaveLength(3);

    const primary = service.createImageSequence({
      libraryId: library.libraryId,
      assetIds: before.map((asset) => asset.assetId),
      fps: 12,
    });
    expect(primary.sequence).toMatchObject({ fps: 12, frameCount: 3 });
    expect(service.listAssets({
      libraryId: library.libraryId,
      recursive: true,
    })).toHaveLength(1);

    service.dissolveImageSequence({
      libraryId: library.libraryId,
      sequenceId: primary.sequence!.sequenceId,
    });
    expect(service.listAssets({
      libraryId: library.libraryId,
      recursive: true,
    })).toHaveLength(3);
  });

  it("rejects manual non-consecutive selections", () => {
    const { library, root, service } = fixture();
    const frames = writeFrames(path.join(root, "source"), [
      "anim_1.png",
      "anim_3.png",
      "anim_5.png",
    ]);
    for (const frame of frames) {
      service.prepareOrExecuteImport({
        libraryId: library.libraryId,
        sourceKind: "files",
        sourcePaths: [frame],
      });
    }
    const assets = service.listAssets({
      libraryId: library.libraryId,
      recursive: true,
    });
    expect(() => service.createImageSequence({
      libraryId: library.libraryId,
      assetIds: assets.map((asset) => asset.assetId),
      fps: 24,
    })).toThrowError(LibraryServiceError);
  });
});
