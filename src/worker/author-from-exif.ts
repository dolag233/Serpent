/**
 * Best-effort author/creator extraction from an image's embedded EXIF,
 * IPTC, and XMP metadata (Serpent-7x0).
 *
 * This module only reads file bytes already resolved by the Worker (the
 * sole owner of filesystem access, per ADR process invariants); it never
 * receives or resolves arbitrary Renderer-supplied paths itself.
 *
 * Precedence: XMP `dc:creator` > IPTC By-line/Creator > EXIF `Artist`. The
 * modern XMP field is treated as most authoritative (it is what current
 * creative tools write on export); EXIF `Artist` is a legacy fallback that
 * predates IPTC/XMP adoption.
 */

const MAX_AUTHOR_LENGTH = 255;

export interface ExifParser {
  parse(input: string, options: Record<string, unknown>): Promise<unknown>;
}

let exifrModule: ExifParser | undefined;
function requireExifr(): ExifParser {
  if (!exifrModule) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      exifrModule = require('exifr') as ExifParser;
    } catch (error) {
      throw new Error(`exifr module unavailable: ${String(error)}`, { cause: error });
    }
  }
  return exifrModule;
}

/**
 * Extract an author string from an image file's EXIF/IPTC/XMP metadata.
 * Returns null when no candidate field is present, the file cannot be
 * parsed, or the parser throws — this is a best-effort enrichment, never a
 * hard dependency of thumbnail generation or import.
 */
export async function extractAuthorFromExif(
  absoluteFilePath: string,
  parser: ExifParser = requireExifr(),
): Promise<string | null> {
  let output: unknown;
  try {
    output = await parser.parse(absoluteFilePath, {
      tiff: true,
      exif: true,
      iptc: true,
      xmp: true,
    });
  } catch {
    return null;
  }
  if (!output || typeof output !== 'object') return null;
  const record = output as Record<string, unknown>;

  const candidate =
    firstNonEmptyString(record.creator) ??
    firstNonEmptyString(record.Creator) ??
    firstNonEmptyString(record.Byline) ??
    firstNonEmptyString(record['By-line']) ??
    firstNonEmptyString(record.Artist);

  return candidate ? candidate.slice(0, MAX_AUTHOR_LENGTH) : null;
}

/** Unwrap exifr's string | string[] union (XMP array-valued fields) to the first non-blank entry. */
function firstNonEmptyString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = firstNonEmptyString(item);
      if (nested) return nested;
    }
  }
  return null;
}
