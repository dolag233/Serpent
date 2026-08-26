/**
 * Best-effort camera metadata extraction for RAW/image Inspector details.
 *
 * The Worker owns the source path and the parser call. Only a bounded,
 * normalized allow-list leaves this module, so arbitrary EXIF keys and local
 * paths never cross the Renderer boundary.
 */

const MAX_METADATA_TEXT_LENGTH = 255;

export interface RawImageMetadataParser {
  parse(input: string, options: Record<string, unknown>): Promise<unknown>;
}

export interface RawImageMetadata {
  width: number | null;
  height: number | null;
  captureDate: string | null;
  author: string | null;
  cameraMake: string | null;
  cameraModel: string | null;
  lensModel: string | null;
  iso: number | string | null;
  fNumber: number | string | null;
  exposureTime: number | string | null;
  exposureCompensation: number | string | null;
  exposureProgram: number | string | null;
  meteringMode: number | string | null;
  flash: number | string | null;
  focalLength: number | string | null;
}

export type RawImageMetadataExtractionResult =
  | { status: 'metadata'; metadata: RawImageMetadata }
  | { status: 'empty' }
  | { status: 'failed'; error: unknown };

let exifrModule: RawImageMetadataParser | undefined;

function requireExifr(): RawImageMetadataParser {
  if (!exifrModule) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      exifrModule = require('exifr') as RawImageMetadataParser;
    } catch (error) {
      throw new Error(`exifr module unavailable: ${String(error)}`, { cause: error });
    }
  }
  return exifrModule;
}

function firstValue(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      const first = value.find((item) => item !== null && item !== undefined);
      if (first !== undefined) return first;
    } else if (value !== null && value !== undefined) {
      return value;
    }
  }
  return null;
}

function boundedText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? ' ' : character;
  }).join('').trim();
  return normalized ? normalized.slice(0, MAX_METADATA_TEXT_LENGTH) : null;
}

function numeric(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function scalar(value: unknown): number | string | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  return boundedText(value);
}

function metadataDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return value.toISOString();
  }
  const text = boundedText(value);
  if (!text) return null;
  // EXIF commonly uses `YYYY:MM:DD HH:mm:ss`, which is not parsed by every
  // Chromium/Node runtime. Normalize only the date separators and preserve
  // the original text if it still cannot be parsed.
  const normalized = text.replace(
    /^(\d{4}):(\d{2}):(\d{2})(?=\s|$)/u,
    '$1-$2-$3',
  );
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.valueOf()) ? text : parsed.toISOString();
}

export function normalizeRawImageMetadata(output: unknown): RawImageMetadata {
  const record = output && typeof output === 'object'
    ? output as Record<string, unknown>
    : {};
  return {
    width: numeric(firstValue(record, [
      'ExifImageWidth',
      'ImageWidth',
      'PixelXDimension',
    ])),
    height: numeric(firstValue(record, [
      'ExifImageHeight',
      'ImageHeight',
      'PixelYDimension',
    ])),
    captureDate: metadataDate(firstValue(record, [
      'DateTimeOriginal',
      'CreateDate',
      'DateTimeDigitized',
    ])),
    author: boundedText(firstValue(record, [
      'creator',
      'Creator',
      'Byline',
      'By-line',
      'Artist',
    ])),
    cameraMake: boundedText(firstValue(record, ['Make', 'CameraMake'])),
    cameraModel: boundedText(firstValue(record, ['Model', 'CameraModel'])),
    lensModel: boundedText(firstValue(record, [
      'LensModel',
      'Lens',
      'LensSpecification',
    ])),
    iso: scalar(firstValue(record, [
      'ISO',
      'ISOSpeedRatings',
      'PhotographicSensitivity',
    ])),
    fNumber: scalar(firstValue(record, ['FNumber', 'ApertureValue'])),
    exposureTime: scalar(firstValue(record, [
      'ExposureTime',
      'ShutterSpeedValue',
    ])),
    exposureCompensation: scalar(firstValue(record, [
      'ExposureCompensation',
      'ExposureBiasValue',
    ])),
    exposureProgram: scalar(firstValue(record, ['ExposureProgram'])),
    meteringMode: scalar(firstValue(record, ['MeteringMode'])),
    flash: scalar(firstValue(record, ['Flash'])),
    focalLength: scalar(firstValue(record, ['FocalLength'])),
  };
}

export function hasRawImageMetadata(metadata: RawImageMetadata): boolean {
  return Object.values(metadata).some((value) => value !== null);
}

function abortError(): DOMException {
  return new DOMException('RAW metadata extraction cancelled.', 'AbortError');
}

/**
 * Race the parser against queue cancellation while still attaching handlers to
 * the parser promise. exifr does not expose an AbortSignal, so this cannot
 * interrupt a synchronous decoder internally; it does release the queue lease
 * and lets the scheduler move on as soon as the parser yields. The late parser
 * result is deliberately ignored by the caller and can never be persisted.
 */
async function parseWithCancellation(
  absoluteFilePath: string,
  parser: RawImageMetadataParser,
  signal?: AbortSignal,
): Promise<unknown> {
  if (signal?.aborted) throw abortError();
  const parsePromise = Promise.resolve().then(() => parser.parse(absoluteFilePath, {
    tiff: true,
    exif: true,
    iptc: true,
    xmp: true,
  }));
  if (!signal) return parsePromise;

  return new Promise<unknown>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    void parsePromise.then(
      (output) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(output);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      },
    );
  });
}

export async function extractRawImageMetadataDetailed(
  absoluteFilePath: string,
  parser: RawImageMetadataParser = requireExifr(),
  signal?: AbortSignal,
): Promise<RawImageMetadataExtractionResult> {
  try {
    const output = await parseWithCancellation(absoluteFilePath, parser, signal);
    const metadata = normalizeRawImageMetadata(output);
    return hasRawImageMetadata(metadata)
      ? { status: 'metadata', metadata }
      : { status: 'empty' };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    return { status: 'failed', error };
  }
}

export async function extractRawImageMetadata(
  absoluteFilePath: string,
  parser: RawImageMetadataParser = requireExifr(),
): Promise<RawImageMetadata | null> {
  const result = await extractRawImageMetadataDetailed(absoluteFilePath, parser);
  return result.status === 'metadata' ? result.metadata : null;
}
