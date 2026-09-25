/**
 * On-demand composited GIF frames via Chromium ImageDecoder.
 * The viewer keeps a small bitmap cache so scrubbing does not decode the
 * whole animation up front.
 */

const GIF_FRAME_CACHE_LIMIT = 24;

interface DecoderVideoFrame {
  close(): void;
  displayWidth?: number;
  displayHeight?: number;
}

interface GifImageDecoder {
  close(): void;
  decode(options: { frameIndex: number }): Promise<{ image: DecoderVideoFrame }>;
  tracks: {
    ready: Promise<void>;
    selectedTrack: { frameCount: number } | null;
  };
}

type ImageDecoderCtor = new (init: {
  data: BufferSource;
  type: string;
}) => GifImageDecoder;

export class GifFrameSource {
  private readonly cache = new Map<number, ImageBitmap>();
  private readonly pending = new Map<number, Promise<ImageBitmap>>();
  private closed = false;

  constructor(
    private readonly decoder: GifImageDecoder,
    readonly frameCount: number,
  ) {}

  async bitmap(index: number): Promise<ImageBitmap> {
    if (this.closed) throw new Error("closed");
    const clamped = Math.min(this.frameCount - 1, Math.max(0, index));
    const cached = this.cache.get(clamped);
    if (cached) return cached;
    let job = this.pending.get(clamped);
    if (!job) {
      job = this.decode(clamped);
      this.pending.set(clamped, job);
    }
    return job;
  }

  close(): void {
    this.closed = true;
    for (const bitmap of this.cache.values()) bitmap.close();
    this.cache.clear();
    this.pending.clear();
    this.decoder.close();
  }

  private async decode(index: number): Promise<ImageBitmap> {
    const { image } = await this.decoder.decode({ frameIndex: index });
    try {
      const bitmap = await createImageBitmap(image as CanvasImageSource);
      if (this.closed) {
        bitmap.close();
        throw new Error("closed");
      }
      this.cache.set(index, bitmap);
      this.evict(index);
      return bitmap;
    } finally {
      image.close();
      this.pending.delete(index);
    }
  }

  private evict(current: number): void {
    if (this.cache.size <= GIF_FRAME_CACHE_LIMIT) return;
    const ranked = [...this.cache.keys()].sort(
      (left, right) => Math.abs(right - current) - Math.abs(left - current),
    );
    for (const key of ranked) {
      if (this.cache.size <= GIF_FRAME_CACHE_LIMIT) break;
      if (key === current) continue;
      this.cache.get(key)?.close();
      this.cache.delete(key);
    }
  }
}

export async function openGifFrameSource(
  data: BufferSource,
): Promise<GifFrameSource> {
  const ctor = (globalThis as { ImageDecoder?: ImageDecoderCtor }).ImageDecoder;
  if (!ctor) throw new Error("GIF_DECODER_UNAVAILABLE");
  const decoder = new ctor({ data, type: "image/gif" });
  try {
    await decoder.tracks.ready;
    const frameCount = decoder.tracks.selectedTrack?.frameCount ?? 0;
    if (frameCount <= 0) throw new Error("GIF_NO_FRAMES");
    return new GifFrameSource(decoder, frameCount);
  } catch (error) {
    decoder.close();
    throw error;
  }
}
