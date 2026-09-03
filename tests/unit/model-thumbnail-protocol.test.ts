import { describe, expect, it } from 'vitest';

import {
  MODEL_THUMBNAIL_DEFAULT_EDGE,
  MODEL_THUMBNAIL_GENERATOR_VERSION,
  modelThumbnailFormatForFileName,
  modelThumbnailRenderRequestSchema,
  modelThumbnailRenderResponseSchema,
  parseModelThumbnailRenderRequest,
} from '../../src/shared/model-thumbnail-protocol';

function validJob() {
  return {
    type: 'model-thumbnail.render-request' as const,
    requestId: 'req-1',
    libraryId: 'lib-1',
    assetId: 'asset-1',
    revisionId: 'rev-1',
    format: 'glb' as const,
    renderUrl: 'serpent://preview/lib-1/artifact-1',
    companionMap: [{
      relativeFilePath: 'props/robot.fbm/albedo.png',
      assetId: 'asset-2',
      revisionId: 'rev-2',
      extension: '.png',
    }],
    hdriPresetId: 'studio-small-09',
    width: MODEL_THUMBNAIL_DEFAULT_EDGE,
    height: MODEL_THUMBNAIL_DEFAULT_EDGE,
  };
}

describe('model-thumbnail render protocol (slice E)', () => {
  it('parses a valid render request (worker → main)', () => {
    const parsed = parseModelThumbnailRenderRequest(validJob());
    expect(parsed.format).toBe('glb');
    expect(parsed.companionMap).toHaveLength(1);
  });

  it('accepts every model format and companion payload shape', () => {
    for (const format of ['glb', 'gltf', 'fbx', 'obj', 'stl']) {
      const parsed = modelThumbnailRenderRequestSchema.safeParse({
        ...validJob(),
        format,
        companionMap: [],
      });
      expect(parsed.success, format).toBe(true);
    }
  });

  it('rejects malformed requests (missing fields, bad dimensions, traversal)', () => {
    const cases: unknown[] = [
      { ...validJob(), renderUrl: undefined },
      { ...validJob(), width: 8 },
      { ...validJob(), width: 99999 },
      { ...validJob(), companionMap: [{ relativeFilePath: '../escape.png', assetId: 'a' }] },
      { ...validJob(), companionMap: 'not-an-array' },
      { ...validJob(), format: 'blend' },
    ];
    for (const input of cases) {
      expect(modelThumbnailRenderRequestSchema.safeParse(input).success, JSON.stringify(input)).toBe(false);
    }
  });

  it('round-trips a successful render response with PNG bytes (main → worker)', () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const parsed = modelThumbnailRenderResponseSchema.parse({
      type: 'model-thumbnail.render-response',
      requestId: 'req-1',
      result: { status: 'ok', pngBytes, width: 512, height: 512 },
    });
    if (parsed.result.status === 'ok' && 'pngBytes' in parsed.result) {
      expect(parsed.result.pngBytes).toBeInstanceOf(Uint8Array);
      expect(parsed.result.pngBytes[0]).toBe(0x89);
      expect(parsed.result.width).toBe(512);
    } else {
      throw new Error('expected an ok render result');
    }
  });

  it('round-trips a typed failure response', () => {
    const parsed = modelThumbnailRenderResponseSchema.parse({
      type: 'model-thumbnail.render-response',
      requestId: 'req-2',
      result: { status: 'failed', errorCode: 'MODEL_LOAD_FAILED', reason: 'synthetic load failure' },
    });
    expect(parsed.result.status).toBe('failed');
  });

  it('rejects unknown failure codes', () => {
    expect(modelThumbnailRenderResponseSchema.safeParse({
      type: 'model-thumbnail.render-response',
      requestId: 'req-3',
      result: { status: 'failed', errorCode: 'SOMETHING_ELSE' },
    }).success).toBe(false);
  });

  it('maps file names to formats like the loader registry', () => {
    expect(modelThumbnailFormatForFileName('robot.FBX')).toBe('fbx');
    expect(modelThumbnailFormatForFileName('chair.glb')).toBe('glb');
    expect(modelThumbnailFormatForFileName('scene.obj')).toBe('obj');
    expect(modelThumbnailFormatForFileName('part.stl')).toBe('stl');
    expect(modelThumbnailFormatForFileName('mesh.gltf')).toBe('gltf');
    expect(modelThumbnailFormatForFileName('notes.txt')).toBeNull();
    expect(modelThumbnailFormatForFileName('no-extension')).toBeNull();
  });

  it('exposes slice constants used by the queue and renderer', () => {
    expect(MODEL_THUMBNAIL_DEFAULT_EDGE).toBe(512);
    expect(MODEL_THUMBNAIL_GENERATOR_VERSION).toBe('offscreen-webgl-1');
  });
});
