/**
 * Native media decoders allocate outside the V8 heap. A queue semaphore limits
 * work count, but it does not account for a 16 MP image and a video frame
 * buffer having very different native footprints. Keep one process-wide byte
 * budget so Sharp, OIIO and FFmpeg cannot each spend their own independent
 * concurrency allowance at the same time.
 *
 * The budget is an admission estimate, not an OS cgroup. The production
 * benchmark samples the Worker and child-process RSS separately; this gate is
 * the deterministic protection used before a native decoder starts.
 */

const BYTES_PER_RGBA_PIXEL = 4;
const MIN_RESERVATION_BYTES = 8 * 1024 * 1024;
const UNKNOWN_SHARP_BYTES = 64 * 1024 * 1024;
const UNKNOWN_FFMPEG_BYTES = 128 * 1024 * 1024;
const UNKNOWN_OIIO_BYTES = 192 * 1024 * 1024;
const SOURCE_STAGING_BYTES_CAP = 32 * 1024 * 1024;
const DECODER_OVERHEAD_BYTES = 16 * 1024 * 1024;

/** Shared native-decode admission budget for one Library Worker process. */
export const MEDIA_NATIVE_MEMORY_BUDGET_BYTES = 384 * 1024 * 1024;
/** Common maximum raster size for generated previews, including OIIO output. */
export const MEDIA_MAX_INPUT_PIXELS = 64_000_000;
/** Unknown-dimension OIIO cards above this size are rejected before decoding. */
export const MEDIA_MAX_UNKNOWN_OIIO_SOURCE_BYTES = 512 * 1024 * 1024;
export const MEDIA_INPUT_TOO_LARGE_ERROR_CODE = 'MEDIA_INPUT_TOO_LARGE';

export type MediaNativeDecoder = 'sharp' | 'oiio' | 'ffmpeg';

export interface MediaNativeMemoryEstimate {
  decoder: MediaNativeDecoder;
  sourceByteSize?: number | null;
  width?: number | null;
  height?: number | null;
}

/** A decoder input was rejected before native allocation could begin. */
export class MediaInputTooLargeError extends Error {
  readonly code = MEDIA_INPUT_TOO_LARGE_ERROR_CODE;

  constructor(message: string) {
    super(message);
    this.name = 'MediaInputTooLargeError';
  }
}

function positiveSafeInteger(value: number | null | undefined): number | undefined {
  return Number.isSafeInteger(value) && value! > 0 ? value! : undefined;
}

function unknownReservation(decoder: MediaNativeDecoder): number {
  switch (decoder) {
    case 'oiio':
      return UNKNOWN_OIIO_BYTES;
    case 'ffmpeg':
      return UNKNOWN_FFMPEG_BYTES;
    case 'sharp':
      return UNKNOWN_SHARP_BYTES;
  }
}

/**
 * Estimate the native footprint before starting a decoder. The source file is
 * capped in the estimate because compressed bytes are streamed by the native
 * libraries; decoded RGBA pixels are the dominant predictable allocation.
 */
export function estimateMediaNativeMemoryBytes(input: MediaNativeMemoryEstimate): number {
  const width = positiveSafeInteger(input.width);
  const height = positiveSafeInteger(input.height);
  const sourceBytes = positiveSafeInteger(input.sourceByteSize);
  if (width === undefined || height === undefined || width > Number.MAX_SAFE_INTEGER / height) {
    return Math.min(MEDIA_NATIVE_MEMORY_BUDGET_BYTES, unknownReservation(input.decoder));
  }

  const pixelBytes = width * height * BYTES_PER_RGBA_PIXEL;
  const stagedSourceBytes = Math.min(sourceBytes ?? 0, SOURCE_STAGING_BYTES_CAP);
  const estimate = pixelBytes + stagedSourceBytes + DECODER_OVERHEAD_BYTES;
  return Math.min(
    MEDIA_NATIVE_MEMORY_BUDGET_BYTES,
    Math.max(MIN_RESERVATION_BYTES, estimate),
  );
}

export class MediaNativeMemoryBudget {
  private inUseBytes = 0;
  private peakBytes = 0;
  private readonly capacityBytes: number;
  private readonly waiting: Array<{
    bytes: number;
    resolve: (release: () => void) => void;
    reject: (error: unknown) => void;
    signal?: AbortSignal;
    abort?: () => void;
  }> = [];

  constructor(capacityBytes = MEDIA_NATIVE_MEMORY_BUDGET_BYTES) {
    this.capacityBytes = Math.max(
      MIN_RESERVATION_BYTES,
      Number.isFinite(capacityBytes) ? Math.trunc(capacityBytes) : MEDIA_NATIVE_MEMORY_BUDGET_BYTES,
    );
  }

  get usedBytes(): number {
    return this.inUseBytes;
  }

  get peakUsedBytes(): number {
    return this.peakBytes;
  }

  async run<T>(
    signal: AbortSignal | undefined,
    requestedBytes: number,
    task: () => Promise<T>,
  ): Promise<T> {
    const normalizedRequestedBytes = Number.isFinite(requestedBytes) && requestedBytes > 0
      ? requestedBytes
      : MIN_RESERVATION_BYTES;
    const bytes = Math.min(
      this.capacityBytes,
      Math.max(MIN_RESERVATION_BYTES, Math.trunc(normalizedRequestedBytes)),
    );
    const release = await this.acquire(signal, bytes);
    try {
      if (signal?.aborted) throw new DOMException('Media job cancelled.', 'AbortError');
      return await task();
    } finally {
      release();
    }
  }

  private acquire(signal: AbortSignal | undefined, bytes: number): Promise<() => void> {
    if (signal?.aborted) {
      return Promise.reject(new DOMException('Media job cancelled.', 'AbortError'));
    }
    if (this.canFit(bytes) && this.waiting.length === 0) {
      return Promise.resolve(this.reserve(bytes));
    }
    return new Promise((resolve, reject) => {
      const waiter: {
        bytes: number;
        resolve: (release: () => void) => void;
        reject: (error: unknown) => void;
        signal?: AbortSignal;
        abort?: () => void;
      } = { bytes, resolve, reject, signal };
      if (signal) {
        waiter.abort = () => {
          const index = this.waiting.indexOf(waiter);
          if (index >= 0) this.waiting.splice(index, 1);
          this.drainWaiters();
          reject(new DOMException('Media job cancelled while waiting for native memory.', 'AbortError'));
        };
        signal.addEventListener('abort', waiter.abort, { once: true });
      }
      this.waiting.push(waiter);
      this.drainWaiters();
    });
  }

  private canFit(bytes: number): boolean {
    return this.inUseBytes + bytes <= this.capacityBytes;
  }

  private reserve(bytes: number): () => void {
    this.inUseBytes += bytes;
    this.peakBytes = Math.max(this.peakBytes, this.inUseBytes);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.inUseBytes = Math.max(0, this.inUseBytes - bytes);
      this.drainWaiters();
    };
  }

  private drainWaiters(): void {
    while (this.waiting.length > 0) {
      const waiter = this.waiting[0]!;
      if (waiter.signal?.aborted) {
        this.waiting.shift();
        waiter.signal.removeEventListener('abort', waiter.abort!);
        waiter.reject(new DOMException('Media job cancelled while waiting for native memory.', 'AbortError'));
        continue;
      }
      if (!this.canFit(waiter.bytes)) return;
      this.waiting.shift();
      waiter.signal?.removeEventListener('abort', waiter.abort!);
      waiter.resolve(this.reserve(waiter.bytes));
    }
  }
}

/** One budget shared by every open library in the Worker process. */
export const mediaNativeMemoryBudget = new MediaNativeMemoryBudget();
