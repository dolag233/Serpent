/**
 * Color-space metadata shared by the image decoders.
 *
 * Sharp exposes the container interpretation and embedded ICC bytes, while
 * OpenImageIO exposes normalized `oiio:ColorSpace` and ICC profile tags in its
 * `--info -v` output. Keep the mapping here so thumbnail generation and the
 * preview protocol cannot silently disagree about the source space.
 */

import {
  COMMON_IMAGE_COLOR_SPACE_OPTIONS,
  type ImageColorSpaceOption,
} from '../shared/image-color-space';

export { COMMON_IMAGE_COLOR_SPACE_OPTIONS } from '../shared/image-color-space';
export type { ImageColorSpaceOption } from '../shared/image-color-space';

export type ImageColorSpaceSource = 'embedded' | 'metadata' | 'inferred';

export interface ImageColorSpaceInfo {
  /** Canonical OCIO input-space alias used by the bundled config. */
  id: string;
  /** Human-readable profile/space name, retaining the original metadata name. */
  label: string;
  source: ImageColorSpaceSource;
  /** True when the source is scene-linear rather than display/texture encoded. */
  isLinear: boolean;
  /** A short diagnostic string for tests/logging; never contains a filesystem path. */
  metadataName?: string;
}

const OPTION_BY_ID = new Map(
  COMMON_IMAGE_COLOR_SPACE_OPTIONS.map((option) => [option.id, option]),
);

function normalizeText(value: string): string {
  return value
    .trim()
    .replace(/[“”]/gu, '"')
    .replace(/\s+/gu, ' ');
}

/** Map common ICC/metadata names to aliases understood by the bundled OCIO config. */
export function canonicalImageColorSpace(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const value = normalizeText(raw).toLowerCase();
  if (!value) return undefined;
  if (OPTION_BY_ID.has(value)) return value;
  if (value.includes('acescg') || value.includes('ap1')) return 'lin_ap1';
  if (value.includes('aces2065') || value === 'aces' || value.includes('ap0')) return 'aces2065_1';
  if (value.includes('display p3') || value.includes('p3-d65') || value.includes('p3 d65')) {
    return value.includes('linear') ? 'lin_p3d65' : 'srgb_p3d65';
  }
  if (value.includes('adobe rgb') || value.includes('adobergb')) {
    return value.includes('linear') ? 'lin_adobergb' : 'adobergb';
  }
  if (
    value.includes('linear srgb') ||
    value.includes('linear rec.709') ||
    value.includes('linear rec709')
  ) {
    return 'lin_rec709_srgb';
  }
  if (value.includes('rec.2020') || value.includes('rec2020') || value.includes('2020')) {
    return value.includes('linear') ? 'lin_rec2020' : 'g22_rec709';
  }
  if (value.includes('linear') || value.includes('scene_linear') || value === 'raw') {
    return value.includes('aces') ? 'lin_ap1' : 'scene_linear';
  }
  if (
    value.includes('srgb') ||
    value.includes('rec.709') ||
    value.includes('rec709') ||
    value.includes('gamma 2.2') ||
    value === 'rgb'
  ) {
    return 'srgb_texture';
  }
  return undefined;
}

export function imageColorSpaceOption(id: string): ImageColorSpaceOption {
  return OPTION_BY_ID.get(id) ?? {
    id,
    label: id,
    isLinear: id.startsWith('lin_') || id === 'scene_linear',
  };
}

export function colorSpaceInfoFromName(
  raw: string | undefined,
  source: ImageColorSpaceSource,
): ImageColorSpaceInfo | undefined {
  const metadataName = raw ? normalizeText(raw) : undefined;
  const id = canonicalImageColorSpace(metadataName);
  if (!id) return undefined;
  const option = imageColorSpaceOption(id);
  const label = metadataName && metadataName.toLowerCase() !== id
    ? metadataName
    : option.label;
  return {
    id,
    label,
    source,
    isLinear: option.isLinear,
    ...(metadataName && metadataName !== option.label ? { metadataName } : {}),
  };
}

export function defaultImageColorSpace(extension: string): ImageColorSpaceInfo {
  const normalized = extension.toLowerCase();
  // OpenEXR stores scene-referred floating point values. Existing Serpent
  // previews intentionally use the same default for TGA to preserve the
  // established OIIO route until a file profile says otherwise.
  const id = normalized === '.exr' || normalized === '.tga'
    ? 'scene_linear'
    : 'srgb_texture';
  const option = imageColorSpaceOption(id);
  return { id, label: option.label, source: 'inferred', isLinear: option.isLinear };
}

/** Extract the ICC profile description from an ICC v2/v4 binary. */
export function parseIccProfileDescription(profile: Buffer | undefined): string | undefined {
  if (!profile || profile.length < 132) return undefined;
  const tagCount = profile.readUInt32BE(128);
  for (let index = 0; index < tagCount; index += 1) {
    const entry = 132 + index * 12;
    if (entry + 12 > profile.length) break;
    const signature = profile.toString('ascii', entry, entry + 4);
    const offset = profile.readUInt32BE(entry + 4);
    const size = profile.readUInt32BE(entry + 8);
    if (signature !== 'desc' || offset + size > profile.length || size < 16) continue;
    const type = profile.toString('ascii', offset, offset + 4);
    if (type === 'desc') {
      const length = profile.readUInt32BE(offset + 8);
      if (length > 0 && offset + 12 + length <= profile.length) {
        return profile.toString('ascii', offset + 12, offset + 12 + length - 1).replace(/\0+$/gu, '').trim();
      }
    }
    if (type === 'mluc' && offset + 28 <= profile.length) {
      const count = profile.readUInt32BE(offset + 8);
      const recordSize = profile.readUInt32BE(offset + 12);
      if (count > 0 && recordSize >= 12 && offset + 16 + recordSize <= profile.length) {
        const record = offset + 16;
        const length = profile.readUInt32BE(record + 4);
        const textOffset = profile.readUInt32BE(record + 8);
        if (length > 0 && textOffset + length <= size) {
          const bytes = profile.subarray(offset + textOffset, offset + textOffset + length);
          let text = '';
          for (let index = 0; index + 1 < bytes.length; index += 2) {
            text += String.fromCharCode((bytes[index]! << 8) | bytes[index + 1]!);
          }
          return text.trim();
        }
      }
    }
  }
  return undefined;
}

/** Parse the color-space lines emitted by `oiiotool --info -v`. */
export function parseOiioColorSpaceInfo(output: string): ImageColorSpaceInfo | undefined {
  const profile = /ICCProfile:profile_description:\s*"([^"]+)"/iu.exec(output)?.[1];
  if (profile) {
    const info = colorSpaceInfoFromName(profile, 'embedded');
    if (info) return info;
  }
  const oiio = /(?:oiio:ColorSpace|oiio:colorspace):\s*"?([^"\r\n]+)"?/iu.exec(output)?.[1];
  if (oiio) {
    const info = colorSpaceInfoFromName(oiio, 'metadata');
    if (info) return info;
  }
  const exif = /Exif:ColorSpace:\s*(\d+)/iu.exec(output)?.[1];
  if (exif === '1') return colorSpaceInfoFromName('sRGB', 'metadata');
  if (exif === '2') return colorSpaceInfoFromName('Adobe RGB', 'metadata');
  const chromaticities = /(?:^|\n)\s*chromaticities:\s*"?([^"\r\n]+)"?/iu.exec(output)?.[1];
  if (chromaticities) {
    const values = chromaticities.split(/[ ,]+/u).map(Number);
    if (values.length >= 8 && values.every(Number.isFinite)) {
      const close = (expected: readonly number[]) => expected.every(
        (value, index) => Math.abs(value - values[index]!) < 0.01,
      );
      if (close([0.64, 0.33, 0.30, 0.60, 0.15, 0.06, 0.3127, 0.3290])) {
        return colorSpaceInfoFromName('Linear sRGB / Rec.709', 'metadata');
      }
      if (close([0.713, 0.293, 0.165, 0.830, 0.128, 0.044, 0.32168, 0.33767])) {
        return colorSpaceInfoFromName('ACEScg (linear)', 'metadata');
      }
      if (close([0.68, 0.32, 0.265, 0.69, 0.15, 0.06, 0.3127, 0.3290])) {
        return colorSpaceInfoFromName('Linear Display P3', 'metadata');
      }
      if (close([0.708, 0.292, 0.170, 0.797, 0.131, 0.046, 0.3127, 0.3290])) {
        return colorSpaceInfoFromName('Linear Rec.2020', 'metadata');
      }
    }
  }
  return undefined;
}
