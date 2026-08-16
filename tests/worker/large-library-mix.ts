export const LARGE_LIBRARY_FIXTURE_VERSION = 2;
export const LARGE_LIBRARY_SEARCH_TOKEN = 'serpent-large-library-needle';
export const LARGE_LIBRARY_ASSET_COUNT = 20_000;

export const LARGE_LIBRARY_MIX = {
  /** Floor target; actual image share is 1 minus the other buckets (about 91% at 20k). */
  image: 0.9,
  video: 0.05,
  model: 0.01,
  text: 0.01,
  audio: 0.01,
  unsupported: 0.01,
} as const;

export type LargeLibraryAssetKind =
  | 'image'
  | 'video'
  | 'model'
  | 'text'
  | 'audio'
  | 'unsupported';

export interface LargeLibraryMixCounts {
  assetCount: number;
  imageCount: number;
  videoCount: number;
  modelCount: number;
  textCount: number;
  audioCount: number;
  unsupportedCount: number;
}

const IMAGE_EXTENSIONS = ['jpg', 'png', 'webp'] as const;
const VIDEO_EXTENSIONS = ['mp4'] as const;
const MODEL_EXTENSIONS = ['obj', 'stl', 'gltf'] as const;
const TEXT_EXTENSIONS = ['txt', 'md', 'json', 'csv'] as const;
const AUDIO_EXTENSIONS = ['wav'] as const;
const UNSUPPORTED_EXTENSIONS = ['xyz', 'max', 'c4d', 'blend', 'uasset', 'pak'] as const;

function countFor(assetCount: number, ratio: number): number {
  return Math.round(assetCount * ratio);
}

export function mixCountsFor(assetCount: number): LargeLibraryMixCounts {
  if (!Number.isInteger(assetCount) || assetCount < 100) {
    throw new Error('Large-library mix requires an integer assetCount >= 100.');
  }
  const videoCount = countFor(assetCount, LARGE_LIBRARY_MIX.video);
  const modelCount = countFor(assetCount, LARGE_LIBRARY_MIX.model);
  const textCount = countFor(assetCount, LARGE_LIBRARY_MIX.text);
  const audioCount = countFor(assetCount, LARGE_LIBRARY_MIX.audio);
  const unsupportedCount = countFor(assetCount, LARGE_LIBRARY_MIX.unsupported);
  const imageCount = assetCount
    - videoCount
    - modelCount
    - textCount
    - audioCount
    - unsupportedCount;
  if (imageCount <= 0) {
    throw new Error(`Mix overflow for assetCount=${assetCount}`);
  }
  return {
    assetCount,
    imageCount,
    videoCount,
    modelCount,
    textCount,
    audioCount,
    unsupportedCount,
  };
}

export function kindForIndex(index: number, counts: LargeLibraryMixCounts): LargeLibraryAssetKind {
  let cursor = counts.imageCount;
  if (index < cursor) return 'image';
  cursor += counts.videoCount;
  if (index < cursor) return 'video';
  cursor += counts.modelCount;
  if (index < cursor) return 'model';
  cursor += counts.textCount;
  if (index < cursor) return 'text';
  cursor += counts.audioCount;
  if (index < cursor) return 'audio';
  return 'unsupported';
}

export function extensionForKind(kind: LargeLibraryAssetKind, index: number): string {
  switch (kind) {
    case 'image':
      return IMAGE_EXTENSIONS[index % IMAGE_EXTENSIONS.length]!;
    case 'video':
      return VIDEO_EXTENSIONS[index % VIDEO_EXTENSIONS.length]!;
    case 'model':
      return MODEL_EXTENSIONS[index % MODEL_EXTENSIONS.length]!;
    case 'text':
      return TEXT_EXTENSIONS[index % TEXT_EXTENSIONS.length]!;
    case 'audio':
      return AUDIO_EXTENSIONS[index % AUDIO_EXTENSIONS.length]!;
    case 'unsupported':
      return UNSUPPORTED_EXTENSIONS[index % UNSUPPORTED_EXTENSIONS.length]!;
  }
}

export function pad(value: number, width = 5): string {
  return value.toString().padStart(width, '0');
}
