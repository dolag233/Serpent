import { JPEG_IMAGE_EXTENSIONS } from "./media-formats";

/**
 * Bounded source-direct policy for card previews.
 *
 * This is a presentation-route optimization, not an asset acceptance gate:
 * larger or higher-resolution local sources continue through the native
 * thumbnail pipeline and are never rejected because of these thresholds.
 */

export const SOURCE_DIRECT_MAX_LONG_EDGE_PX = 2048;
export const SOURCE_DIRECT_MAX_PIXELS = 2_000_000;
export const SOURCE_DIRECT_MAX_BYTES = 2 * 1024 * 1024;

export const SOURCE_DIRECT_IMAGE_EXTENSIONS = [
  ...JPEG_IMAGE_EXTENSIONS,
  ".png",
  ".webp",
  ".avif",
  ".gif",
] as const;

const SOURCE_DIRECT_EXTENSIONS = new Set<string>(SOURCE_DIRECT_IMAGE_EXTENSIONS);

function extensionFor(fileName: string): string {
  const lower = fileName.toLowerCase();
  const dot = lower.lastIndexOf(".");
  return dot >= 0 ? lower.slice(dot) : "";
}

export type SourceDirectPreviewInput = Readonly<{
  fileName: string;
  mediaType: "image" | "video" | "audio" | "text" | "model" | "document" | "font" | "other";
  byteSize: number;
  width: number | null | undefined;
  height: number | null | undefined;
}>;

/** Cheap eligibility check before a bounded header probe. */
export function isSourceDirectPreviewCandidate(
  input: Pick<SourceDirectPreviewInput, "fileName" | "mediaType" | "byteSize">,
): boolean {
  return input.mediaType === "image"
    && SOURCE_DIRECT_EXTENSIONS.has(extensionFor(input.fileName))
    && Number.isSafeInteger(input.byteSize)
    && input.byteSize > 0
    && input.byteSize <= SOURCE_DIRECT_MAX_BYTES;
}

/**
 * Return true only when the original can be mounted as a bounded card image.
 * Larger sources use the native thumbnail route; they remain valid assets.
 */
export function isSourceDirectPreview(
  input: SourceDirectPreviewInput,
): boolean {
  if (!isSourceDirectPreviewCandidate(input)) return false;
  if (
    typeof input.width !== "number"
    || typeof input.height !== "number"
    || !Number.isSafeInteger(input.width)
    || !Number.isSafeInteger(input.height)
  ) {
    return false;
  }
  if (input.width <= 0 || input.height <= 0) return false;
  if (Math.max(input.width, input.height) > SOURCE_DIRECT_MAX_LONG_EDGE_PX) return false;
  return input.width * input.height <= SOURCE_DIRECT_MAX_PIXELS;
}
