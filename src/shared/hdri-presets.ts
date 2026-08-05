/**
 * Bundled HDRI environment preset receipts (spec 3D-09 / §5) — shared
 * metadata only, no glob, no runtime URL resolution.
 *
 * This table is the single source of truth for the two Poly Haven CC0 1K
 * equirectangular `.hdr` files bundled with the app:
 * - the renderer viewer toolbar (`src/renderer/3d-viewer/hdri-presets.ts`
 *   re-exports from here and adds the `import.meta.glob` runtime URL map);
 * - the Main-process `serpent://app-assets` handler (`src/main/app-assets.ts`)
 *   whitelists file names and verifies sha256/size against this table, so a
 *   broken packaged asset fails loudly instead of rendering a corrupted sky.
 *
 * Acquisition metadata is replayed by `scripts/acquire-hdri.mjs`.
 */

export const BUNDLED_HDRI_PRESET_IDS = ['studio-small-09', 'kloppenheim-02'] as const;

export type BundledHdriPresetId = (typeof BUNDLED_HDRI_PRESET_IDS)[number];
export type HdriPresetCategory = 'studio' | 'natural';

export type HdriPreset = {
  readonly id: BundledHdriPresetId;
  /** Bilingual label; `zh-CN` is the product primary language. */
  readonly displayName: Readonly<{ 'zh-CN': string; en: string }>;
  readonly category: HdriPresetCategory;
  /** File name under `src/renderer/assets/hdri/` (dev) / packaged renderer assets. */
  readonly fileName: string;
  readonly width: number;
  readonly height: number;
  readonly fileSizeBytes: number;
  readonly sha256: string;
  /** Poly Haven asset page (CC0 license record). */
  readonly sourceUrl: string;
  readonly license: 'CC0';
};

export const HDRI_PRESETS: readonly HdriPreset[] = [
  {
    id: 'studio-small-09',
    displayName: { 'zh-CN': '摄影棚小景', en: 'Studio Small 09' },
    category: 'studio',
    fileName: 'studio_small_09_1k.hdr',
    width: 1024,
    height: 512,
    fileSizeBytes: 1615248,
    sha256: 'e7cfda5f4e98e623db12b8bfd0184e048488e4855d9c83e2751fb44a32e80c45',
    sourceUrl: 'https://polyhaven.com/a/studio_small_09',
    license: 'CC0',
  },
  {
    id: 'kloppenheim-02',
    displayName: { 'zh-CN': '户外晴天', en: 'Kloppenheim 02 (Sunny)' },
    category: 'natural',
    fileName: 'kloppenheim_02_1k.hdr',
    width: 1024,
    height: 512,
    fileSizeBytes: 1740414,
    sha256: '04d23c6b243742b5046310b29211aec671d7a0570f3596e1a6b43e614c9acadf',
    sourceUrl: 'https://polyhaven.com/a/kloppenheim_02',
    license: 'CC0',
  },
];

/** Look up a bundled preset by id; null when the id is not a bundled preset. */
export function getBundledHdriPreset(id: string): HdriPreset | null {
  return HDRI_PRESETS.find((preset) => preset.id === id) ?? null;
}
