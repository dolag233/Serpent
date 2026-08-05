import { z } from 'zod';

import {
  HDRI_PRESETS,
  type BundledHdriPresetId,
  type HdriPreset,
} from '../../shared/hdri-presets';

/**
 * Bundled HDRI environment presets (spec 3D-09 / §5) — renderer surface.
 *
 * The preset receipt table (ids, display names, acquisition sha256/size)
 * lives in `src/shared/hdri-presets.ts` and is re-exported here unchanged;
 * this module adds the renderer-only pieces: the `custom` pseudo-id (user
 * picked `.hdr`, slice F), the persisted-value zod schema, and the runtime
 * bundle URL map built with `import.meta.glob` (`?url`).
 *
 * Two 1K (1024×512) equirectangular `.hdr` files from Poly Haven, CC0
 * (public domain — no attribution, no registration), bundled with the app:
 * one studio softbox set, one sunny outdoor set. Files live in
 * `src/renderer/assets/hdri/` and are emitted as build assets via
 * `import.meta.glob` (`?url`); see `vite.renderer.config.ts` `assetsInclude`.
 * The packaged viewer does NOT fetch these Vite URLs (file:// fetch is
 * blocked); it loads the same files through `serpent://app-assets/hdri/<name>`
 * (slice C, `src/main/app-assets.ts`).
 */

export { HDRI_PRESETS } from '../../shared/hdri-presets';
export type { BundledHdriPresetId, HdriPreset, HdriPresetCategory } from '../../shared/hdri-presets';

export const HDRI_PRESET_IDS: readonly [
  BundledHdriPresetId,
  BundledHdriPresetId,
  'custom',
] = [HDRI_PRESETS[0]!.id, HDRI_PRESETS[1]!.id, 'custom'];

export type HdriPresetId = (typeof HDRI_PRESET_IDS)[number];

/** Preset the viewer opens with (studio softbox matches DAM preview norms). */
export const DEFAULT_HDRI_PRESET_ID: BundledHdriPresetId = 'ferndale-studio-03';

export function isBundledHdriPresetId(id: HdriPresetId): id is BundledHdriPresetId {
  return id !== 'custom';
}

/** Look up a bundled preset; `custom` (user-picked file, slice F) returns null. */
export function getHdriPreset(id: HdriPresetId): HdriPreset | null {
  if (!isBundledHdriPresetId(id)) return null;
  return HDRI_PRESETS.find((preset) => preset.id === id) ?? null;
}

/**
 * Bundled asset URLs, keyed by `../assets/hdri/<fileName>` relative to this
 * module. Vite statically discovers the glob and emits each `.hdr` (and
 * `_preview.png` thumbnail) as a build asset; in vitest (node) the values
 * resolve to source file paths, which the unit tests read to verify size/hash
 * against disk.
 */
const hdriBundleUrls: Readonly<Record<string, string>> = import.meta.glob(
  '../assets/hdri/*',
  { eager: true, query: '?url', import: 'default' },
);

/** Resolve the runtime URL of a bundled preset's `.hdr` file. */
export function resolveHdriBundleUrl(preset: HdriPreset): string {
  const url = hdriBundleUrls[`../assets/hdri/${preset.fileName}`];
  if (!url) {
    throw new Error(
      `HDRI bundle asset not found for preset "${preset.id}" (${preset.fileName}). ` +
        'Was the file deleted from src/renderer/assets/hdri/?',
    );
  }
  return url;
}

/** Resolve the runtime URL of a preset's preview thumbnail, or null when none. */
export function resolveHdriPreviewUrl(preset: HdriPreset): string | null {
  if (preset.previewFileName === undefined) return null;
  return hdriBundleUrls[`../assets/hdri/${preset.previewFileName}`] ?? null;
}

/** Zod schema for persisting the selected preset id (viewer toolbar, slice C). */
export const hdriPresetIdSchema = z.enum(
  [...HDRI_PRESET_IDS] as unknown as [HdriPresetId, ...HdriPresetId[]],
);

/** Parse an untrusted persisted/input preset id, falling back to the default. */
export function parseHdriPresetId(input: unknown): HdriPresetId {
  const parsed = hdriPresetIdSchema.safeParse(input);
  return parsed.success ? parsed.data : DEFAULT_HDRI_PRESET_ID;
}
