import { mkdtempSync, rmSync } from 'node:fs';
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

function createTestLibrary(): { service: LibraryService; libraryId: string } {
  const libraryPath = tempDir();
  const service = new LibraryService();
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
  } = {},
): void {
  const {
    status = 200,
    contentType = 'image/png',
    body,
    error,
    contentDisposition,
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
      }),
      body: {
        getReader() {
          let done = false;
          return {
            read() {
              if (done) return Promise.resolve({ done: true, value: undefined });
              done = true;
              return Promise.resolve({ done: false, value: body ?? defaultBody });
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
    const lib = createTestLibrary();
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
});
