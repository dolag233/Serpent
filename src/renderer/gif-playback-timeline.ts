/**
 * GIF timeline for the viewer transport. Delays follow the browser rule:
 * a graphic-control delay under 2 centiseconds plays as 100ms.
 */

export const GIF_BROWSER_MIN_DELAY_MS = 100;

export type GifFrameTiming = {
  durationMs: number;
};

export function gifDelayFromCentiseconds(centiseconds: number): number {
  if (!Number.isFinite(centiseconds) || centiseconds < 2) {
    return GIF_BROWSER_MIN_DELAY_MS;
  }
  return Math.round(centiseconds * 10);
}

export function gifTimelineDurationMs(
  frames: readonly GifFrameTiming[],
): number {
  let total = 0;
  for (const frame of frames) total += frame.durationMs;
  return total;
}

/** Time at or past the end stays on the last frame. Playback wraps first. */
export function gifFrameIndexAtTime(
  frames: readonly GifFrameTiming[],
  timeMs: number,
): number {
  if (frames.length === 0) return 0;
  const duration = gifTimelineDurationMs(frames);
  if (duration <= 0) return 0;
  const time = Number.isFinite(timeMs) ? Math.max(0, timeMs) : 0;
  if (time >= duration) return frames.length - 1;
  let cursor = 0;
  for (let index = 0; index < frames.length; index += 1) {
    cursor += frames[index]!.durationMs;
    if (time < cursor) return index;
  }
  return frames.length - 1;
}

export function gifTimeAtFrameStart(
  frames: readonly GifFrameTiming[],
  index: number,
): number {
  if (frames.length === 0) return 0;
  const clamped = Math.min(
    frames.length - 1,
    Math.max(0, Math.floor(index)),
  );
  let time = 0;
  for (let i = 0; i < clamped; i += 1) time += frames[i]!.durationMs;
  return time;
}

/** Frame step clamps at the ends, matching video D/F. */
export function gifAdjacentFrameIndex(
  frameCount: number,
  index: number,
  direction: 1 | -1,
): number {
  if (frameCount <= 0) return 0;
  const current = Math.min(frameCount - 1, Math.max(0, Math.floor(index)));
  return Math.min(frameCount - 1, Math.max(0, current + direction));
}

export function gifWrapPlaybackTimeMs(
  timeMs: number,
  durationMs: number,
): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;
  if (!Number.isFinite(timeMs)) return 0;
  const wrapped = timeMs % durationMs;
  return wrapped < 0 ? wrapped + durationMs : wrapped;
}

export type GifFrameTimings = {
  delaysMs: number[];
};

/**
 * Read per-frame delays from a GIF buffer without decoding pixels.
 * Returns null when the header or a block length is not a GIF.
 */
export function readGifFrameTimings(bytes: Uint8Array): GifFrameTimings | null {
  if (bytes.length < 13) return null;
  const header = String.fromCharCode(...bytes.subarray(0, 6));
  if (header !== "GIF87a" && header !== "GIF89a") return null;
  let offset = 13;
  const packed = bytes[10] ?? 0;
  if ((packed & 0x80) !== 0) {
    const colorCount = 2 ** ((packed & 0x07) + 1);
    offset += colorCount * 3;
  }
  if (offset > bytes.length) return null;

  const delaysMs: number[] = [];
  let pendingDelayMs: number | null = null;

  while (offset < bytes.length) {
    const introducer = bytes[offset];
    if (introducer === 0x3b) break;
    if (introducer === 0x21) {
      const label = bytes[offset + 1];
      if (label === 0xf9) {
        const blockSize = bytes[offset + 2];
        if (blockSize !== 4 || offset + 8 > bytes.length) return null;
        const centiseconds = (bytes[offset + 4] ?? 0) | ((bytes[offset + 5] ?? 0) << 8);
        pendingDelayMs = gifDelayFromCentiseconds(centiseconds);
        offset += 8;
        continue;
      }
      const next = skipSubBlocks(bytes, offset + 2);
      if (next < 0) return null;
      offset = next;
      continue;
    }
    if (introducer === 0x2c) {
      if (offset + 10 > bytes.length) return null;
      const imagePacked = bytes[offset + 9] ?? 0;
      offset += 10;
      if ((imagePacked & 0x80) !== 0) {
        const colorCount = 2 ** ((imagePacked & 0x07) + 1);
        offset += colorCount * 3;
      }
      if (offset >= bytes.length) return null;
      offset += 1;
      const next = skipSubBlocks(bytes, offset);
      if (next < 0) return null;
      delaysMs.push(pendingDelayMs ?? GIF_BROWSER_MIN_DELAY_MS);
      pendingDelayMs = null;
      offset = next;
      continue;
    }
    return null;
  }

  return { delaysMs };
}

export function gifPlaybackFrames(
  parsed: GifFrameTimings | null,
  frameCount: number,
): GifFrameTiming[] {
  const count = Math.max(0, Math.floor(frameCount));
  const frames: GifFrameTiming[] = [];
  for (let index = 0; index < count; index += 1) {
    const parsedDelay = parsed?.delaysMs[index];
    frames.push({
      durationMs:
        typeof parsedDelay === "number" && parsedDelay > 0
          ? parsedDelay
          : GIF_BROWSER_MIN_DELAY_MS,
    });
  }
  return frames;
}

function skipSubBlocks(bytes: Uint8Array, offset: number): number {
  let cursor = offset;
  while (cursor < bytes.length) {
    const size = bytes[cursor] ?? 0;
    cursor += 1;
    if (size === 0) return cursor;
    cursor += size;
    if (cursor > bytes.length) return -1;
  }
  return -1;
}
