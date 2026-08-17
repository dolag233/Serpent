import { describe, expect, it } from 'vitest';

import {
  canonicalImageColorSpace,
  defaultImageColorSpace,
  parseIccProfileDescription,
  parseOiioColorSpaceInfo,
} from '../../src/worker/image-color-space';
import { canOverrideImageColorSpace } from '../../src/shared/image-color-space';

describe('image color-space metadata', () => {
  it('maps common embedded profile names to OCIO aliases', () => {
    expect(canonicalImageColorSpace('sRGB IEC61966-2.1')).toBe('srgb_texture');
    expect(canonicalImageColorSpace('Adobe RGB (1998)')).toBe('adobergb');
    expect(canonicalImageColorSpace('Display P3')).toBe('srgb_p3d65');
    expect(canonicalImageColorSpace('ACEScg (linear)')).toBe('lin_ap1');
  });

  it('parses OIIO ICC and colorspace metadata with safe fallbacks', () => {
    expect(parseOiioColorSpaceInfo('ICCProfile:profile_description: "Adobe RGB (1998)"'))
      .toMatchObject({ id: 'adobergb', source: 'embedded' });
    expect(parseOiioColorSpaceInfo('oiio:ColorSpace: "srgb_rec709_scene"'))
      .toMatchObject({ id: 'srgb_texture', source: 'metadata' });
    expect(parseOiioColorSpaceInfo('Exif:ColorSpace: 1'))
      .toMatchObject({ id: 'srgb_texture', source: 'metadata' });
    expect(parseOiioColorSpaceInfo('chromaticities: "0.64,0.33,0.30,0.60,0.15,0.06,0.3127,0.3290"'))
      .toMatchObject({ id: 'lin_rec709_srgb', source: 'metadata' });
    expect(parseOiioColorSpaceInfo('ICCProfile:color_space: "RGB"')).toBeUndefined();
  });

  it('uses scene-linear only for the established HDR defaults', () => {
    expect(defaultImageColorSpace('.exr')).toMatchObject({ id: 'scene_linear', source: 'inferred' });
    expect(defaultImageColorSpace('.tga')).toMatchObject({ id: 'scene_linear', source: 'inferred' });
    expect(defaultImageColorSpace('.psd')).toMatchObject({ id: 'srgb_texture', source: 'inferred' });
  });

  it('allows OIIO overrides for ICC-capable raster extensions', () => {
    expect(canOverrideImageColorSpace('preview.png')).toBe(true);
    expect(canOverrideImageColorSpace('preview.psd')).toBe(true);
    expect(canOverrideImageColorSpace('preview.svg')).toBe(false);
  });

  it('reads an ICC v2 desc profile label', () => {
    const profile = Buffer.alloc(256);
    profile.writeUInt32BE(1, 128);
    profile.write('desc', 132, 'ascii');
    profile.writeUInt32BE(144, 136);
    profile.writeUInt32BE(32, 140);
    profile.write('desc', 144, 'ascii');
    profile.writeUInt32BE(0, 148);
    const label = 'sRGB IEC61966-2.1';
    profile.writeUInt32BE(label.length + 1, 152);
    profile.write(label, 156, 'ascii');
    expect(parseIccProfileDescription(profile)).toBe('sRGB IEC61966-2.1');
  });
});
