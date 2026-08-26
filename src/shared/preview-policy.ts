/**
 * Bounded source-direct policy for card previews.
 *
 * The source path is only safe for small, browser-native raster images. The
 * dimensions and byte limit are part of the policy so a large source image
 * cannot accidentally bypass the derived-thumbnail memory budget.
 */

export const SOURCE_DIRECT_MAX_LONG_EDGE_PX = 2048;
// A 2048px square can decode to more than 16 MiB before the browser paints
// it. Keep the card path below a bounded decoded-pixel budget; the viewer's
// explicit source route remains full fidelity.
export const SOURCE_DIRECT_MAX_PIXELS = 2_000_000;
// Keep card source reads below the cost of decoding a multi-megabyte PNG/JPEG
// in every visible card. Larger native images still use the bounded thumbnail
// lane; the viewer's explicit source route remains full fidelity.
export const SOURCE_DIRECT_MAX_BYTES = 1 * 1024 * 1024;

const SOURCE_DIRECT_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
]);

function extensionFor(fileName: string): string {
  const lower = fileName.toLowerCase();
  const dot = lower.lastIndexOf(".");
  return dot >= 0 ? lower.slice(dot) : "";
}

export type SourceDirectPreviewInput = Readonly<{
  fileName: string;
  mediaType: "image" | "video" | "audio" | "text" | "model" | "document" | "other";
  byteSize: number;
  width: number | null | undefined;
  height: number | null | undefined;
}>;

/**
 * Return true only when the original can be mounted as a bounded card image.
 * Unknown dimensions deliberately return false; the Worker must probe them
 * before admitting a source-direct candidate.
 */
export function isSourceDirectPreview(
  input: SourceDirectPreviewInput,
): boolean {
  if (input.mediaType !== "image") return false;
  if (!SOURCE_DIRECT_EXTENSIONS.has(extensionFor(input.fileName))) return false;
  if (!Number.isSafeInteger(input.byteSize) || input.byteSize <= 0) return false;
  if (input.byteSize > SOURCE_DIRECT_MAX_BYTES) return false;
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
