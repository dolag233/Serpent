import type { ExtractedVideoMetadata } from "../shared/asset-types";

/** Parse ffprobe ratio strings like "30000/1001" or plain "30". */
export function parseFrameRateFps(
  framerate: string | null | undefined,
  frameRateFps?: number | null,
): number | null {
  if (typeof frameRateFps === "number" && Number.isFinite(frameRateFps) && frameRateFps > 0) {
    return frameRateFps;
  }
  if (!framerate) return null;
  const trimmed = framerate.trim();
  if (!trimmed) return null;
  const slash = trimmed.indexOf("/");
  if (slash >= 0) {
    const num = Number(trimmed.slice(0, slash));
    const den = Number(trimmed.slice(slash + 1));
    if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
    const fps = num / den;
    return fps > 0 && Number.isFinite(fps) ? fps : null;
  }
  const plain = Number(trimmed);
  return Number.isFinite(plain) && plain > 0 ? plain : null;
}

export function parseProbeNumber(
  value: string | number | null | undefined,
): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function formatFrameRate(fps: number): string {
  const rounded = Math.round(fps * 100) / 100;
  const text = Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(2).replace(/\.?0+$/u, "");
  return `${text} fps`;
}

export function formatBitrate(bitsPerSecond: number): string {
  if (bitsPerSecond >= 1_000_000) {
    const mbps = bitsPerSecond / 1_000_000;
    const text = mbps >= 10
      ? mbps.toFixed(0)
      : mbps.toFixed(1).replace(/\.0$/u, "");
    return `${text} Mbps`;
  }
  if (bitsPerSecond >= 1_000) {
    const kbps = bitsPerSecond / 1_000;
    const text = kbps >= 10
      ? kbps.toFixed(0)
      : kbps.toFixed(1).replace(/\.0$/u, "");
    return `${text} kbps`;
  }
  return `${Math.round(bitsPerSecond)} bps`;
}

export function formatSampleRate(hz: number): string {
  if (hz >= 1000) {
    const khz = hz / 1000;
    const text = Number.isInteger(khz)
      ? String(khz)
      : khz.toFixed(1).replace(/\.0$/u, "");
    return `${text} kHz`;
  }
  return `${Math.round(hz)} Hz`;
}

/**
 * Compact Inspector / chrome line, e.g.
 * `29.97 fps · 5.0 Mbps · h264 · aac 48 kHz`
 */
export function formatVideoTechnicalLine(
  metadata: ExtractedVideoMetadata,
): string | null {
  const parts: string[] = [];

  const fps = parseFrameRateFps(metadata.framerate, metadata.frameRateFps ?? null);
  if (fps !== null) parts.push(formatFrameRate(fps));

  const bitrate =
    parseProbeNumber(metadata.videoBitrate)
    ?? parseProbeNumber(metadata.containerBitrate ?? null);
  if (bitrate !== null) parts.push(formatBitrate(bitrate));

  if (metadata.videoCodec) parts.push(metadata.videoCodec);

  if (metadata.hasAudio && metadata.audioCodec) {
    const sampleRate = parseProbeNumber(metadata.sampleRate);
    parts.push(
      sampleRate !== null
        ? `${metadata.audioCodec} ${formatSampleRate(sampleRate)}`
        : metadata.audioCodec,
    );
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}
