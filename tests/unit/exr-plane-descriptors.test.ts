import { describe, expect, it } from 'vitest';

import { parseExrPlaneDescriptors } from '../../src/worker/library-service';

describe('parseExrPlaneDescriptors', () => {
  it('keeps OIIO subimage indexes and names renderer-safe', () => {
    expect(parseExrPlaneDescriptors(`
      hero.exr : OpenEXR 2048 x 1024
        subimage 0 (beauty)
        subimage 1 (depth)
        subimage 2
    `)).toEqual([
      { index: 0, label: 'Part 0: beauty' },
      { index: 1, label: 'Part 1: depth' },
      { index: 2, label: 'Part 2' },
    ]);
  });

  it('reads names from the metadata layout emitted by OIIO for multipart EXR files', () => {
    expect(parseExrPlaneDescriptors(`
      multipart.exr : 64 x 48, 3 channel, float openexr
       subimage  0:   64 x 48, 3 channel, float openexr
          name: "beauty"
          oiio:subimagename: "beauty"
       subimage  1:   64 x 48, 3 channel, float openexr
          name: "utility"
    `)).toEqual([
      { index: 0, label: 'Part 0: beauty' },
      { index: 1, label: 'Part 1: utility' },
    ]);
  });

  it('uses a safe Part 0 fallback for unfamiliar OIIO output', () => {
    expect(parseExrPlaneDescriptors('image: 1920 x 1080, 4 channels'))
      .toEqual([{ index: 0, label: 'Part 0' }]);
  });
});
