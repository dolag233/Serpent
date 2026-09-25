import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import sharp from "sharp";

import { isBakeableStillImageFile } from "../../src/shared/bakeable-still-image";
import {
  DEFAULT_IMAGE_ROTATION_PREFERENCES,
  loadImageRotationPreferences,
  saveImageRotationPreferences,
} from "../../src/renderer/image-rotation-preferences";
import { rotateStillImageFile } from "../../src/worker/rotate-still-image-file";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("image rotation preferences", () => {
  it("stays off until the user turns it on", () => {
    const storage = new Map<string, string>();
    const memory = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    };
    expect(loadImageRotationPreferences(memory)).toEqual(DEFAULT_IMAGE_ROTATION_PREFERENCES);
    expect(DEFAULT_IMAGE_ROTATION_PREFERENCES.bakeIntoFile).toBe(false);
    saveImageRotationPreferences({ version: 1, bakeIntoFile: true }, memory);
    expect(loadImageRotationPreferences(memory).bakeIntoFile).toBe(true);
  });
});

describe("bakeable still images", () => {
  it("accepts ordinary stills and skips video, sequences formats, and raw", () => {
    expect(isBakeableStillImageFile("photo.png")).toBe(true);
    expect(isBakeableStillImageFile("photo.JPEG")).toBe(true);
    expect(isBakeableStillImageFile("clip.mp4")).toBe(false);
    expect(isBakeableStillImageFile("frame.gif")).toBe(false);
    expect(isBakeableStillImageFile("camera.arw")).toBe(false);
    expect(isBakeableStillImageFile("vector.svg")).toBe(false);
  });
});

describe("rotate still image file", () => {
  it("swaps the pixel size and leaves no temporary file", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "serpent-rotate-"));
    roots.push(root);
    const filePath = path.join(root, "wide.png");
    await sharp({
      create: {
        width: 3,
        height: 1,
        channels: 3,
        background: { b: 0, g: 0, r: 255 },
      },
    }).png().toFile(filePath);

    await rotateStillImageFile(filePath, "clockwise", () => {});

    const metadata = await sharp(filePath).metadata();
    expect(metadata.width).toBe(1);
    expect(metadata.height).toBe(3);
    expect(metadata.format).toBe("png");
  });
});
