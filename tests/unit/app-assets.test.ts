import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createAppAssetResponse,
  resetVerifiedAppAssetPathsForTest,
  resolveAppAssetFile,
  type AppAssetFs,
} from '../../src/main/app-assets';
import { HDRI_PRESETS } from '../../src/shared/hdri-presets';

beforeEach(() => {
  resetVerifiedAppAssetPathsForTest();
});

function fakeFs(overrides: Partial<AppAssetFs> = {}): AppAssetFs {
  return {
    listDirectory: () => [],
    fileExists: () => false,
    readFileBytes: () => null,
    ...overrides,
  };
}

/** Real bundled .hdr bytes — their sha256 matches the shared receipt. */
function receiptBytes(fileName: string): Buffer {
  return readFileSync(
    fileURLToPath(
      new URL(`../../src/renderer/assets/hdri/${fileName}`, import.meta.url),
    ),
  );
}

/** A fake store keyed by absolute path, with receipt-matching content. */
function storeWith(presetFiles: Record<string, Buffer>): AppAssetFs {
  return fakeFs({
    fileExists: (file) => file in presetFiles,
    readFileBytes: (file) => presetFiles[file] ?? null,
  });
}

describe('app-assets (Serpent-qvc6 / packaged .hdr route)', () => {
  it('resolves dev-mode files straight from src/renderer/assets/hdri', () => {
    const preset = HDRI_PRESETS[0]!;
    const fs = fakeFs({ fileExists: () => true });
    const resolved = resolveAppAssetFile({
      route: `hdri/${preset.fileName}`,
      appPath: '/app',
      isPackaged: false,
      fs,
    });
    expect(resolved).toBe(
      path.join('/app', 'src', 'renderer', 'assets', 'hdri', preset.fileName),
    );
  });

  it('resolves packaged files by scanning the hashed asset directory', () => {
    const preset = HDRI_PRESETS[1]!;
    const base = preset.fileName.replace(/\.hdr$/u, '');
    const fs = fakeFs({
      listDirectory: () => ['index-abc.js', `${base}-Ab3_c9dEf12Gh.waerth.dr`, `${base}-0123456789abcdef.hdr`],
      fileExists: (file) => file.endsWith(`${base}-0123456789abcdef.hdr`),
    });
    const resolved = resolveAppAssetFile({
      route: `hdri/${preset.fileName}`,
      appPath: '/app',
      isPackaged: true,
      fs,
    });
    expect(resolved).toBe(
      path.join(
        '/app',
        '.vite',
        'renderer',
        'main_window',
        'assets',
        `${base}-0123456789abcdef.hdr`,
      ),
    );
  });

  it('rejects unknown routes, nested paths, and unknown file names', () => {
    const fs = fakeFs();
    for (const route of [
      'hdri/unknown.hdr',
      'evil.txt',
      'hdri/../secret.txt',
      'hdri/a/b.hdr',
      'hdri/%2e%2e/x.hdr',
      '',
    ]) {
      expect(
        resolveAppAssetFile({ route, appPath: '/app', isPackaged: false, fs }),
      ).toBeNull();
    }
  });

  it('serves a verified dev-mode asset as a Response with the Radiance mime', async () => {
    const preset = HDRI_PRESETS[0]!;
    const bytes = receiptBytes(preset.fileName);
    const assetPath = path.join('/app', 'src', 'renderer', 'assets', 'hdri', preset.fileName);
    const fs = storeWith({ [assetPath]: bytes });
    const response = createAppAssetResponse({
      route: `hdri/${preset.fileName}`,
      appPath: '/app',
      isPackaged: false,
      fs,
    });
    expect(response).not.toBeNull();
    expect(response?.headers.get('content-type')).toBe('image/vnd.radiance');
    const body = new Uint8Array(await response!.arrayBuffer());
    expect(body.byteLength).toBe(preset.fileSizeBytes);
  });

  it('rejects bytes that fail the sha256 receipt check', async () => {
    const preset = HDRI_PRESETS[0]!;
    const assetPath = path.join('/app', 'src', 'renderer', 'assets', 'hdri', preset.fileName);
    const fs = storeWith({
      [assetPath]: Buffer.alloc(preset.fileSizeBytes, 0xff),
    });
    const response = createAppAssetResponse({
      route: `hdri/${preset.fileName}`,
      appPath: '/app',
      isPackaged: false,
      fs,
    });
    expect(response).toBeNull();
  });

  it('rejects assets with the wrong byte size', async () => {
    const preset = HDRI_PRESETS[0]!;
    const assetPath = path.join('/app', 'src', 'renderer', 'assets', 'hdri', preset.fileName);
    const fs = storeWith({
      [assetPath]: Buffer.alloc(64, 0xab),
    });
    const response = createAppAssetResponse({
      route: `hdri/${preset.fileName}`,
      appPath: '/app',
      isPackaged: false,
      fs,
    });
    expect(response).toBeNull();
  });
});
