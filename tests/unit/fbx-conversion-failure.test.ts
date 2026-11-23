import { describe, expect, it, vi } from 'vitest';

import { convertFbxBuffer } from '../../src/worker/fbx/converter';
import { parseFbxBytes } from '../../src/worker/fbx/wasm-loader';

vi.mock('../../src/worker/fbx/wasm-loader', () => ({ parseFbxBytes: vi.fn() }));

describe('FBX conversion failure classification', () => {
  it.each([
    ['oom', 'out of memory packing result', 'FBX_LIMIT_EXCEEDED'],
    ['limits', 'too many triangles', 'FBX_LIMIT_EXCEEDED'],
    ['parse', 'not an FBX file', 'FBX_NOT_FBX'],
    ['internal', 'bridge output failed', 'FBX_CONVERSION_FAILED'],
  ])('preserves a %s failure as its actual category', async (code, message, errorCode) => {
    vi.mocked(parseFbxBytes).mockRejectedValueOnce(new Error(JSON.stringify({
      ok: false, code, message,
    })));
    expect(await convertFbxBuffer(Buffer.from('fixture'), { sourcePath: 'fixture.fbx' }))
      .toEqual({ ok: false, failure: { errorCode, reason: message } });
  });

  it('distinguishes WASM address space allocation from module availability', async () => {
    vi.mocked(parseFbxBytes).mockRejectedValueOnce(new Error('UFBX_WASM_OOM: bridge memory allocation failed'));
    expect(await convertFbxBuffer(Buffer.from('fixture'), { sourcePath: 'fixture.fbx' }))
      .toMatchObject({ ok: false, failure: { errorCode: 'FBX_LIMIT_EXCEEDED' } });
    vi.mocked(parseFbxBytes).mockRejectedValueOnce(new Error('UFBX_WASM_MISSING: not installed'));
    expect(await convertFbxBuffer(Buffer.from('fixture'), { sourcePath: 'fixture.fbx' }))
      .toMatchObject({ ok: false, failure: { errorCode: 'FBX_WASM_UNAVAILABLE' } });
  });

  it('preserves structured host ENOMEM even when its text has no resource keywords', async () => {
    vi.mocked(parseFbxBytes).mockRejectedValueOnce(Object.assign(new Error('native allocation failed'), {
      code: 'ENOMEM', errno: -12,
    }));
    expect(await convertFbxBuffer(Buffer.from('fixture'), { sourcePath: 'fixture.fbx' }))
      .toMatchObject({ ok: false, failure: { errorCode: 'FBX_RESOURCE_EXHAUSTED', reason: 'native allocation failed' } });
  });
});
