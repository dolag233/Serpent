import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

import {
  DEFAULT_HDRI_PRESET_ID,
  HDRI_PRESETS,
  getHdriPreset,
  isBundledHdriPresetId,
  parseHdriPresetId,
  resolveHdriBundleUrl,
  type HdriPreset,
} from '../../src/renderer/3d-viewer/hdri-presets';

/**
 * Absolute path of a bundled .hdr in this workspace. The glob URL returned
 * by resolveHdriBundleUrl is environment-shaped (dev server URL in vitest,
 * hashed asset URL in the packaged build), so on-disk verification resolves
 * relative to this test file instead of parsing the URL.
 */
function bundledAssetPath(preset: HdriPreset): string {
  return fileURLToPath(
    new URL(
      `../../src/renderer/assets/hdri/${preset.fileName}`,
      import.meta.url,
    ),
  );
}

describe('hdri-presets (Serpent-v363 / 3D-09)', () => {
  it('ships exactly the four user-selected studio + natural 1K CC0 presets', () => {
    expect(HDRI_PRESETS.map((preset) => preset.id)).toEqual([
      'ferndale-studio-03',
      'dancing-hall',
      'pergola-walkway',
      'scythian-tombs-2',
    ]);
    expect(new Set(HDRI_PRESETS.map((preset) => preset.category))).toEqual(
      new Set(['studio', 'natural']),
    );
  });

  it('keeps complete bilingual metadata on every preset', () => {
    for (const preset of HDRI_PRESETS) {
      expect(preset.displayName['zh-CN'].length).toBeGreaterThan(0);
      expect(preset.displayName.en.length).toBeGreaterThan(0);
      expect(preset.fileName.endsWith('_1k.hdr')).toBe(true);
      expect(preset.width).toBe(1024);
      expect(preset.height).toBe(512);
      expect(preset.fileSizeBytes).toBeGreaterThan(0);
      expect(preset.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(preset.sourceUrl).toMatch(/^https:\/\/polyhaven\.com\//);
      expect(preset.license).toBe('CC0');
    }
  });

  it('defaults to the studio preset and resolves presets by id', () => {
    expect(DEFAULT_HDRI_PRESET_ID).toBe('ferndale-studio-03');
    expect(getHdriPreset('ferndale-studio-03')?.category).toBe('studio');
    expect(getHdriPreset('pergola-walkway')?.category).toBe('natural');
    expect(getHdriPreset('custom')).toBeNull();
    expect(isBundledHdriPresetId('custom')).toBe(false);
    expect(isBundledHdriPresetId('scythian-tombs-2')).toBe(true);
  });

  it('resolves bundle URLs to the matching asset file', () => {
    for (const preset of HDRI_PRESETS) {
      const url = resolveHdriBundleUrl(preset);
      expect(url.length).toBeGreaterThan(0);
      expect(url).toContain(preset.fileName);
    }
  });

  it('bundled .hdr files match the recorded size, sha256 and decode as 1K RGBE', () => {
    for (const preset of HDRI_PRESETS) {
      const bytes = readFileSync(bundledAssetPath(preset));
      expect(bytes.byteLength).toBe(preset.fileSizeBytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(
        preset.sha256,
      );
      // Decode with the exact loader the viewer pipeline uses (r185 HDRLoader).
      const parsed = new HDRLoader().parse(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      );
      expect(parsed.width).toBe(preset.width);
      expect(parsed.height).toBe(preset.height);
    }
  });

  it('parses untrusted persisted preset ids with default fallback', () => {
    expect(parseHdriPresetId('dancing-hall')).toBe('dancing-hall');
    // Legacy ids from before the preset swap fall back to the default.
    expect(parseHdriPresetId('studio-small-09')).toBe(DEFAULT_HDRI_PRESET_ID);
    expect(parseHdriPresetId('custom')).toBe('custom');
    expect(parseHdriPresetId('not-a-preset')).toBe(DEFAULT_HDRI_PRESET_ID);
    expect(parseHdriPresetId(42)).toBe(DEFAULT_HDRI_PRESET_ID);
    expect(parseHdriPresetId(null)).toBe(DEFAULT_HDRI_PRESET_ID);
  });
});
