import { describe, expect, it } from 'vitest';

import { summarizeCpuProfileWork } from '../e2e/cpu-profile-work-summary';

describe('anonymous CPU profile work summary', () => {
  it('separates self samples from ancestor-inclusive samples and labels sample intervals', () => {
    const result = summarizeCpuProfileWork({
      nodes: [
        { id: 1, callFrame: { functionName: 'appRoot', url: 'assets/app.js', lineNumber: 1, columnNumber: 0 }, children: [2], hitCount: 91 },
        { id: 2, callFrame: { functionName: 'renderCard', url: 'assets/app.js', lineNumber: 8, columnNumber: 3 }, hitCount: 77 },
      ],
      samples: [2, 2],
      timeDeltas: [100, 150],
    });

    expect(result).toMatchObject({
      status: 'complete',
      timingBasis: 'sample-intervals-not-cpu-time',
      sampleCount: 2,
      processedSampleCount: 2,
      validSampleCount: 2,
      sampleIntervalUs: 250,
    });
    expect(result.self).toEqual([{
      functionName: 'renderCard', source: 'bundle', line: 8, column: 3,
      samples: 2, sampleIntervalUs: 250,
    }]);
    expect(result.inclusive).toEqual(expect.arrayContaining([
      expect.objectContaining({ functionName: 'appRoot', samples: 2, sampleIntervalUs: 250 }),
      expect.objectContaining({ functionName: 'renderCard', samples: 2, sampleIntervalUs: 250 }),
    ]));
  });

  it('keeps same-named functions separate when source positions differ', () => {
    const result = summarizeCpuProfileWork({
      nodes: [
        { id: 10, callFrame: { functionName: 'root', url: 'assets/app.js', lineNumber: 1, columnNumber: 0 }, children: [11, 12] },
        { id: 11, callFrame: { functionName: 'drawTile', url: 'assets/app.js', lineNumber: 14, columnNumber: 2 } },
        { id: 12, callFrame: { functionName: 'drawTile', url: 'assets/app.js', lineNumber: 22, columnNumber: 2 } },
      ],
      samples: [11, 12],
      timeDeltas: [40, 60],
    });

    expect(result.self).toHaveLength(2);
    expect(result.self.map(row => [row.functionName, row.line, row.column, row.samples]))
      .toEqual([['drawTile', 22, 2, 1], ['drawTile', 14, 2, 1]]);
  });

  it('counts a recursive function location once per sample in inclusive totals', () => {
    const result = summarizeCpuProfileWork({
      nodes: [
        { id: 1, callFrame: { functionName: 'renderRoot', url: 'assets/app.js', lineNumber: 1, columnNumber: 0 }, children: [2] },
        { id: 2, callFrame: { functionName: 'walkTree', url: 'assets/app.js', lineNumber: 31, columnNumber: 7 }, children: [3] },
        { id: 3, callFrame: { functionName: 'walkTree', url: 'assets/app.js', lineNumber: 31, columnNumber: 7 } },
      ],
      samples: [3, 3, 2],
      timeDeltas: [100, 200, 300],
    });

    const recursive = result.inclusive.find(row => row.functionName === 'walkTree');
    expect(result.sampleCount).toBe(3);
    expect(recursive?.samples).toBe(3);
    expect(recursive?.samples).toBeLessThanOrEqual(result.sampleCount!);
    expect(recursive?.sampleIntervalUs).toBe(600);
  });

  it('does not return profile URLs, source IDs, or node IDs', () => {
    const result = summarizeCpuProfileWork({
      nodes: [{
        id: 987654321,
        callFrame: {
          functionName: 'invokeRender',
          url: 'https://example.invalid/assets/PRIVATE_PROFILE_TOKEN.js?sourceId=PRIVATE_PROFILE_ID',
          lineNumber: 4,
          columnNumber: 5,
        },
      }],
      samples: [987654321],
      timeDeltas: [30],
    });
    const serialized = JSON.stringify(result);

    expect(result.self[0]?.source).toBe('bundle');
    expect(serialized).not.toContain('PRIVATE_PROFILE_TOKEN');
    expect(serialized).not.toContain('PRIVATE_PROFILE_ID');
    expect(serialized).not.toContain('987654321');
  });

  it('marks missing samples and time deltas explicitly instead of reporting zero work', () => {
    const result = summarizeCpuProfileWork({
      nodes: [{ id: 1, callFrame: { functionName: 'root', url: '', lineNumber: 0, columnNumber: 0 } }],
    });

    expect(result).toMatchObject({
      status: 'incomplete',
      sampleCount: null,
      processedSampleCount: 0,
      validSampleCount: 0,
      sampleIntervalUs: null,
      missingSamples: true,
      missingTimeDeltas: true,
      self: [],
      inclusive: [],
    });
  });

  it('reports invalid parent graphs and unknown samples without inventing inclusive counts', () => {
    const result = summarizeCpuProfileWork({
      nodes: [
        { id: 1, callFrame: { functionName: 'rootA', url: '', lineNumber: 0, columnNumber: 0 }, children: [2] },
        { id: 2, callFrame: { functionName: 'shared', url: '', lineNumber: 1, columnNumber: 0 } },
        { id: 3, callFrame: { functionName: 'rootB', url: '', lineNumber: 0, columnNumber: 0 }, children: [2, 999] },
        { id: 4, callFrame: { functionName: 'cycleA', url: '', lineNumber: 3, columnNumber: 0 }, children: [5] },
        { id: 5, callFrame: { functionName: 'cycleB', url: '', lineNumber: 4, columnNumber: 0 }, children: [4] },
      ],
      samples: [2, 4, 777],
      timeDeltas: [10, 20, 30],
    });

    expect(result.status).toBe('invalid');
    expect(result.invalid).toMatchObject({
      unknownChildren: 1,
      multipleParents: 1,
      cycles: 1,
      unknownSamples: 1,
    });
    expect(result.validSampleCount).toBe(2);
    expect(result.inclusive).toEqual([]);
  });
});
