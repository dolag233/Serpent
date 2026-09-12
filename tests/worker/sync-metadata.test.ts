import { describe, expect, it } from 'vitest';

import {
  canonicalizeSyncAssetMetadata,
  metadataContentHash,
  parseSyncAssetMetadata,
} from '../../src/worker/sync/sync-metadata';

describe('sync metadata sidecar (GitHub #39 / Serpent-4ffae8)', () => {
  it('keeps human-only JSON identical to the previous sidecar format', () => {
    const json = canonicalizeSyncAssetMetadata({
      tags: ['角色'],
      description: '主角设定',
      rating: 4,
      favorite: true,
    });
    expect(json).toBe('{"tags":["角色"],"description":"主角设定","rating":4,"favorite":true}');
    expect(parseSyncAssetMetadata(json).ai).toBeUndefined();
  });

  it('round-trips the AI layer without mixing it into human tags', () => {
    const json = canonicalizeSyncAssetMetadata({
      tags: ['人手'],
      description: '人手简介',
      rating: 2,
      favorite: false,
      ai: {
        tags: ['风景', '夜景'],
        description: '城市夜景',
        rating: 5,
        modelId: 'gpt-4o',
        modelVersion: '2024-05-13',
      },
    });
    expect(json).toContain('"ai":');
    const parsed = parseSyncAssetMetadata(json);
    expect(parsed.tags).toEqual(['人手']);
    expect(parsed.description).toBe('人手简介');
    expect(parsed.rating).toBe(2);
    expect(parsed.ai).toEqual({
      tags: ['夜景', '风景'],
      description: '城市夜景',
      rating: 5,
      modelId: 'gpt-4o',
      modelVersion: '2024-05-13',
    });
  });

  it('ignores an empty AI object so hashes stay compatible with old remotes', () => {
    const withoutAi = metadataContentHash({
      tags: [],
      description: null,
      rating: 0,
      favorite: false,
    });
    const emptyAi = metadataContentHash({
      tags: [],
      description: null,
      rating: 0,
      favorite: false,
      ai: { tags: [], description: null, rating: null, modelId: '', modelVersion: '' },
    });
    expect(emptyAi).toBe(withoutAi);
    expect(parseSyncAssetMetadata('{"tags":[],"description":null,"rating":0,"favorite":false}').ai).toBeUndefined();
  });
});
