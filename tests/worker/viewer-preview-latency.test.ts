import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { LibraryService, type LibraryServiceOptions } from '../../src/worker/library-service';
import { importNoConflict } from './import-no-conflict';

const VALID_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64',
);

const roots: string[] = [];
const services: LibraryService[] = [];

afterEach(() => {
  for (const service of services.splice(0)) service.closeAll();
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('viewer source preview latency', () => {
  it('does not wait for Sharp metadata before returning the native source', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-viewer-latency-'));
    roots.push(root);
    let releaseMetadata!: () => void;
    const metadataGate = new Promise<void>((resolve) => {
      releaseMetadata = resolve;
    });
    let metadataCalls = 0;
    const sharpFn = ((input: string | Buffer) => {
      void input;
      return {
        async metadata() {
          metadataCalls += 1;
          await metadataGate;
          return { space: 'srgb', hasProfile: false };
        },
      };
    }) as unknown as NonNullable<LibraryServiceOptions['sharpFn']>;
    const service = new LibraryService({ sharpFn });
    services.push(service);
    const created = service.createLibrary({ displayName: 'Viewer latency', selectedParentPath: root });
    const sourcePath = path.join(root, 'source.png');
    writeFileSync(sourcePath, VALID_PNG);
    importNoConflict(service, created.libraryId, sourcePath);
    const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;

    const first = await Promise.race([
      service.resolvePreviewArtifact(created.libraryId, asset.assetId),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 250)),
    ]);
    expect(first).not.toBeNull();
    // The colour-space probe is now admitted through the shared native-memory
    // budget. A free reservation still starts on the next microtask, so the
    // source response must win the race without requiring the probe to have
    // entered Sharp before the caller resumes.
    await vi.waitFor(() => expect(metadataCalls).toBeGreaterThan(0), {
      timeout: 1_000,
      interval: 5,
    });
    expect(first).toMatchObject({
      playbackMode: 'source',
      status: 'ready',
      colorSpacePending: true,
    });

    releaseMetadata();
    // Let the background probe publish its revision cache before the next
    // viewer poll. The second request should now carry the detected result.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const settled = await service.resolvePreviewArtifact(created.libraryId, asset.assetId);
    expect(settled.playbackMode).toBe('source');
    expect(settled.colorSpacePending).toBeUndefined();
    expect(settled.colorSpace).toMatchObject({ id: 'srgb_texture' });
  });
});
