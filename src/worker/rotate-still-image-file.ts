import { renameSync, rmSync, statfsSync, statSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

import { isBakeableStillImageFile } from "../shared/bakeable-still-image";

const SPACE_MARGIN_BYTES = 1_048_576n;

export class ImageRotationWriteError extends Error {
  constructor(readonly reason: "insufficient-space" | "write-failed") {
    super(reason);
    this.name = "ImageRotationWriteError";
  }
}

/**
 * Rotate the pixels of a still image and replace the file in place.
 * The previous bytes stay aside until the replacement is in place.
 */
export async function rotateStillImageFile(
  absolutePath: string,
  direction: "clockwise" | "counter-clockwise",
  commit: () => void,
): Promise<void> {
  if (!isBakeableStillImageFile(absolutePath)) {
    throw new ImageRotationWriteError("write-failed");
  }
  const before = statSync(absolutePath);
  if (!before.isFile()) throw new ImageRotationWriteError("write-failed");
  const directory = path.dirname(absolutePath);
  const free = statfsSync(directory);
  const available = BigInt(free.bavail) * BigInt(free.bsize);
  if (available < BigInt(before.size) + SPACE_MARGIN_BYTES) {
    throw new ImageRotationWriteError("insufficient-space");
  }

  const extension = path.extname(absolutePath);
  const tempPath = path.join(
    directory,
    `.serpent-rotate-${process.pid}-${Date.now()}${extension}`,
  );
  const backupPath = path.join(
    directory,
    `.serpent-rotate-bak-${process.pid}-${Date.now()}${extension}`,
  );
  const angle = direction === "clockwise" ? 90 : -90;
  try {
    let pipeline = sharp(absolutePath, { failOn: "none" }).rotate(angle);
    const lower = extension.toLowerCase();
    if (lower === ".jpg" || lower === ".jpeg" || lower === ".jfif") {
      pipeline = pipeline.jpeg({ quality: 95 });
    } else if (lower === ".webp") {
      pipeline = pipeline.webp({ quality: 95 });
    } else if (lower === ".avif") {
      pipeline = pipeline.avif({ quality: 60 });
    }
    await pipeline.toFile(tempPath);
    renameSync(absolutePath, backupPath);
    try {
      renameSync(tempPath, absolutePath);
    } catch (error) {
      try {
        renameSync(backupPath, absolutePath);
      } catch {
        // The original is still at the backup path if this also fails.
      }
      throw error;
    }
    try {
      commit();
    } catch (error) {
      const displaced = `${absolutePath}.serpent-rotate-undo`;
      try {
        renameSync(absolutePath, displaced);
        renameSync(backupPath, absolutePath);
        rmSync(displaced, { force: true });
      } catch {
        // Leave the backup beside the new file if the undo rename fails.
      }
      throw error;
    }
    rmSync(backupPath, { force: true });
  } catch (error) {
    rmSync(tempPath, { force: true });
    if (error instanceof ImageRotationWriteError) throw error;
    throw new ImageRotationWriteError("write-failed");
  }
}
