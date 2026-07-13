import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';

const temporaryRoots: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'serpent-test-extension-'));
  temporaryRoots.push(dir);
  return dir;
}

function createTestLibrary(options?: ConstructorParameters<typeof LibraryService>[0]): { service: LibraryService; libraryId: string } {
  const libraryPath = tempDir();
  const service = new LibraryService(options);
  const library = service.createLibrary({
    displayName: `test-${randomUUID()}`,
    selectedParentPath: libraryPath,
  });
  // Open the library we just created (it was auto-opened by createLibrary)
  service.closeLibrary(library.libraryId);
  const opened = service.openLibrary(
    path.join(libraryPath, library.displayName),
  );
  return { service, libraryId: opened.libraryId };
}

function stubFetch(
  options: {
    status?: number;
    contentType?: string;
    body?: Uint8Array;
    error?: Error;
    contentDisposition?: string;
    contentLength?: string;
    location?: string;
    chunks?: Uint8Array[];
  } = {},
): void {
  const {
    status = 200,
    contentType = 'image/png',
    body,
    error,
    contentDisposition,
    contentLength,
    location,
    chunks,
  } = options;

  if (error) {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error));
    return;
  }

  const defaultBody = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG header
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  ]);

  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({
        'content-type': contentType,
        ...(contentDisposition ? { 'content-disposition': contentDisposition } : {}),
        ...(contentLength ? { 'content-length': contentLength } : {}),
        ...(location ? { location } : {}),
      }),
      body: {
        getReader() {
          const values = chunks ?? [body ?? defaultBody];
          let index = 0;
          return {
            read() {
              if (index >= values.length) return Promise.resolve({ done: true, value: undefined });
              return Promise.resolve({ done: false, value: values[index++] });
            },
            cancel: vi.fn(),
          };
        },
      },
    }),
  );
}

function unstubFetch(): void {
  vi.unstubAllGlobals();
}

describe('saveAssetFromUrl', () => {
  let service: LibraryService;
  let libraryId = '';

  beforeEach(() => {
    const lib = createTestLibrary({
      dnsLookup: async () => [{ address: '203.0.113.10', family: 4 }],
    });
    service = lib.service;
    libraryId = lib.libraryId;
  });

  afterEach(() => {
    try {
      service.closeAll();
    } catch {
      // Best effort.
    }
    unstubFetch();
    vi.useRealTimers();
    for (const root of temporaryRoots.splice(0)) {
      try { rmSync(root, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it('downloads an image and imports it as a managed asset', async () => {
    stubFetch({ contentType: 'image/png' });

    const result = await service.saveAssetFromUrl({
      libraryId,
      sourcePageUrl: 'https://example.com/gallery',
      mediaUrl: 'https://example.com/photo.png',
    });

    expect(result.asset).toBeDefined();
    expect(result.asset.assetId).toBeTruthy();
    expect(result.asset.displayName).toBe('photo.png');
    expect(result.asset.availability).toBe('available');

    // Verify the asset appears in the listing.
    const assets = service.listAssets({ libraryId, recursive: true });
    expect(assets).toHaveLength(1);
    expect(assets[0]!.assetId).toBe(result.asset.assetId);

    // Verify source_page_url metadata was set.
    const metadata = service.getAssetMetadata({ libraryId, assetId: result.asset.assetId });
    expect(metadata.sourcePageUrl).toBe('https://example.com/gallery');
  });

  it('downloads a video with mediaType and sets correct filename', async () => {
    stubFetch({ contentType: 'video/mp4' });

    const result = await service.saveAssetFromUrl({
      libraryId,
      sourcePageUrl: 'https://example.com/watch',
      mediaUrl: 'https://example.com/clip.mp4',
      mediaType: 'video/mp4',
    });

    expect(result.asset.displayName).toBe('clip.mp4');
    expect(result.asset.availability).toBe('available');
  });

  it('uses Content-Disposition filename when present', async () => {
    stubFetch({
      contentType: 'image/jpeg',
      contentDisposition: 'attachment; filename="renamed.jpg"',
    });

    const result = await service.saveAssetFromUrl({
      libraryId,
      sourcePageUrl: 'https://example.com/page',
      mediaUrl: 'https://example.com/some-id/raw',
    });

    expect(result.asset.displayName).toBe('renamed.jpg');
  });

  it('derives extension from Content-Type when URL has no extension', async () => {
    stubFetch({ contentType: 'image/webp' });

    const result = await service.saveAssetFromUrl({
      libraryId,
      sourcePageUrl: 'https://example.com/page',
      mediaUrl: 'https://example.com/raw-image',
    });

    expect(result.asset.displayName).toBe('raw-image.webp');
  });

  it('rejects non-2xx HTTP responses', async () => {
    stubFetch({ status: 404, contentType: 'text/html' });

    await expect(
      service.saveAssetFromUrl({
        libraryId,
        sourcePageUrl: 'https://example.com/page',
        mediaUrl: 'https://example.com/not-found.png',
      }),
    ).rejects.toThrow();

    // No asset should exist.
    const assets = service.listAssets({ libraryId, recursive: true });
    expect(assets).toHaveLength(0);
  });

  it('rejects unsupported Content-Type', async () => {
    stubFetch({ contentType: 'application/pdf' });

    await expect(
      service.saveAssetFromUrl({
        libraryId,
        sourcePageUrl: 'https://example.com/page',
        mediaUrl: 'https://example.com/doc.pdf',
      }),
    ).rejects.toThrow();

    const assets = service.listAssets({ libraryId, recursive: true });
    expect(assets).toHaveLength(0);
  });

  it('rejects network errors', async () => {
    stubFetch({ error: new Error('ECONNREFUSED') });

    await expect(
      service.saveAssetFromUrl({
        libraryId,
        sourcePageUrl: 'https://example.com/page',
        mediaUrl: 'https://example.com/photo.png',
      }),
    ).rejects.toThrow();

    const assets = service.listAssets({ libraryId, recursive: true });
    expect(assets).toHaveLength(0);
  });

  it('rejects abort/timeout errors', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    stubFetch({ error: abortError });

    await expect(
      service.saveAssetFromUrl({
        libraryId,
        sourcePageUrl: 'https://example.com/page',
        mediaUrl: 'https://example.com/photo.png',
      }),
    ).rejects.toThrow();

    const assets = service.listAssets({ libraryId, recursive: true });
    expect(assets).toHaveLength(0);
  });

  it('saves to a target folder when specified', async () => {
    // Create a managed folder.
    const folder = service.createManagedFolder({ libraryId, name: 'MyFolder' });
    stubFetch({ contentType: 'image/png' });

    const result = await service.saveAssetFromUrl({
      libraryId,
      targetFolderId: folder.folderId,
      sourcePageUrl: 'https://example.com/page',
      mediaUrl: 'https://example.com/photo.png',
    });

    expect(result.asset.managedFolderId).toBe(folder.folderId);

    // Listing assets by folder should include it.
    const folderAssets = service.listAssets({ libraryId, folderId: folder.folderId, recursive: false });
    expect(folderAssets).toHaveLength(1);
    expect(folderAssets[0]!.assetId).toBe(result.asset.assetId);
  });

  it('saves to Assets/ root when no target folder specified', async () => {
    stubFetch({ contentType: 'image/png' });

    const result = await service.saveAssetFromUrl({
      libraryId,
      sourcePageUrl: 'https://example.com/page',
      mediaUrl: 'https://example.com/photo.png',
    });

    expect(result.asset.managedFolderId).toBeNull();

    // Asset should appear in root listing.
    const rootAssets = service.listAssets({ libraryId, recursive: false });
    expect(rootAssets).toHaveLength(1);
  });

  it('handles same-name conflict with keep-both (auto-rename)', async () => {
    stubFetch({ contentType: 'image/png' });

    // Import first asset.
    const first = await service.saveAssetFromUrl({
      libraryId,
      sourcePageUrl: 'https://example.com/page',
      mediaUrl: 'https://example.com/photo.png',
    });

    // Import second asset with same filename.
    const second = await service.saveAssetFromUrl({
      libraryId,
      sourcePageUrl: 'https://example.com/page2',
      mediaUrl: 'https://example.com/photo.png',
    });

    // Both should exist.
    const assets = service.listAssets({ libraryId, recursive: true });
    expect(assets).toHaveLength(2);

    // They should have different file names.
    const firstAsset = assets.find((a) => a.assetId === first.asset.assetId);
    const secondAsset = assets.find((a) => a.assetId === second.asset.assetId);
    expect(firstAsset).toBeDefined();
    expect(secondAsset).toBeDefined();
    expect(secondAsset!.displayName).not.toBe(firstAsset!.displayName);

    // First asset has correct source page URL.
    const meta1 = service.getAssetMetadata({ libraryId, assetId: first.asset.assetId });
    expect(meta1.sourcePageUrl).toBe('https://example.com/page');

    const meta2 = service.getAssetMetadata({ libraryId, assetId: second.asset.assetId });
    expect(meta2.sourcePageUrl).toBe('https://example.com/page2');
  });

  it('rejects non-http scheme for mediaUrl (defense in depth)', async () => {
    await expect(
      service.saveAssetFromUrl({
        libraryId,
        sourcePageUrl: 'https://example.com/page',
        mediaUrl: 'file:///etc/passwd',
      }),
    ).rejects.toThrow();

    const assets = service.listAssets({ libraryId, recursive: true });
    expect(assets).toHaveLength(0);
  });

  it('rejects a URL whose DNS result is private before fetch', async () => {
    service.closeAll();
    const lib = createTestLibrary({
      dnsLookup: async () => [{ address: '127.0.0.1', family: 4 }],
    });
    service = lib.service;
    libraryId = lib.libraryId;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(service.saveAssetFromUrl({
      libraryId,
      sourcePageUrl: 'https://example.com/page',
      mediaUrl: 'https://attacker.example/photo.png',
    })).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    'http://127.0.0.1/a.png',
    'http://10.0.0.1/a.png',
    'http://169.254.169.254/a.png',
    'http://0.0.0.0/a.png',
    'http://224.0.0.1/a.png',
    'http://[::1]/a.png',
    'http://[fe80::1]/a.png',
    'http://[fc00::1]/a.png',
    'http://[ff02::1]/a.png',
  ])('rejects prohibited literal network target %s', async (mediaUrl) => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(service.saveAssetFromUrl({
      libraryId,
      sourcePageUrl: 'https://example.com/page',
      mediaUrl,
    })).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('revalidates every redirect target and blocks a redirect to private DNS', async () => {
    service.closeAll();
    const dnsLookup = vi.fn(async (hostname: string) => hostname === 'public.example'
      ? [{ address: '203.0.113.10', family: 4 as const }]
      : [{ address: '169.254.169.254', family: 4 as const }]);
    const lib = createTestLibrary({ dnsLookup });
    service = lib.service;
    libraryId = lib.libraryId;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 302,
      headers: new Headers({ location: 'http://metadata.example/latest' }),
      body: null,
    }));

    await expect(service.saveAssetFromUrl({
      libraryId,
      sourcePageUrl: 'https://example.com/page',
      mediaUrl: 'https://public.example/photo.png',
    })).rejects.toThrow();
    expect(dnsLookup).toHaveBeenCalledTimes(2);
  });

  it('rejects an oversized Content-Length before reading the body', async () => {
    const read = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        'content-type': 'image/png',
        'content-length': String(500 * 1024 * 1024 + 1),
      }),
      body: { getReader: () => ({ read, cancel: vi.fn() }) },
    }));

    await expect(service.saveAssetFromUrl({
      libraryId,
      sourcePageUrl: 'https://example.com/page',
      mediaUrl: 'https://example.com/photo.png',
    })).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });

  it('keeps the 30 second deadline active while reading the response body', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async (_url: URL, init?: RequestInit) => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/png' }),
      body: {
        getReader: () => ({
          read: () => new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }),
          cancel: vi.fn(),
        }),
      },
    })));

    const pending = service.saveAssetFromUrl({
      libraryId,
      sourcePageUrl: 'https://example.com/page',
      mediaUrl: 'https://example.com/photo.png',
    });
    const rejection = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(30_001);
    await rejection;
    expect(service.listAssets({ libraryId, recursive: true })).toHaveLength(0);
  });

  it('streams multiple response chunks to the imported file intact', async () => {
    const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])];
    stubFetch({ contentType: 'image/png', chunks });
    const result = await service.saveAssetFromUrl({
      libraryId,
      sourcePageUrl: 'https://example.com/page',
      mediaUrl: 'https://example.com/photo.png',
    });
    const library = service.listLibraries().find((item) => item.libraryId === libraryId)!;
    expect(readFileSync(path.join(library.libraryPath, 'Assets', result.asset.displayName)))
      .toEqual(Buffer.from([1, 2, 3, 4, 5, 6]));
  });

  it('does not truncate an over-limit server filename and reports the filesystem path limit', async () => {
    const oversizedName = `${'a'.repeat(300)}.png`;
    stubFetch({
      contentType: 'image/png',
      contentDisposition: `attachment; filename="${oversizedName}"`,
    });

    await expect(service.saveAssetFromUrl({
      libraryId,
      sourcePageUrl: 'https://example.com/page',
      mediaUrl: 'https://example.com/download',
    })).rejects.toMatchObject({ reason: 'PATH_LIMIT_EXCEEDED' });
    expect(service.listAssets({ libraryId, recursive: true })).toHaveLength(0);
  });
});
