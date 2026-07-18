/**
 * Pure helpers for audio asset detection (Serpent-0x5).
 * Worker `detectMediaType` and MIME maps stay the single runtime authority;
 * these helpers keep extension lists consistent across unit tests and call sites.
 */

export const AUDIO_EXTENSIONS = [
  ".wav",
  ".mp3",
  ".ogg",
  ".oga",
  ".m4a",
  ".aac",
  ".flac",
  ".opus",
] as const;

export const AUDIO_MIME_BY_EXTENSION: Record<
  (typeof AUDIO_EXTENSIONS)[number],
  string
> = {
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".opus": "audio/ogg",
};

export function isAudioFileName(filenameOrMime: string): boolean {
  const lower = filenameOrMime.toLowerCase();
  return AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function audioMimeForExtension(extension: string): string | null {
  const key = extension.toLowerCase() as (typeof AUDIO_EXTENSIONS)[number];
  return AUDIO_MIME_BY_EXTENSION[key] ?? null;
}
