import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';
import type { PinnedHttpTransport } from '../../src/worker/secure-http-download';

const temporaryRoots: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'serpent-test-extension-'));
  temporaryRoots.push(dir);
  return dir;
}

const fetchBackedPinnedTransport: PinnedHttpTransport = async ({ headers, signal, url }) => {
  const response = await fetch(url, { headers, redirect: 'manual', signal });
  const reader = response.body?.getReader();
  return {
    status: response.status,
    headers: response.headers,
    body: reader ? {
      async *[Symbol.asyncIterator]() {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          yield value;
        }
      },
    } : null,
    cancel: () => { void reader?.cancel(); },
  };
};

function createTestLibrary(options?: ConstructorParameters<typeof LibraryService>[0]): { service: LibraryService; libraryId: string } {
  const libraryPath = tempDir();
  const service = new LibraryService({ pinnedHttpTransport: fetchBackedPinnedTransport, ...options });
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

  const magicByContentType: Record<string, number[]> = {
    'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    'image/jpeg': [0xff, 0xd8, 0xff, 0xe0],
    'image/gif': [...Buffer.from('GIF89a')],
    'image/tiff': [0x49, 0x49, 0x2a, 0x00],
    'image/webp': [...Buffer.from('RIFF0000WEBP')],
    'image/bmp': [...Buffer.from('BM')],
    'video/mp4': [0, 0, 0, 24, ...Buffer.from('ftypisom')],
    'video/quicktime': [0, 0, 0, 24, ...Buffer.from('ftypqt  ')],
    'video/webm': [0x1a, 0x45, 0xdf, 0xa3],
    'video/x-msvideo': [...Buffer.from('RIFF0000AVI ')],
    'video/x-ms-wmv': [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9, 0x00, 0xaa, 0x00, 0x62, 0xce, 0x6c],
  };
  const defaultBody = new Uint8Array([
    ...(magicByContentType[contentType] ?? [0]),
    0x00, 0x00, 0x00, 0x00,
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
      dnsLookup: async () => [{ address: '8.8.8.8', family: 4 }],
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

  it('imports an ordinary browser drag without inventing a source page URL', async () => {
    stubFetch({ contentType: 'image/png' });

    const result = await service.saveAssetFromUrl({
      libraryId,
      mediaUrl: 'https://cdn.example.com/photo.png',
      mediaType: 'image',
    });

    expect(result.asset.displayName).toBe('photo.png');
    expect(service.getAssetMetadata({ libraryId, assetId: result.asset.assetId }).sourcePageUrl).toBeNull();
  });

  it('rolls back the downloaded file and asset when source-page metadata cannot commit', async () => {
    service.closeAll();
    const diagnostics: Array<{ context?: Record<string, unknown> }> = [];
    const lib = createTestLibrary({
      dnsLookup: async () => [{ address: '8.8.8.8', family: 4 }],
      failAt: 'after-import-metadata',
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    service = lib.service;
    libraryId = lib.libraryId;
    stubFetch({ contentType: 'image/png' });

    await expect(service.saveAssetFromUrl({
      libraryId,
      sourcePageUrl: 'https://example.com/gallery?token=secret#private',
      mediaUrl: 'https://cdn.example.com/photo.png?signature=secret#private',
    })).rejects.toMatchObject({ code: 'IMPORT_APPLY_FAILED' });

    expect(service.listAssets({ libraryId, recursive: true })).toEqual([]);
    const library = service.listLibraries().find((candidate) => candidate.libraryId === libraryId)!;
    expect(readdirSync(path.join(library.libraryPath, 'Assets'))).toEqual([]);
    expect(diagnostics.at(-1)?.context).toMatchObject({
      sourcePageUrl: 'https://example.com/gallery',
      mediaUrl: 'https://cdn.example.com/photo.png',
    });
    expect(JSON.stringify(diagnostics)).not.toContain('secret');
  });

  it('recovers a URL import on reopen after a crash between file placement and database commit', async () => {
    service.closeAll();
    const crashingLibrary = createTestLibrary({
      dnsLookup: async () => [{ address: '8.8.8.8', family: 4 }],
      failAt: 'crash-after-place',
    });
    service = crashingLibrary.service;
    libraryId = crashingLibrary.libraryId;
    stubFetch({ contentType: 'image/png' });
    const library = service.listLibraries().find((candidate) => candidate.libraryId === libraryId)!;

    await expect(service.saveAssetFromUrl({
      libraryId,
      sourcePageUrl: 'https://example.com/gallery',
      mediaUrl: 'https://cdn.example.com/photo.png',
    })).rejects.toMatchObject({ code: 'IMPORT_APPLY_FAILED' });

    expect(readFileSync(path.join(library.libraryPath, 'Assets', 'photo.png'))).toBeDefined();
    expect(readdirSync(path.join(library.libraryPath, '.serpent', 'operations'))).toHaveLength(1);
    service.closeAll();

    const recovered = new LibraryService();
    const reopened = recovered.openLibrary(library.libraryPath);
    expect(recovered.listAssets({ libraryId: reopened.libraryId, recursive: true })).toEqual([]);
    expect(readdirSync(path.join(reopened.libraryPath, 'Assets'))).toEqual([]);
    expect(existsSync(path.join(reopened.libraryPath, '.serpent', 'operations'))).toBe(false);
    recovered.closeAll();
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

  it('rejects a missing Content-Type with a specific reason', async () => {
    stubFetch({ contentType: '' });
    await expect(service.saveAssetFromUrl({
      libraryId,
      sourcePageUrl: 'https://example.com/page',
      mediaUrl: 'https://example.com/photo.png',
    })).rejects.toMatchObject({ reason: 'MIME_TYPE_MISSING' });
  });

  it('rejects an extension that conflicts with the declared MIME type', async () => {
    stubFetch({ contentType: 'image/png' });
    await expect(service.saveAssetFromUrl({
      libraryId,
      sourcePageUrl: 'https://example.com/page',
      mediaUrl: 'https://example.com/photo.jpg',
    })).rejects.toMatchObject({ reason: 'MIME_EXTENSION_MISMATCH' });
  });

  it('rejects forged media whose magic bytes conflict with its MIME type', async () => {
    stubFetch({
      contentType: 'image/png',
      body: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
    });
    await expect(service.saveAssetFromUrl({
      libraryId,
      sourcePageUrl: 'https://example.com/page',
      mediaUrl: 'https://example.com/photo.png',
    })).rejects.toMatchObject({ reason: 'MAGIC_BYTES_MISMATCH' });
  });

  it('rejects forged magic from the prefix without consuming the complete response', async () => {
    service.closeAll();
    let chunksRead = 0;
    const transport: PinnedHttpTransport = async () => ({
      status: 200,
      headers: new Headers({ 'content-type': 'image/png' }),
      body: {
        async *[Symbol.asyncIterator]() {
          chunksRead += 1;
          yield new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
          chunksRead += 1;
          yield new Uint8Array(1024 * 1024);
        },
      },
      cancel: vi.fn(),
    });
    const lib = createTestLibrary({
      dnsLookup: async () => [{ address: '8.8.8.8', family: 4 }],
      pinnedHttpTransport: transport,
    });
    service = lib.service;
    libraryId = lib.libraryId;

    await expect(service.saveAssetFromUrl({
      libraryId,
      sourcePageUrl: 'https://example.com/page',
      mediaUrl: 'https://example.com/photo.png',
    })).rejects.toMatchObject({ reason: 'MAGIC_BYTES_MISMATCH' });
    expect(chunksRead).toBe(1);
  });

  it.each([
    ['image/png', 'asset.png'],
    ['image/jpeg', 'asset.jpeg'],
    ['image/gif', 'asset.gif'],
    ['image/tiff', 'asset.tif'],
    ['image/webp', 'asset.webp'],
    ['image/bmp', 'asset.bmp'],
    ['video/mp4', 'asset.mp4'],
    ['video/webm', 'asset.webm'],
    ['video/quicktime', 'asset.mov'],
  ])('accepts matching MIME, extension, and magic for %s', async (contentType, filename) => {
    stubFetch({ contentType });
    const result = await service.saveAssetFromUrl({
      libraryId,
      sourcePageUrl: 'https://example.com/page',
      mediaUrl: `https://example.com/${filename}`,
    });
    expect(result.asset.displayName).toBe(filename);
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

    // Import second asset with the same filename but different bytes.
    stubFetch({
      contentType: 'image/png',
      body: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]),
    });
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

  it('skips library-level duplicate content and returns the existing asset', async () => {
    stubFetch({ contentType: 'image/png' });

    const first = await service.saveAssetFromUrl({
      libraryId,
      sourcePageUrl: 'https://example.com/page',
      mediaUrl: 'https://example.com/photo.png',
    });

    // Free destination basename + identical bytes → content-duplicate skip
    // (IMPORT-007: same basename would be name-conflict instead).
    const second = await service.saveAssetFromUrl({
      libraryId,
      sourcePageUrl: 'https://example.com/page-again',
      mediaUrl: 'https://example.com/photo-copy.png',
    });

    expect(second.asset.assetId).toBe(first.asset.assetId);
    expect(service.listAssets({ libraryId, recursive: true })).toHaveLength(1);
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

  it('pins the validated public address into the socket transport without a second DNS lookup', async () => {
    service.closeAll();
    const dnsLookup = vi.fn()
      .mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
    const transport = vi.fn(fetchBackedPinnedTransport);
    const lib = createTestLibrary({ dnsLookup, pinnedHttpTransport: transport });
    service = lib.service;
    libraryId = lib.libraryId;
    stubFetch({ contentType: 'image/png' });

    await service.saveAssetFromUrl({
      libraryId,
      sourcePageUrl: 'https://example.com/page',
      mediaUrl: 'https://rebind.example/photo.png',
    });

    expect(dnsLookup).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledWith(expect.objectContaining({
      address: '8.8.8.8',
      family: 4,
      url: expect.objectContaining({ hostname: 'rebind.example' }),
    }));
  });

  it.each([
    'http://127.0.0.1/a.png',
    'http://10.0.0.1/a.png',
    'http://169.254.169.254/a.png',
    'http://192.0.2.1/a.png',
    'http://198.51.100.1/a.png',
    'http://203.0.113.1/a.png',
    'http://0.0.0.0/a.png',
    'http://224.0.0.1/a.png',
    'http://[::1]/a.png',
    'http://[fe80::1]/a.png',
    'http://[fec0::1]/a.png',
    'http://[fc00::1]/a.png',
    'http://[2001:db8::1]/a.png',
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
      ? [{ address: '8.8.8.8', family: 4 as const }]
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

  it('pins a separately validated address on every redirect hop', async () => {
    service.closeAll();
    const dnsLookup = vi.fn(async (hostname: string) => [{
      address: hostname === 'one.example' ? '8.8.8.8' : '1.1.1.1',
      family: 4,
    }]);
    const transport = vi.fn(fetchBackedPinnedTransport);
    const lib = createTestLibrary({ dnsLookup, pinnedHttpTransport: transport });
    service = lib.service;
    libraryId = lib.libraryId;
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        status: 302,
        headers: new Headers({ location: 'https://two.example/final.png' }),
        body: null,
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: new Headers({ 'content-type': 'image/png' }),
        body: new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])).body,
      }));

    await service.saveAssetFromUrl({
      libraryId,
      sourcePageUrl: 'https://example.com/page',
      mediaUrl: 'https://one.example/start.png',
    });

    expect(dnsLookup.mock.calls.map(([hostname]) => hostname)).toEqual(['one.example', 'two.example']);
    expect(transport.mock.calls.map(([request]) => request.address))
      .toEqual(['8.8.8.8', '1.1.1.1']);
  });

  it('redacts query and fragment from source-page diagnostics', async () => {
    service.closeAll();
    const diagnostics: Array<{ context?: Record<string, unknown> }> = [];
    const lib = createTestLibrary({
      dnsLookup: async () => [{ address: '8.8.8.8', family: 4 }],
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    service = lib.service;
    libraryId = lib.libraryId;
    stubFetch({ status: 500, contentType: 'image/png' });

    await expect(service.saveAssetFromUrl({
      libraryId,
      sourcePageUrl: 'https://example.com/gallery?token=secret#private',
      mediaUrl: 'https://example.com/photo.png',
    })).rejects.toThrow();

    const metadataDiagnostic = diagnostics.find((item) => item.context?.sourcePageUrl);
    expect(metadataDiagnostic?.context?.sourcePageUrl).toBe('https://example.com/gallery');
  });

  it('redacts query and fragment from nested network errors before logging', async () => {
    service.closeAll();
    const diagnostics: Array<{ error: unknown; context?: Record<string, unknown> }> = [];
    const lib = createTestLibrary({
      dnsLookup: async () => [{ address: '8.8.8.8', family: 4 }],
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    service = lib.service;
    libraryId = lib.libraryId;
    stubFetch({
      error: new Error('request failed for https://cdn.example.com/photo.png?signature=secret#private'),
    });

    await expect(service.saveAssetFromUrl({
      libraryId,
      sourcePageUrl: 'https://example.com/gallery?token=secret#private',
      mediaUrl: 'https://cdn.example.com/photo.png?signature=secret#private',
    })).rejects.toThrow();

    const serialized = JSON.stringify(diagnostics);
    expect(serialized).toContain('https://cdn.example.com/photo.png');
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('#private');
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
    const chunks = [
      new Uint8Array([0x89, 0x50, 0x4e]),
      new Uint8Array([0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]),
    ];
    stubFetch({ contentType: 'image/png', chunks });
    const result = await service.saveAssetFromUrl({
      libraryId,
      sourcePageUrl: 'https://example.com/page',
      mediaUrl: 'https://example.com/photo.png',
    });
    const library = service.listLibraries().find((item) => item.libraryId === libraryId)!;
    expect(readFileSync(path.join(library.libraryPath, 'Assets', result.asset.displayName)))
      .toEqual(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
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

  it('realigns a browser-upload filename when the URL extension disagrees with Content-Type', async () => {
    const pngBody = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
    ]);
    const stagedPath = path.join(tempDir(), 'cdn-thumb.jpg');
    writeFileSync(stagedPath, pngBody);

    const result = await service.saveAssetFromFile({
      libraryId,
      stagedFilePath: stagedPath,
      contentType: 'image/png',
      filename: 'cdn-thumb.jpg',
      sourcePageUrl: 'https://example.com/page',
      mediaUrl: 'https://cdn.example.com/cdn-thumb.jpg',
    });

    expect(result.asset.displayName).toBe('cdn-thumb.png');
  });

  it('uses the common import conflict policy for browser uploads', async () => {
    const firstBytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x10, 0x11,
    ]);
    const firstPath = path.join(tempDir(), 'first.png');
    writeFileSync(firstPath, firstBytes);

    const first = await service.saveAssetFromFile({
      libraryId,
      stagedFilePath: firstPath,
      contentType: 'image/png',
      filename: 'photo.png',
      sourcePageUrl: 'https://example.com/first',
    });

    const duplicatePath = path.join(tempDir(), 'duplicate.png');
    writeFileSync(duplicatePath, firstBytes);
    const duplicate = await service.saveAssetFromFile({
      libraryId,
      stagedFilePath: duplicatePath,
      contentType: 'image/png',
      filename: 'another-name.png',
      sourcePageUrl: 'https://example.com/duplicate',
    });

    expect(duplicate.asset.assetId).toBe(first.asset.assetId);
    expect(service.listAssets({ libraryId, recursive: true })).toHaveLength(1);

    const secondPath = path.join(tempDir(), 'second.png');
    writeFileSync(secondPath, Buffer.from([...firstBytes, 0x12]));
    const second = await service.saveAssetFromFile({
      libraryId,
      stagedFilePath: secondPath,
      contentType: 'image/png',
      filename: 'photo.png',
      sourcePageUrl: 'https://example.com/second',
    });

    expect(second.asset.assetId).not.toBe(first.asset.assetId);
    expect(second.asset.displayName).not.toBe(first.asset.displayName);
    expect(service.listAssets({ libraryId, recursive: true })).toHaveLength(2);
    expect(service.getAssetMetadata({ libraryId, assetId: first.asset.assetId }).sourcePageUrl)
      .toBe('https://example.com/first');
    expect(service.getAssetMetadata({ libraryId, assetId: second.asset.assetId }).sourcePageUrl)
      .toBe('https://example.com/second');
  });
});
