const IMAGE_SEQUENCE_EXTENSIONS = new Set([
  ".avif",
  ".bmp",
  ".exr",
  ".gif",
  ".heic",
  ".heif",
  ".jpeg",
  ".jpg",
  ".png",
  ".psd",
  ".tga",
  ".tif",
  ".tiff",
  ".webp",
]);

/** Default playback rate for auto-detected and import-confirmed sequences. */
export const DEFAULT_IMAGE_SEQUENCE_FPS = 30;

/**
 * How the frame number is written in the basename (before the extension).
 *
 * - trailing: `shot_001.png`, `shot.0001.exr`, `001.png`, `clip_0.png`
 * - parens:   `shot(1).png`, `shot_(001).png`, `photo (12).jpg`
 *
 * Common VFX forms (`name.####.ext` / `name_####.ext`) are trailing.
 * Windows/camera exports often use `(n)`.
 */
export type ImageSequenceNumberStyle = "trailing" | "parens";

export interface ImageSequenceCandidate {
  extension: string;
  frames: ImageSequenceFrameCandidate[];
  numberStyle: ImageSequenceNumberStyle;
  /** Digit width for zero-padded runs; 0 means unpadded / variable width. */
  numericWidth: number;
  prefix: string;
}

export interface ImageSequenceFrameCandidate {
  frameNumber: number;
  name: string;
  numberStyle: ImageSequenceNumberStyle;
  numericWidth: number;
  value: string;
}

export interface ParsedImageSequenceName {
  extension: string;
  frameNumber: number;
  numberStyle: ImageSequenceNumberStyle;
  /** Raw digit width key: fixed when zero-padded, else 0 (variable). */
  numericWidth: number;
  prefix: string;
}

const TRAILING_FRAME_PATTERN = /^(.*?)(\d+)$/u;
const PARENS_FRAME_PATTERN = /^(.*)\((\d+)\)$/u;

function isZeroPaddedDigits(digits: string): boolean {
  return digits.length > 1 && digits.startsWith("0");
}

/**
 * Parse a basename or relative path into sequence numbering parts.
 * Returns null when the file is not a supported image or has no frame index.
 */
export function parseImageSequenceFileName(
  value: string,
): ParsedImageSequenceName | null {
  const name = value.replaceAll("\\", "/").split("/").at(-1) ?? "";
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return null;
  const extension = name.slice(dot).toLocaleLowerCase("en-US");
  if (!IMAGE_SEQUENCE_EXTENSIONS.has(extension)) return null;
  const stem = name.slice(0, dot);

  const parens = PARENS_FRAME_PATTERN.exec(stem);
  if (parens) {
    const digits = parens[2]!;
    const frameNumber = Number(digits);
    if (!Number.isSafeInteger(frameNumber)) return null;
    return {
      extension,
      frameNumber,
      numberStyle: "parens",
      numericWidth: isZeroPaddedDigits(digits) ? digits.length : 0,
      prefix: parens[1]!,
    };
  }

  const trailing = TRAILING_FRAME_PATTERN.exec(stem);
  if (!trailing) return null;
  const digits = trailing[2]!;
  const frameNumber = Number(digits);
  if (!Number.isSafeInteger(frameNumber)) return null;
  return {
    extension,
    frameNumber,
    numberStyle: "trailing",
    numericWidth: isZeroPaddedDigits(digits) ? digits.length : 0,
    prefix: trailing[1]!,
  };
}

/**
 * Display label for a sequence primary card, without extension.
 * Examples: `Scaning Block Particles_00000~00150`, `shot(1)~(35)`, `clip_0~35`.
 */
export function formatImageSequenceDisplayName(input: {
  firstFrame: number;
  lastFrame: number;
  numberStyle: ImageSequenceNumberStyle;
  numericWidth: number;
  prefix: string;
}): string {
  const pad = (frame: number): string => {
    const raw = String(frame);
    if (input.numericWidth <= 0) return raw;
    return raw.padStart(input.numericWidth, "0");
  };
  const first = pad(input.firstFrame);
  const last = pad(input.lastFrame);
  if (input.numberStyle === "parens") {
    return `${input.prefix}(${first})~(${last})`;
  }
  return `${input.prefix}${first}~${last}`;
}

/**
 * Split filenames into maximal consecutive numbered image runs.
 *
 * Values may be bare filenames or relative paths. Grouping is always scoped by
 * parent directory so `deep/file1.jpg` never merges with root `file2.jpg` even
 * when a caller accidentally passes a mixed-directory list.
 *
 * Unpadded runs (`_0`…`_35`) share one group even when digit width grows.
 * Zero-padded runs (`_0001`…`_0035`) stay width-strict.
 * Parentheses style never merges with trailing-digit style.
 */
export function detectImageSequences(
  values: readonly string[],
  minimumFrameCount = 3,
): ImageSequenceCandidate[] {
  if (!Number.isSafeInteger(minimumFrameCount) || minimumFrameCount < 2) {
    throw new RangeError("minimumFrameCount must be an integer of at least 2.");
  }
  const groups = new Map<string, ImageSequenceFrameCandidate[]>();
  for (const value of values) {
    const parsed = parseImageSequenceFileName(value);
    if (!parsed) continue;
    const portable = value.replaceAll("\\", "/");
    const slash = portable.lastIndexOf("/");
    const directory = slash === -1 ? "." : portable.slice(0, slash);
    const name = slash === -1 ? portable : portable.slice(slash + 1);
    const key = [
      directory.normalize("NFC").toLocaleLowerCase("en-US"),
      parsed.prefix.normalize("NFC").toLocaleLowerCase("en-US"),
      parsed.extension,
      parsed.numberStyle,
      parsed.numericWidth,
    ].join("\u0000");
    const group = groups.get(key) ?? [];
    group.push({
      frameNumber: parsed.frameNumber,
      name,
      numberStyle: parsed.numberStyle,
      numericWidth: parsed.numericWidth,
      value,
    });
    groups.set(key, group);
  }

  const result: ImageSequenceCandidate[] = [];
  for (const frames of groups.values()) {
    frames.sort(
      (left, right) =>
        left.frameNumber - right.frameNumber || left.name.localeCompare(right.name),
    );
    let run: ImageSequenceFrameCandidate[] = [];
    const emit = () => {
      if (run.length < minimumFrameCount) return;
      const head = run[0]!;
      const parsed = parseImageSequenceFileName(head.name);
      if (!parsed) return;
      result.push({
        extension: parsed.extension,
        frames: run,
        numberStyle: head.numberStyle,
        numericWidth: head.numericWidth,
        prefix: parsed.prefix,
      });
    };
    for (const frame of frames) {
      const previous = run.at(-1);
      if (!previous || frame.frameNumber === previous.frameNumber + 1) {
        run = [...run, frame];
        continue;
      }
      emit();
      run = [frame];
    }
    emit();
  }
  return result.sort((left, right) =>
    left.frames[0]!.value.localeCompare(right.frames[0]!.value),
  );
}

export function findImageSequenceContaining(
  selectedValue: string,
  siblingValues: readonly string[],
): ImageSequenceCandidate | null {
  return (
    detectImageSequences(siblingValues).find((sequence) =>
      sequence.frames.some((frame) => frame.value === selectedValue),
    ) ?? null
  );
}
