/**
 * Product-level media format registry.
 *
 * An extension appearing here means Serpent has an owned thumbnail/preview
 * path for it. It deliberately does not mean that Chromium can play or render
 * the original file directly; the Worker selects a derivative where needed.
 */

/** Filename extensions that contain the JPEG bitstream. */
export const JPEG_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.jfif'] as const;

export const SHARP_IMAGE_EXTENSIONS = [
  '.png', ...JPEG_IMAGE_EXTENSIONS, '.gif', '.tif', '.tiff', '.webp', '.svg',
] as const;

/** Formats decoded by the bundled OIIO runtime rather than by Chromium/sharp. */
export const OIIO_IMAGE_EXTENSIONS = [
  '.bmp', '.ico', '.psd', '.exr', '.tga',
] as const;

/** Camera RAW formats decoded by OIIO's LibRaw plugin. */
export const RAW_IMAGE_EXTENSIONS = [
  '.raw', '.dng', '.cr2', '.cr3', '.nef', '.arw', '.raf', '.orf', '.rw2',
] as const;

export const IMAGE_EXTENSIONS = [
  ...SHARP_IMAGE_EXTENSIONS,
  ...OIIO_IMAGE_EXTENSIONS,
  ...RAW_IMAGE_EXTENSIONS,
] as const;

export const VIDEO_EXTENSIONS = [
  '.mp4', '.mov', '.avi', '.wmv', '.webm', '.mkv', '.m4v',
] as const;

/**
 * Containers Chromium can typically play from the original file in the viewer
 * (REQ-VIEW-002). Other video containers still use a ready playback proxy
 * instead of remounting an unplayable source after the proxy already exists.
 */
export const CHROMIUM_DIRECT_PLAY_VIDEO_EXTENSIONS = ['.mp4', '.webm', '.m4v'] as const;

/**
 * T1 3D formats (slice 0030, decision #3): FBX / OBJ(MTL) / glTF / GLB / STL.
 * Registration means Serpent owns a preview path for these; actual rendering
 * (viewer + offscreen thumbnails) lands in later slices (C / E).
 */
export const MODEL_EXTENSIONS = [
  '.fbx', '.obj', '.gltf', '.glb', '.stl',
] as const;

/** Document formats with a native preview/viewer path. */
export const DOCUMENT_EXTENSIONS = [
  '.pdf', '.html', '.htm',
] as const;

export type ImageDecoder = 'sharp' | 'oiio';

const sharpExtensions = new Set<string>(SHARP_IMAGE_EXTENSIONS);
const rawImageExtensions = new Set<string>(RAW_IMAGE_EXTENSIONS);
const oiioExtensions = new Set<string>([
  ...OIIO_IMAGE_EXTENSIONS,
  ...RAW_IMAGE_EXTENSIONS,
]);
const imageExtensions = new Set<string>(IMAGE_EXTENSIONS);
const videoExtensions = new Set<string>(VIDEO_EXTENSIONS);
const chromiumDirectPlayVideoExtensions = new Set<string>(CHROMIUM_DIRECT_PLAY_VIDEO_EXTENSIONS);
const modelExtensions = new Set<string>(MODEL_EXTENSIONS);
const documentExtensions = new Set<string>(DOCUMENT_EXTENSIONS);
const audioProtocolMimeByExtension: Record<string, string> = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.opus': 'audio/ogg',
};

function normalizedExtension(extensionOrFilename: string): string {
  const lower = extensionOrFilename.toLowerCase();
  const lastDot = lower.lastIndexOf('.');
  return lastDot >= 0 ? lower.slice(lastDot) : lower;
}

export function isRawImageExtension(extensionOrFilename: string): boolean {
  return rawImageExtensions.has(normalizedExtension(extensionOrFilename));
}

export function isSupportedImageExtension(extensionOrFilename: string): boolean {
  return imageExtensions.has(normalizedExtension(extensionOrFilename));
}

export function isSupportedVideoExtension(extensionOrFilename: string): boolean {
  return videoExtensions.has(normalizedExtension(extensionOrFilename));
}

export function isChromiumDirectPlayVideoExtension(extensionOrFilename: string): boolean {
  return chromiumDirectPlayVideoExtensions.has(normalizedExtension(extensionOrFilename));
}

/**
 * MIME type for bytes served over `serpent://preview` / `serpent://proxy`.
 * H.264 playback proxies are `.mp4`; missing that mapping used to emit
 * `application/octet-stream`, which Chromium will not decode.
 */
export function artifactProtocolMimeForExtension(extensionOrFilename: string): string {
  const extension = normalizedExtension(extensionOrFilename);
  return imageMimeForExtension(extension)
    ?? videoMimeForExtension(extension)
    ?? audioProtocolMimeByExtension[extension]
    ?? (extension === '.json' ? 'application/json' : 'application/octet-stream');
}

export function isSupportedModelExtension(extensionOrFilename: string): boolean {
  return modelExtensions.has(normalizedExtension(extensionOrFilename));
}

export function isSupportedDocumentExtension(extensionOrFilename: string): boolean {
  return documentExtensions.has(normalizedExtension(extensionOrFilename));
}

export function imageDecoderForExtension(
  extensionOrFilename: string,
): ImageDecoder | null {
  const extension = normalizedExtension(extensionOrFilename);
  if (sharpExtensions.has(extension)) return 'sharp';
  if (oiioExtensions.has(extension)) return 'oiio';
  return null;
}

/**
 * Non-native image viewers need a decoded derivative because Chromium cannot
 * render the source container itself. Keep this separate from the thumbnail
 * decoder: TIFF is intentionally routed through OIIO for both card and viewer
 * decoding, so ordinary and metadata-heavy files use the same format-owned
 * path. Other formats retain their existing card decoder while the viewer
 * selects the appropriate full-resolution path.
 */
export function imageViewerDecoderForExtension(
  extensionOrFilename: string,
): ImageDecoder | null {
  const extension = normalizedExtension(extensionOrFilename);
  if (extension === '.tif' || extension === '.tiff') return 'oiio';
  return imageDecoderForExtension(extension);
}

/** Native source rendering is an optimization, never the format-support path. */
export function directImageMimeForExtension(
  extensionOrFilename: string,
): string | null {
  switch (normalizedExtension(extensionOrFilename)) {
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg':
    case '.jfif': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.webp': return 'image/webp';
    // SVG stays vector in the viewer; the grid still uses its generated
    // thumbnail for predictable card sizing and performance.
    case '.svg': return 'image/svg+xml';
    default: return null;
  }
}

export function imageMimeForExtension(extensionOrFilename: string): string | null {
  switch (normalizedExtension(extensionOrFilename)) {
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg':
    case '.jfif': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.tif':
    case '.tiff': return 'image/tiff';
    case '.webp': return 'image/webp';
    case '.bmp': return 'image/bmp';
    case '.ico': return 'image/x-icon';
    case '.svg': return 'image/svg+xml';
    case '.psd': return 'image/vnd.adobe.photoshop';
    case '.exr': return 'image/x-exr';
    case '.tga': return 'image/x-tga';
    case '.dng': return 'image/x-adobe-dng';
    case '.raw': return 'image/x-camera-raw';
    case '.cr2': return 'image/x-canon-cr2';
    case '.cr3': return 'image/x-canon-cr3';
    case '.nef': return 'image/x-nikon-nef';
    case '.arw': return 'image/x-sony-arw';
    case '.raf': return 'image/x-fuji-raf';
    case '.orf': return 'image/x-olympus-orf';
    case '.rw2': return 'image/x-panasonic-rw2';
    default: return null;
  }
}

export function videoMimeForExtension(extensionOrFilename: string): string | null {
  switch (normalizedExtension(extensionOrFilename)) {
    case '.mp4': return 'video/mp4';
    case '.mov': return 'video/quicktime';
    case '.avi': return 'video/x-msvideo';
    case '.wmv': return 'video/x-ms-wmv';
    case '.webm': return 'video/webm';
    case '.mkv': return 'video/x-matroska';
    case '.m4v': return 'video/x-m4v';
    default: return null;
  }
}

/**
 * Product MIME labels for the T1 3D set. These are informational (the viewer
 * loads models through three.js loaders, not <object>/Chromium media); they
 * surface in resolutions/Inspector so the renderer can branch on kind.
 */
export function modelMimeForExtension(extensionOrFilename: string): string | null {
  switch (normalizedExtension(extensionOrFilename)) {
    case '.glb': return 'model/gltf-binary';
    case '.gltf': return 'model/gltf+json';
    case '.obj': return 'model/obj';
    case '.fbx': return 'model/fbx';
    case '.stl': return 'model/stl';
    default: return null;
  }
}
