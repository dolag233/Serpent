/** Color-space choices exposed by the locked OCIO configuration. */
export interface ImageColorSpaceOption {
  id: string;
  label: string;
  isLinear: boolean;
}

export const COMMON_IMAGE_COLOR_SPACE_OPTIONS: readonly ImageColorSpaceOption[] = [
  { id: 'srgb_texture', label: 'sRGB', isLinear: false },
  { id: 'srgb_p3d65', label: 'Display P3', isLinear: false },
  { id: 'adobergb', label: 'Adobe RGB (1998)', isLinear: false },
  { id: 'lin_rec709_srgb', label: 'Linear sRGB / Rec.709', isLinear: true },
  { id: 'lin_p3d65', label: 'Linear Display P3', isLinear: true },
  { id: 'lin_rec2020', label: 'Linear Rec.2020', isLinear: true },
  { id: 'lin_ap1', label: 'ACEScg', isLinear: true },
  { id: 'scene_linear', label: 'Scene-linear (ACEScg)', isLinear: true },
] as const;

/** Formats that can be re-rendered through the bundled OIIO color pipeline. */
export const COLOR_MANAGED_IMAGE_EXTENSIONS = new Set([
  '.bmp', '.cr2', '.cr3', '.dng', '.exr', '.ico', '.jpg', '.jpeg', '.nef', '.png',
  '.orf', '.psd', '.raf', '.raw', '.rw2', '.tga', '.tif', '.tiff', '.webp',
  '.arw',
]);

export function canOverrideImageColorSpace(extensionOrFilename: string): boolean {
  const lower = extensionOrFilename.toLowerCase();
  const dot = lower.lastIndexOf('.');
  const extension = dot >= 0 ? lower.slice(dot) : lower;
  return COLOR_MANAGED_IMAGE_EXTENSIONS.has(extension);
}
