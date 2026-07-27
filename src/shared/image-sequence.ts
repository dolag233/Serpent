const TRAILING_FRAME_PATTERN = /^(.*?)(\d+)$/u;

export interface ImageSequenceCandidate {
  extension: string;
  frames: ImageSequenceFrameCandidate[];
  prefix: string;
}

export interface ImageSequenceFrameCandidate {
  frameNumber: number;
  name: string;
  numericWidth: number;
  value: string;
}

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

function splitFileName(value: string): {
  extension: string;
  frameNumber: number;
  numericWidth: number;
  prefix: string;
} | null {
  const name = value.replaceAll("\\", "/").split("/").at(-1) ?? "";
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return null;
  const extension = name.slice(dot).toLocaleLowerCase("en-US");
  if (!IMAGE_SEQUENCE_EXTENSIONS.has(extension)) return null;
  const match = TRAILING_FRAME_PATTERN.exec(name.slice(0, dot));
  if (!match) return null;
  const digits = match[2]!;
  const frameNumber = Number(digits);
  if (!Number.isSafeInteger(frameNumber)) return null;
  return {
    extension,
    frameNumber,
    numericWidth: digits.length,
    prefix: match[1]!,
  };
}

/**
 * Split filenames into maximal consecutive numbered image runs.
 *
 * Values may be bare filenames or relative paths. Grouping is always scoped by
 * parent directory so `deep/file1.jpg` never merges with root `file2.jpg` even
 * when a caller accidentally passes a mixed-directory list.
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
    const parsed = splitFileName(value);
    if (!parsed) continue;
    const portable = value.replaceAll("\\", "/");
    const slash = portable.lastIndexOf("/");
    const directory = slash === -1 ? "." : portable.slice(0, slash);
    const name = slash === -1 ? portable : portable.slice(slash + 1);
    const key = [
      directory.normalize("NFC").toLocaleLowerCase("en-US"),
      parsed.prefix.normalize("NFC").toLocaleLowerCase("en-US"),
      parsed.extension,
      parsed.numericWidth,
    ].join("\u0000");
    const group = groups.get(key) ?? [];
    group.push({
      frameNumber: parsed.frameNumber,
      name,
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
      const parsed = splitFileName(run[0]!.name)!;
      result.push({
        extension: parsed.extension,
        frames: run,
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
