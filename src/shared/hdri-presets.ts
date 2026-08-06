/**
 * Bundled HDRI environment preset receipts (spec 3D-09 / §5) — shared
 * metadata only, no glob, no runtime URL resolution.
 *
 * This table is the single source of truth for the four Poly Haven CC0 1K
 * equirectangular `.hdr` files bundled with the app (user-selected set,
 * 2026-08-06: product / interior / outdoor / nature):
 * - the renderer viewer toolbar (`src/renderer/3d-viewer/hdri-presets.ts`
 *   re-exports from here and adds the `import.meta.glob` runtime URL map);
 * - the Main-process `serpent://app-assets` handler (`src/main/app-assets.ts`)
 *   whitelists file names and verifies sha256/size against this table, so a
 *   broken packaged asset fails loudly instead of rendering a corrupted sky.
 *
 * Acquisition metadata is replayed by `scripts/acquire-hdri.mjs`.
 */

export const BUNDLED_HDRI_PRESET_IDS = [
  'ferndale-studio-03',
  'dancing-hall',
  'pergola-walkway',
  'scythian-tombs-2',
] as const;

export type BundledHdriPresetId = (typeof BUNDLED_HDRI_PRESET_IDS)[number];
export type HdriPresetCategory = 'studio' | 'natural';

export type HdriPreset = {
  readonly id: BundledHdriPresetId;
  /** Bilingual label; `zh-CN` is the product primary language. */
  readonly displayName: Readonly<{ 'zh-CN': string; en: string }>;
  readonly category: HdriPresetCategory;
  /** File name under `src/renderer/assets/hdri/` (dev) / packaged renderer assets. */
  readonly fileName: string;
  /** Optional preview thumbnail (`*_preview.png`) shown in the HDRI picker. */
  readonly previewFileName?: string;
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
    id: 'ferndale-studio-03',
    displayName: { 'zh-CN': '产品', en: 'Product' },
    category: 'studio',
    fileName: 'ferndale_studio_03_1k.hdr',
    previewFileName: 'ferndale_studio_03_1k_preview.png',
    width: 1024,
    height: 512,
    fileSizeBytes: 1597780,
    sha256: '6ef28f78bc80056ef6fc4d15c5e730be81b61a3c7ae48bc5d8d33dc522d2b1de',
    sourceUrl: 'https://polyhaven.com/a/ferndale_studio_03',
    license: 'CC0',
  },
  {
    id: 'dancing-hall',
    displayName: { 'zh-CN': '室内', en: 'Indoor' },
    category: 'studio',
    fileName: 'dancing_hall_1k.hdr',
    previewFileName: 'dancing_hall_1k_preview.png',
    width: 1024,
    height: 512,
    fileSizeBytes: 1725266,
    sha256: 'e76e7838ae18cd32628143c6b8f1e92453d247a3e20dff773246c7c119ceb043',
    sourceUrl: 'https://polyhaven.com/a/dancing_hall',
    license: 'CC0',
  },
  {
    id: 'pergola-walkway',
    displayName: { 'zh-CN': '室外', en: 'Outdoor' },
    category: 'natural',
    fileName: 'pergola_walkway_1k.hdr',
    previewFileName: 'pergola_walkway_1k_preview.png',
    width: 1024,
    height: 512,
    fileSizeBytes: 1755642,
    sha256: '7f17a1ec2703b71cbf92a8387eb04c47ebd9f19f885065d26545a7190c85b456',
    sourceUrl: 'https://polyhaven.com/a/pergola_walkway',
    license: 'CC0',
  },
  {
    id: 'scythian-tombs-2',
    displayName: { 'zh-CN': '自然', en: 'Nature' },
    category: 'natural',
    fileName: 'scythian_tombs_2_1k.hdr',
    previewFileName: 'scythian_tombs_2_1k_preview.png',
    width: 1024,
    height: 512,
    fileSizeBytes: 1676908,
    sha256: '3a77faff212008b11b2bcf0ed955e44390e7637bedbcd479c3c9df27bbf931f8',
    sourceUrl: 'https://polyhaven.com/a/scythian_tombs_2',
    license: 'CC0',
  },
];

/** Look up a bundled preset by id; null when the id is not a bundled preset. */
export function getBundledHdriPreset(id: string): HdriPreset | null {
  return HDRI_PRESETS.find((preset) => preset.id === id) ?? null;
}
