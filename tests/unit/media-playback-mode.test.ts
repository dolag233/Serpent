import { translateForLocale } from '../../src/renderer/i18n';
import { describe, expect, it, vi } from 'vitest';
import type { AssetSummary } from '../../src/shared/asset-types';
import { findNextSiblingMedia, isSiblingMedia, loadMediaPlaybackMode, nextMediaPlaybackMode, saveMediaPlaybackMode } from '../../src/renderer/media-playback-mode';

function asset(assetId: string, overrides: Partial<AssetSummary> = {}): AssetSummary {
  return { assetId, locationKind: 'managed', managedFolderId: 'folder', relativeFilePath: `folder/${assetId}.mp4`, mediaType: 'video', availability: 'available', deletedAt: null, ...overrides } as AssetSummary;
}

describe('media playback modes and complete-list navigation', () => {
  it('cycles stop, repeat one, sequential and remembers the choice', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    expect(loadMediaPlaybackMode(storage)).toBe('repeat-one');
    expect(nextMediaPlaybackMode('stop')).toBe('repeat-one');
    expect(nextMediaPlaybackMode('repeat-one')).toBe('sequential');
    expect(nextMediaPlaybackMode('sequential')).toBe('stop');
    saveMediaPlaybackMode('sequential', storage);
    expect(loadMediaPlaybackMode(storage)).toBe('sequential');
    expect(loadMediaPlaybackMode({ getItem: () => 'invalid' })).toBe('repeat-one');
  });

  it('accepts audio and video siblings, skips images, missing files, deleted assets and sequences', () => {
    const current = asset('current');
    expect(isSiblingMedia(current, asset('audio', { mediaType: 'audio' }))).toBe(true);
    for (const overrides of [{ mediaType: 'image' as const }, { availability: 'missing' as const }, { deletedAt: 'now' }, { managedFolderId: 'other' }, { relativeFilePath: 'folder/nested/video.mp4' }]) {
      expect(isSiblingMedia(current, asset('skip', overrides))).toBe(false);
    }
  });

  it('keeps linked directory and root identities separate', () => {
    const current = asset('current', { locationKind: 'linked', managedFolderId: null, linkedFolderId: 'root-a' });
    expect(isSiblingMedia(current, asset('other', { locationKind: 'linked', managedFolderId: null, linkedFolderId: 'root-b' }))).toBe(false);
  });

  it('finds the next sibling past an unloaded page and respects order even if the backend returns reversed rows', async () => {
    const ids = ['current', ...Array.from({ length: 104 }, (_, i) => `image${i}`), 'next', 'later'];
    const load = vi.fn(async (batch: string[]) => batch.toReversed().map(id => asset(id, { mediaType: id.startsWith('image') ? 'image' : 'video' })));
    const next = await findNextSiblingMedia({ current: asset('current'), orderedIds: ids, load, isCurrent: () => true });
    expect(next?.assetId).toBe('next');
    expect(load).toHaveBeenCalledTimes(2);
    expect(load.mock.calls[0]![0]).toHaveLength(100);
  });

  it('stops at the end and ignores stale navigation results', async () => {
    const current = asset('current');
    const load = vi.fn(async () => [asset('next')]);
    expect(await findNextSiblingMedia({ current, orderedIds: ['current'], load, isCurrent: () => true })).toBeNull();
    expect(load).not.toHaveBeenCalled();
    let active = true;
    expect(await findNextSiblingMedia({ current, orderedIds: ['current', 'next'], load: async () => { active = false; return [asset('next')]; }, isCurrent: () => active })).toBeNull();
  });
});

it('provides playback mode labels in both supported languages', () => {
  for (const locale of ['zh-CN', 'en'] as const) {
    for (const mode of ['stop', 'repeat-one', 'sequential']) {
      const label = translateForLocale(locale, `preview.playbackModes.${mode}`);
      expect(label).not.toContain('preview.');
      expect(translateForLocale(locale, 'preview.playbackMode', { mode: label })).toContain(label);
    }
  }
});
