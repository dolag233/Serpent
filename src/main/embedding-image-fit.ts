import { loadSharp } from '../shared/load-sharp';

const PASSTHROUGH_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const JPEG_QUALITIES = [85, 70, 55, 40] as const;
const MIN_EDGE_PX = 64;

export class SemanticImageLimitError extends Error {
  constructor() {
    super("Semantic image is still too large after resizing.");
    this.name = "SemanticImageLimitError";
  }
}

/** Minimal sharp surface for the semantic fit (injectable in tests). */
export interface SemanticImageSharpInstance {
  metadata(): Promise<{ width?: number; height?: number }>;
  rotate(): SemanticImageSharpInstance;
  resize(options: {
    width: number;
    height: number;
    fit: "inside";
    withoutEnlargement: true;
  }): SemanticImageSharpInstance;
  jpeg(options: { quality: number; mozjpeg?: boolean }): SemanticImageSharpInstance;
  toBuffer(): Promise<Buffer>;
}

export type SemanticImageSharpFactory = (input: Buffer) => SemanticImageSharpInstance;

function requireDefaultSharp(): SemanticImageSharpFactory {
  try {
    // Resolved from node_modules at runtime. vite.main.config.ts keeps this
    // external so the bundler does not try to parse the platform `.node`.
    const sharp = loadSharp() as SemanticImageSharpFactory & {
      cache?: (options: { files: number }) => void;
    };
    sharp.cache?.({ files: 0 });
    return sharp;
  } catch {
    // A missing or unloadable native binary must fail this image, not the process.
    throw new SemanticImageLimitError();
  }
}

/**
 * Fits one semantic image into the caller's edge and byte envelope.
 * A jpeg/png/webp already inside both limits is passed through.
 * Anything else is scaled inside the edge (never upscaled) and recompressed
 * as JPEG. If it still does not fit, or the bytes cannot be decoded, throws
 * {@link SemanticImageLimitError}.
 */
export async function fitSemanticImage(input: {
  bytes: Buffer;
  mimeType: string;
  maxEdgePx: number;
  maxBytes: number;
  sharpFn?: SemanticImageSharpFactory;
}): Promise<{ bytes: Buffer; mimeType: string }> {
  const sharpFn = input.sharpFn ?? requireDefaultSharp();
  const maxEdgePx = input.maxEdgePx;
  const maxBytes = input.maxBytes;
  if (maxEdgePx < MIN_EDGE_PX || maxBytes < 1) throw new SemanticImageLimitError();

  if (PASSTHROUGH_MIME_TYPES.has(input.mimeType) && input.bytes.length > 0 && input.bytes.length <= maxBytes) {
    try {
      const meta = await sharpFn(input.bytes).metadata();
      const width = meta.width ?? 0;
      const height = meta.height ?? 0;
      if (width > 0 && height > 0 && Math.max(width, height) <= maxEdgePx) {
        return { bytes: input.bytes, mimeType: input.mimeType };
      }
    } catch {
      // Metadata failed; try a decode-and-recompress below.
    }
  }

  let edge = maxEdgePx;
  while (edge >= MIN_EDGE_PX) {
    for (const quality of JPEG_QUALITIES) {
      let encoded: Buffer;
      try {
        encoded = await sharpFn(input.bytes)
          .rotate()
          .resize({
            width: edge,
            height: edge,
            fit: "inside",
            withoutEnlargement: true,
          })
          .jpeg({ quality, mozjpeg: true })
          .toBuffer();
      } catch {
        throw new SemanticImageLimitError();
      }
      if (encoded.length > 0 && encoded.length <= maxBytes) {
        return { bytes: encoded, mimeType: "image/jpeg" };
      }
    }
    const next = Math.floor(edge * 0.75);
    if (next >= edge) break;
    edge = next;
  }
  throw new SemanticImageLimitError();
}
