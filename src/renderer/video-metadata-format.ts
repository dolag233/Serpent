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

/**
 * Compact Inspector line for audio assets (Serpent-i07), e.g.
 * `mp3 · 320 kbps · 44.1 kHz · stereo`
 */
export function formatAudioTechnicalLine(
  metadata: ExtractedVideoMetadata,
): string | null {
  const parts: string[] = [];

  const bitrate =
    parseProbeNumber(metadata.audioBitrate ?? null)
    ?? parseProbeNumber(metadata.containerBitrate ?? null);
  if (bitrate !== null) parts.push(formatBitrate(bitrate));

  const sampleRate = parseProbeNumber(metadata.sampleRate);
  if (sampleRate !== null) parts.push(formatSampleRate(sampleRate));

  if (metadata.channels != null && metadata.channels > 0) {
    if (metadata.channels === 1) parts.push("mono");
    else if (metadata.channels === 2) parts.push("stereo");
    else parts.push(`${metadata.channels} ch`);
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}

export type EmbeddedMetadataField =
  | "title"
  | "artist"
  | "album"
  | "albumArtist"
  | "trackNumber"
  | "discNumber"
  | "genre"
  | "composer"
  | "date"
  | "comment"
  | "copyright"
  | "custom";

export interface EmbeddedMetadataRow {
  field: EmbeddedMetadataField;
  value: string;
  /** Original tag name for custom fields; standard fields have no key. */
  key?: string;
}

function addEmbeddedMetadataRow(
  rows: EmbeddedMetadataRow[],
  field: EmbeddedMetadataField,
  value: string | null | undefined,
): void {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (normalized) rows.push({ field, value: normalized });
}

/**
 * Build the field/value rows used by the Inspector for embedded tags.
 *
 * Keeping these rows separate from the compact codec line makes audio/video
 * metadata read the same way as the ARW/EXIF details below it and avoids
 * losing the field name when several tags happen to share similar values.
 */
export function buildEmbeddedMetadataRows(
  metadata: Pick<
    ExtractedVideoMetadata,
    | "title"
    | "artist"
    | "album"
    | "albumArtist"
    | "trackNumber"
    | "discNumber"
    | "genre"
    | "composer"
    | "comment"
    | "copyright"
    | "date"
    | "customTags"
  >,
): EmbeddedMetadataRow[] {
  const rows: EmbeddedMetadataRow[] = [];
  addEmbeddedMetadataRow(rows, "title", metadata.title);
  addEmbeddedMetadataRow(rows, "artist", metadata.artist);
  addEmbeddedMetadataRow(rows, "album", metadata.album);
  addEmbeddedMetadataRow(rows, "albumArtist", metadata.albumArtist);
  addEmbeddedMetadataRow(rows, "trackNumber", metadata.trackNumber);
  addEmbeddedMetadataRow(rows, "discNumber", metadata.discNumber);
  addEmbeddedMetadataRow(rows, "genre", metadata.genre);
  addEmbeddedMetadataRow(rows, "composer", metadata.composer);
  addEmbeddedMetadataRow(rows, "date", metadata.date);
  addEmbeddedMetadataRow(rows, "comment", metadata.comment);
  addEmbeddedMetadataRow(rows, "copyright", metadata.copyright);
  for (const tag of metadata.customTags ?? []) {
    const key = tag.key.trim();
    const value = tag.value.trim();
    if (key && value) rows.push({ field: "custom", key, value });
  }
  return rows;
}

/** Compact human-readable line for standard embedded audio/video tags. */
export function formatEmbeddedMetadataLine(
  metadata: Pick<
    ExtractedVideoMetadata,
    | "title"
    | "artist"
    | "album"
    | "albumArtist"
    | "trackNumber"
    | "discNumber"
    | "genre"
    | "composer"
    | "comment"
    | "copyright"
    | "date"
    | "customTags"
  >,
): string | null {
  const parts: string[] = [];
  if (metadata.title) parts.push(metadata.title);
  if (metadata.artist) parts.push(metadata.artist);
  if (metadata.album) parts.push(metadata.album);
  if (metadata.albumArtist && metadata.albumArtist !== metadata.artist) parts.push(metadata.albumArtist);
  if (metadata.trackNumber) parts.push(`#${metadata.trackNumber}`);
  if (metadata.discNumber) parts.push(`disc ${metadata.discNumber}`);
  if (metadata.genre) parts.push(metadata.genre);
  if (metadata.composer) parts.push(metadata.composer);
  if (metadata.date) parts.push(metadata.date);
  if (metadata.comment) parts.push(metadata.comment);
  if (metadata.copyright) parts.push(metadata.copyright);
  for (const tag of metadata.customTags ?? []) {
    if (tag.key && tag.value) parts.push(`${tag.key}: ${tag.value}`);
  }
  if (parts.length === 0) return null;
  const line = parts.join(" · ");
  return line.length > 1200 ? `${line.slice(0, 1197)}…` : line;
}
