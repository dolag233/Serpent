export const LARGE_LIBRARY_FIXTURE_VERSION = 3;
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

/** q3pg original mix: jpg/png/webp/gif/tiff, not just three web-safe stills. */
export const IMAGE_EXTENSIONS = ['jpg', 'png', 'webp', 'gif', 'tiff'] as const;
export const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov'] as const;
const MODEL_EXTENSIONS = ['obj', 'stl', 'gltf'] as const;
const TEXT_EXTENSIONS = ['txt', 'md', 'json', 'csv'] as const;
const AUDIO_EXTENSIONS = ['wav'] as const;
const UNSUPPORTED_EXTENSIONS = ['xyz', 'max', 'c4d', 'blend', 'uasset', 'pak'] as const;

/** 4K/8K stay jpeg/webp so GIF/TIFF/PNG do not explode encode time or disk. */
const IMAGE_EXTENSIONS_HIGH_RES = ['jpg', 'webp'] as const;
const IMAGE_EXTENSIONS_2K = ['jpg', 'png', 'webp', 'tiff'] as const;

const IMAGE_ASPECTS = [
  { width: 16, height: 9 },
  { width: 4, height: 3 },
  { width: 1, height: 1 },
  { width: 3, height: 4 },
  { width: 9, height: 16 },
] as const;

/**
 * Game-art long-edge buckets (Serpent 首发用户是游戏美术).
 * User mix: 1% 8K / 3% 4K / 30% 2K / 60% 1K; the leftover 6% lands on 1K.
 */
export type LargeLibraryImageSizeBucket = '1k' | '2k' | '4k' | '8k';
export const IMAGE_SIZE_LONG_EDGE: Record<LargeLibraryImageSizeBucket, number> = {
  '8k': 8192,
  '4k': 4096,
  '2k': 2048,
  '1k': 1024,
};
const VIDEO_SIZE = { width: 640, height: 360 } as const;

export interface LargeLibraryImageGeometry {
  width: number;
  height: number;
}

export function sizeBucketForIndex(index: number): LargeLibraryImageSizeBucket {
  const slot = ((index % 100) + 100) % 100;
  if (slot < 1) return '8k';
  if (slot < 4) return '4k';
  if (slot < 34) return '2k';
  return '1k';
}

function pickFrom<T>(index: number, list: readonly T[]): T {
  return list[(index + Math.floor(index / 100)) % list.length]!;
}

function geometryForLongEdge(
  longEdge: number,
  aspect: (typeof IMAGE_ASPECTS)[number],
): LargeLibraryImageGeometry {
  if (aspect.width >= aspect.height) {
    return {
      width: longEdge,
      height: Math.max(1, Math.round((longEdge * aspect.height) / aspect.width)),
    };
  }
  return {
    width: Math.max(1, Math.round((longEdge * aspect.width) / aspect.height)),
    height: longEdge,
  };
}

/**
 * Image pixel size follows the 8K/4K/2K/1K mix. Unique files are still pooled
 * by format×aspect×geometry, then copied — that is the "size pool".
 */
export function imageGeometryForIndex(index: number): LargeLibraryImageGeometry {
  return geometryForLongEdge(
    IMAGE_SIZE_LONG_EDGE[sizeBucketForIndex(index)],
    pickFrom(index, IMAGE_ASPECTS),
  );
}

export function videoGeometry(): LargeLibraryImageGeometry {
  return { ...VIDEO_SIZE };
}

export function imagePoolKey(extension: string, geometry: LargeLibraryImageGeometry): string {
  return `${extension}:${geometry.width}x${geometry.height}`;
}

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
    case 'image': {
      const bucket = sizeBucketForIndex(index);
      if (bucket === '8k' || bucket === '4k') return pickFrom(index, IMAGE_EXTENSIONS_HIGH_RES);
      if (bucket === '2k') return pickFrom(index, IMAGE_EXTENSIONS_2K);
      return pickFrom(index, IMAGE_EXTENSIONS);
    }
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
