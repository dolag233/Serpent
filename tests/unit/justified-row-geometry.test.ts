import { describe, expect, it } from 'vitest';

import {
  buildJustifiedGeometry,
  updateJustifiedGeometrySnapshot,
} from '../../src/renderer/browse/justified-row-geometry';
import type { BrowseLayoutEntry } from '../../src/shared/asset-types';

function fixtureEntries(total = 7): Map<number, BrowseLayoutEntry> {
  const entries = new Map<number, BrowseLayoutEntry>();
  const dimensions = [
    [120, 100], [160, 100], [90, 120], [130, 120],
    [180, 100], [110, 140], [150, 100],
  ];
  for (let index = 0; index < total; index += 1) {
    const [width, height] = dimensions[index % dimensions.length]!;
    entries.set(index, {
      assetId: `fixture-${index}`,
      width: width!,
      height: height!,
      mediaType: index % 2 === 0 ? 'image' : 'video',
    });
  }
  return entries;
}

function configuration(overrides: Partial<{
  total: number;
  itemsPerRow: number;
  availableWidth: number;
  targetHeight: number;
  captionBand: number | ((asset: { mediaType?: string | null; width?: number | null }) => number);
}> = {}) {
  return {
    total: 7,
    itemsPerRow: 2,
    availableWidth: 640,
    targetHeight: 150,
    captionBand: 24,
    ...overrides,
  };
}

function entryAt(entries: ReadonlyMap<number, BrowseLayoutEntry>, index: number): BrowseLayoutEntry {
  return entries.get(index) ?? { assetId: `__geometry__:${index}`, width: null, height: null };
}

function snapshotInput(
  entries: ReadonlyMap<number, BrowseLayoutEntry>,
  config = configuration(),
) {
  return { ...config, geometryEntries: entries };
}

describe('incremental justified row geometry snapshots', () => {
  it('matches the original full geometry for an initial snapshot, including its partial row', () => {
    const entries = fixtureEntries();
    const config = configuration();
    let captionCalls = 0;
    const captionBand = () => {
      captionCalls += 1;
      return 24;
    };
    const input = snapshotInput(entries, { ...config, captionBand });
    const snapshot = updateJustifiedGeometrySnapshot(input);
    const original = buildJustifiedGeometry({
      ...config,
      captionBand,
      entryAt: index => entryAt(entries, index),
    });

    expect(snapshot.rows).toEqual(original);
    expect(snapshot.rows).toHaveLength(4);
    expect(snapshot.rows[3]?.widths).toHaveLength(1);
    expect(captionCalls).toBe(14);
  });

  it('recomputes only the changed entry row and reuses other rows’ width arrays', () => {
    const previousEntries = fixtureEntries();
    let captionCalls = 0;
    const captionBand = () => {
      captionCalls += 1;
      return 24;
    };
    const config = configuration({ captionBand });
    const previous = updateJustifiedGeometrySnapshot(snapshotInput(previousEntries, config));
    const nextEntries = new Map(previousEntries);
    nextEntries.set(0, { ...previousEntries.get(0)!, width: 240, height: 100 });
    captionCalls = 0;

    const next = updateJustifiedGeometrySnapshot(snapshotInput(nextEntries, config), previous);

    expect(captionCalls).toBe(2);
    expect(next.rows[0]?.widths).not.toBe(previous.rows[0]?.widths);
    expect(next.rows[1]?.widths).toBe(previous.rows[1]?.widths);
    expect(next.rows[2]?.widths).toBe(previous.rows[2]?.widths);
    expect(next.rows[3]?.widths).toBe(previous.rows[3]?.widths);
  });

  it('invalidates a changed row once when several entries in that row change', () => {
    const previousEntries = fixtureEntries();
    let captionCalls = 0;
    const captionBand = () => {
      captionCalls += 1;
      return 24;
    };
    const config = configuration({ captionBand });
    const previous = updateJustifiedGeometrySnapshot(snapshotInput(previousEntries, config));
    const nextEntries = new Map(previousEntries);
    nextEntries.set(0, { ...previousEntries.get(0)!, width: 240 });
    nextEntries.set(1, { ...previousEntries.get(1)!, height: 160 });
    captionCalls = 0;

    const next = updateJustifiedGeometrySnapshot(snapshotInput(nextEntries, config), previous);

    expect(captionCalls).toBe(2);
    expect(next.rows[0]?.widths).not.toBe(previous.rows[0]?.widths);
    expect(next.rows[1]?.widths).toBe(previous.rows[1]?.widths);
  });

  it('recomputes the affected row when an entry media type changes', () => {
    const previousEntries = fixtureEntries();
    let captionCalls = 0;
    const captionBand = (asset: { mediaType?: string | null }) => {
      captionCalls += 1;
      return asset.mediaType === 'audio' ? 42 : asset.mediaType === 'video' ? 24 : 10;
    };
    const config = configuration({ captionBand });
    const previous = updateJustifiedGeometrySnapshot(snapshotInput(previousEntries, config));
    const nextEntries = new Map(previousEntries);
    nextEntries.set(0, { ...previousEntries.get(0)!, mediaType: 'audio' });
    captionCalls = 0;

    const next = updateJustifiedGeometrySnapshot(snapshotInput(nextEntries, config), previous);

    expect(captionCalls).toBe(2);
    expect(next.rows[0]?.captionBand).toBe(42);
    expect(next.rows[1]?.widths).toBe(previous.rows[1]?.widths);
  });

  it('invalidates every row when the caption resolver identity changes', () => {
    const entries = fixtureEntries();
    const firstResolver = () => 20;
    const previous = updateJustifiedGeometrySnapshot(snapshotInput(
      entries,
      configuration({ captionBand: firstResolver }),
    ));
    let captionCalls = 0;
    const nextResolver = () => {
      captionCalls += 1;
      return 28;
    };

    const next = updateJustifiedGeometrySnapshot(snapshotInput(
      entries,
      configuration({ captionBand: nextResolver }),
    ), previous);

    expect(captionCalls).toBe(7);
    expect(next.rows.map(row => row.captionBand)).toEqual([28, 28, 28, 28]);
    expect(next.rows.every((row, index) => row.widths !== previous.rows[index]?.widths)).toBe(true);
  });

  it('fully invalidates cached rows when total, columns, width, or target height changes', () => {
    const changes: Array<Partial<ReturnType<typeof configuration>>> = [
      { total: 5 },
      { itemsPerRow: 3 },
      { availableWidth: 760 },
      { targetHeight: 190 },
    ];
    for (const change of changes) {
      const entries = fixtureEntries();
      let captionCalls = 0;
      const captionBand = () => {
        captionCalls += 1;
        return 24;
      };
      const previousConfig = configuration({ captionBand });
      const previous = updateJustifiedGeometrySnapshot(snapshotInput(entries, previousConfig));
      const nextConfig = configuration({ ...change, captionBand });
      captionCalls = 0;

      const next = updateJustifiedGeometrySnapshot(snapshotInput(entries, nextConfig), previous);

      expect(captionCalls).toBe(nextConfig.total);
      expect(next.rows.every((row, index) => row.widths !== previous.rows[index]?.widths)).toBe(true);
      if (change.total !== undefined) {
        expect(next.rows).toHaveLength(3);
        expect(next.rows[2]?.widths).toHaveLength(1);
      }
    }
  });

  it('keeps a committed snapshot intact when candidates branch from and are discarded', () => {
    const originalEntries = fixtureEntries();
    const config = configuration();
    const original = updateJustifiedGeometrySnapshot(snapshotInput(originalEntries, config));
    const originalState = original.rows.map(row => ({ offset: row.offset, widths: [...row.widths] }));

    const candidateEntries = new Map(originalEntries);
    candidateEntries.set(0, { ...originalEntries.get(0)!, width: 300 });
    const discarded = updateJustifiedGeometrySnapshot(snapshotInput(candidateEntries, config), original);
    expect(discarded.rows[0]?.widths).not.toBe(original.rows[0]?.widths);
    expect(original.rows.map(row => ({ offset: row.offset, widths: [...row.widths] }))).toEqual(originalState);

    const committedEntries = new Map(originalEntries);
    committedEntries.set(4, { ...originalEntries.get(4)!, height: 200 });
    const committed = updateJustifiedGeometrySnapshot(snapshotInput(committedEntries, config), original);

    expect(committed.rows[0]?.widths).toBe(original.rows[0]?.widths);
    expect(committed.rows[2]?.widths).not.toBe(original.rows[2]?.widths);
    expect(original.rows.map(row => ({ offset: row.offset, widths: [...row.widths] }))).toEqual(originalState);
    expect(committed.rows).toEqual(buildJustifiedGeometry({
      ...config,
      entryAt: index => entryAt(committedEntries, index),
    }));
  });

  it('uses a placeholder when a geometry entry is removed', () => {
    const previousEntries = fixtureEntries();
    let captionCalls = 0;
    const captionBand = (asset: { width?: number | null; mediaType?: string | null }) => {
      captionCalls += 1;
      return asset.width == null && asset.mediaType == null ? 36 : 24;
    };
    const config = configuration({ captionBand });
    const previous = updateJustifiedGeometrySnapshot(snapshotInput(previousEntries, config));
    const nextEntries = new Map(previousEntries);
    nextEntries.delete(1);
    captionCalls = 0;

    const next = updateJustifiedGeometrySnapshot(snapshotInput(nextEntries, config), previous);

    expect(captionCalls).toBe(2);
    expect(next.rows[0]?.captionBand).toBe(36);
    expect(next.geometryEntries.has(1)).toBe(false);
    expect(next.rows).toEqual(buildJustifiedGeometry({
      ...config,
      entryAt: index => entryAt(nextEntries, index),
    }));
  });
});
