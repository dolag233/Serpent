import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";
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

async function writePngFrames(
  directory: string,
  names: readonly string[],
  size: { width: number; height: number },
): Promise<string[]> {
  mkdirSync(directory, { recursive: true });
  return Promise.all(
    names.map(async (name) => {
      const filePath = path.join(directory, name);
      await sharp({
        create: {
          background: { b: 32, g: 96, r: 192 },
          channels: 3,
          height: size.height,
          width: size.width,
        },
      })
        .png()
        .toFile(filePath);
      return filePath;
    }),
  );
}

afterEach(() => {
  for (const service of services.splice(0)) service.closeAll();
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("image sequence persistence", () => {
  it("offers a sequence only when every candidate frame has matching dimensions", async () => {
    const { library, root, service } = fixture();
    const source = path.join(root, "source");
    const frames = await writePngFrames(
      source,
      ["shot_001.png", "shot_002.png", "shot_003.png"],
      { height: 2, width: 2 },
    );
    await sharp({
      create: {
        background: { b: 32, g: 96, r: 192 },
        channels: 3,
        height: 3,
        width: 2,
      },
    })
      .png()
      .toFile(frames[1]!);

    await expect(
      service.probeImageSequenceImportOffer({
        libraryId: library.libraryId,
        sourcePaths: [frames[0]!],
      }),
    ).resolves.toBeNull();

    await writePngFrames(source, ["shot_002.png"], { height: 2, width: 2 });
    const offer = await service.probeImageSequenceImportOffer({
      libraryId: library.libraryId,
      sourcePaths: [frames[0]!],
    });
    expect(offer?.sequences).toHaveLength(1);
    expect(offer?.sequences[0]).toMatchObject({
      frameCount: 3,
      height: 2,
      width: 2,
    });
  });

  it("keeps a normal file import as separate assets when sequence creation is disabled", () => {
    const { library, root, service } = fixture();
    const frames = writeFrames(path.join(root, "source"), [
      "still_001.png",
      "still_002.png",
      "still_003.png",
    ]);
    const completion = service.prepareOrExecuteImport({
      createImageSequence: false,
      libraryId: library.libraryId,
      sourceKind: "files",
      sourcePaths: frames,
    });
    expect("importId" in completion).toBe(false);
    expect(
      service.listAssets({ libraryId: library.libraryId, recursive: true }),
    ).toHaveLength(3);
  });

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
      expandImageSequences: true,
      imageSequenceFps: 30,
    });

    expect("importId" in completion).toBe(false);
    if ("importId" in completion) return;
    expect(completion.importedCount).toBe(3);
    const assets = service.listAssets({
      libraryId: library.libraryId,
      recursive: true,
    });
    expect(assets).toHaveLength(1);
    expect(assets[0]!.displayName).toBe("shot_001~003");
    expect(assets[0]!.sequence).toMatchObject({
      fps: 30,
      frameCount: 3,
      frames: [
        { frameNumber: 1, displayName: "shot_001.png" },
        { frameNumber: 2, displayName: "shot_002.png" },
        { frameNumber: 3, displayName: "shot_003.png" },
      ],
    });
  });

  it("does not flag identical-byte sequence frames as content duplicates", () => {
    const { library, root, service } = fixture();
    const source = path.join(root, "source");
    mkdirSync(source, { recursive: true });
    const bytes = Buffer.from("same-particle-frame");
    const frames = ["spark_000.png", "spark_001.png", "spark_002.png"].map(
      (name) => {
        const filePath = path.join(source, name);
        writeFileSync(filePath, bytes);
        return filePath;
      },
    );

    const completion = service.prepareOrExecuteImport({
      libraryId: library.libraryId,
      sourceKind: "files",
      sourcePaths: frames,
      expandImageSequences: false,
      imageSequenceFps: 30,
    });
    expect("importId" in completion).toBe(false);
    if ("importId" in completion) return;
    expect(completion.importedCount).toBe(3);
    const assets = service.listAssets({
      libraryId: library.libraryId,
      recursive: true,
    });
    expect(assets).toHaveLength(1);
    expect(assets[0]!.sequence?.frameCount).toBe(3);
  });

  it("trashes a sequence as one visible trash card and restores the group", () => {
    const { library, root, service } = fixture();
    const frames = writeFrames(path.join(root, "source"), [
      "clip_001.png",
      "clip_002.png",
      "clip_003.png",
    ]);
    const completion = service.prepareOrExecuteImport({
      libraryId: library.libraryId,
      sourceKind: "files",
      sourcePaths: frames,
      expandImageSequences: false,
      imageSequenceFps: 30,
    });
    expect("importId" in completion).toBe(false);
    if ("importId" in completion) return;
    const [primary] = service.listAssets({
      libraryId: library.libraryId,
      recursive: true,
    });
    expect(primary?.sequence?.frameCount).toBe(3);

    service.trashAssets({
      libraryId: library.libraryId,
      assetIds: [primary!.assetId],
    });
    expect(
      service
        .listAssets({ libraryId: library.libraryId, recursive: true })
        .filter((asset) => !asset.deletedAt),
    ).toHaveLength(0);
    const trash = service.listTrash(library.libraryId);
    expect(trash).toHaveLength(1);
    expect(trash[0]!.sequence?.frameCount).toBe(3);
    expect(trash[0]!.displayName).toBe("clip_001~003");

    service.restoreAssets({
      libraryId: library.libraryId,
      assetIds: [trash[0]!.assetId],
    });
    expect(service.listTrash(library.libraryId)).toHaveLength(0);
    const restored = service
      .listAssets({ libraryId: library.libraryId, recursive: true })
      .filter((asset) => !asset.deletedAt);
    expect(restored).toHaveLength(1);
    expect(restored[0]!.sequence?.frameCount).toBe(3);
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

  it("reports total sequence bytes and updates playback FPS", () => {
    const { library, root, service } = fixture();
    const frames = writeFrames(path.join(root, "source"), [
      "clip_001.png",
      "clip_002.png",
      "clip_003.png",
    ]);
    const completion = service.prepareOrExecuteImport({
      libraryId: library.libraryId,
      sourceKind: "files",
      sourcePaths: frames,
      expandImageSequences: false,
      imageSequenceFps: 30,
    });
    expect("importId" in completion).toBe(false);
    if ("importId" in completion) return;

    const [primary] = service.listAssets({
      libraryId: library.libraryId,
      recursive: true,
    });
    expect(primary).toBeDefined();
    expect(primary!.byteSize).toBe(
      frames.reduce((total, frame) => total + statSync(frame).size, 0),
    );

    expect(
      service.setImageSequenceFps({
        libraryId: library.libraryId,
        sequenceId: primary!.sequence!.sequenceId,
        fps: 13,
      }),
    ).toEqual({ sequenceId: primary!.sequence!.sequenceId, fps: 13 });
    expect(
      service.listAssets({ libraryId: library.libraryId, recursive: true })[0]!
        .sequence!.fps,
    ).toBe(13);
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

  it("disk-deletes an entire sequence without leaking remaining frames", () => {
    const { library, root, service } = fixture();
    const frames = writeFrames(path.join(root, "source"), [
      "shot_001.png",
      "shot_002.png",
      "shot_003.png",
    ]);
    const completion = service.prepareOrExecuteImport({
      libraryId: library.libraryId,
      sourceKind: "files",
      sourcePaths: frames,
      expandImageSequences: false,
      imageSequenceFps: 30,
    });
    expect("importId" in completion).toBe(false);
    if ("importId" in completion) return;
    const [primary] = service.listAssets({
      libraryId: library.libraryId,
      recursive: true,
    });
    expect(primary?.sequence?.frameCount).toBe(3);

    const result = service.deleteAssetsFromDisk({
      libraryId: library.libraryId,
      assetIds: [primary!.assetId],
    });
    expect(result.deletedCount).toBe(1);
    expect(
      service.listAssets({ libraryId: library.libraryId, recursive: true }),
    ).toHaveLength(0);
  });

  it("counts a trashed sequence as one toast unit and folder badge as one", () => {
    const { library, root, service } = fixture();
    const folder = service.createManagedFolder({
      libraryId: library.libraryId,
      name: "seq-folder",
    });
    const frames = writeFrames(path.join(root, "source"), [
      "clip_001.png",
      "clip_002.png",
      "clip_003.png",
    ]);
    const completion = service.prepareOrExecuteImport({
      libraryId: library.libraryId,
      sourceKind: "files",
      sourcePaths: frames,
      targetFolderId: folder.folderId,
      expandImageSequences: false,
      imageSequenceFps: 30,
    });
    expect("importId" in completion).toBe(false);
    if ("importId" in completion) return;

    const folders = service.listManagedFolders(library.libraryId);
    const seqFolder = folders.find((entry) => entry.folderId === folder.folderId);
    expect(seqFolder?.directAssetCount).toBe(1);

    const [primary] = service.listAssets({
      libraryId: library.libraryId,
      folderId: folder.folderId,
      recursive: false,
    });
    const { trashedCount } = service.trashAssets({
      libraryId: library.libraryId,
      assetIds: [primary!.assetId],
    });
    expect(trashedCount).toBe(1);
    const trash = service.listTrash(library.libraryId);
    expect(trash).toHaveLength(1);
    expect(trash[0]!.sequence?.frameCount).toBe(3);
  });
});
