import { describe, expect, it, vi } from 'vitest';

import type { LibraryService } from '../../src/worker/library-service';
import { handleFbxConvertCommand } from '../../src/worker/fbx/convert-command';
import { convertFbxToGlb, type ConvertFbxOutput } from '../../src/worker/fbx/converter';

vi.mock('../../src/worker/fbx/converter', () => ({
  convertFbxToGlb: vi.fn(), resolveConvertedGlb: () => null,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}

describe('FBX single-flight cancellation ownership', () => {
  it('replaces a cancelled conversion while its runtime exits and keeps new waiters together', async () => {
    type Result = Awaited<ReturnType<typeof convertFbxToGlb>>;
    const old = deferred<Result>();
    const fresh = deferred<Result>();
    const signals: AbortSignal[] = [];
    vi.mocked(convertFbxToGlb).mockImplementationOnce(input => {
      signals.push(input.signal!);
      return old.promise;
    }).mockImplementationOnce(input => {
      signals.push(input.signal!);
      return fresh.promise;
    });
    const write = vi.fn(() => ({ artifactId: 'fresh-artifact', filePath: 'fresh.glb' }));
    const service = {
      resolveAssetPath: () => 'model.fbx', writeDerivedArtifact: write, reportDiagnostic: vi.fn(),
    } as unknown as LibraryService;
    const command = { libraryId: 'fixture-library', assetId: 'fixture-model' };
    const caller = new AbortController();
    const calls: Array<Promise<Awaited<ReturnType<typeof handleFbxConvertCommand>>>> = [];
    try {
      const first = handleFbxConvertCommand(service, command, caller.signal);
      calls.push(first);
      const cancelled = expect(first).rejects.toThrow('navigation changed');
      caller.abort(new Error('navigation changed'));
      await cancelled;
      expect(signals[0]?.aborted).toBe(true);

      const second = handleFbxConvertCommand(service, command);
      calls.push(second);
      expect(convertFbxToGlb).toHaveBeenCalledTimes(2);
      expect(signals[1]?.aborted).toBe(false);
      old.reject(new Error('All FBX conversion waiters cancelled.'));
      // Let the old entry's cleanup run while the replacement is still active.
      await new Promise<void>(resolve => setImmediate(resolve));
      const third = handleFbxConvertCommand(service, command);
      calls.push(third);
      expect(convertFbxToGlb).toHaveBeenCalledTimes(2);
      const output: ConvertFbxOutput = {
        glb: Buffer.from('fixture'), warnings: [], missingTextures: [], sourceUnitMeters: 1,
        stats: { triangles: 1, vertices: 3, meshes: 1, instances: 1, materials: 1, textures: 0,
          missingTextures: 0, sourceBytes: 4, glbBytes: 7, sourceUnitMeters: 1 },
      };
      fresh.resolve({ ok: true, output });
      const results = await Promise.all([second, third]);
      expect(results).toEqual([
        expect.objectContaining({ status: 'ready', glbArtifactId: 'fresh-artifact' }),
        expect.objectContaining({ status: 'ready', glbArtifactId: 'fresh-artifact' }),
      ]);
      expect(write).toHaveBeenCalledTimes(1);
    } finally {
      old.reject(new Error('fixture cleanup'));
      fresh.reject(new Error('fixture cleanup'));
      await Promise.allSettled(calls);
    }
  });
});
