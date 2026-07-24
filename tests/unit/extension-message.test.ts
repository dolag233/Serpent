import * as http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import * as os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createExtensionServer,
  MAX_EXTENSION_UPLOAD_BYTES,
  saveIntentSchema,
  type ExtensionServer,
  type ExtensionServerOptions,
  type SaveIntent,
  type SaveUploadRequest,
} from '../../src/main/extension-server';

const TEST_PORT = 30_000 + (process.pid % 10_000);

function startServer(overrides: Partial<ExtensionServerOptions> = {}): Promise<ExtensionServer> {
  return createExtensionServer({
    uploadStagingRoot: os.tmpdir(),
    onSaveIntent: () => {},
    onSaveUpload: async () => ({ accepted: true }),
    onListFolders: async () => ({ ok: true, folders: [] }),
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function post(
  port: number,
  body: unknown,
  opts?: { contentType?: string; origin?: string },
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/save',
        method: 'POST',
        headers: {
          'Content-Type': opts?.contentType ?? 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          ...(opts?.origin ? { Origin: opts.origin } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          let parsed: unknown;
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = text;
          }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      },
    );

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function postRaw(port: number, payload: Buffer): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/save',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': payload.length,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(text) });
        });
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

function postUpload(
  port: number,
  body: Buffer,
  headers: Record<string, string>,
  opts?: { origin?: string },
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/save-upload',
        method: 'POST',
        headers: {
          'Content-Length': body.length,
          ...headers,
          ...(opts?.origin ? { Origin: opts.origin } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          let parsed: unknown;
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = text;
          }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function getPing(port: number): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${port}/ping`, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(text) });
        });
      })
      .on('error', reject);
  });
}

function getFolders(port: number): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    http
      .get(
        {
          hostname: '127.0.0.1',
          port,
          path: '/folders',
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf-8');
            let parsed: unknown;
            try {
              parsed = JSON.parse(text);
            } catch {
              parsed = text;
            }
            resolve({ status: res.statusCode ?? 0, body: parsed });
          });
        },
      )
      .on('error', reject);
  });
}

const validUploadHeaders = {
  'X-Serpent-Kind': 'image',
  'X-Serpent-Source-Page-Url': 'https://example.com/gallery',
  'X-Serpent-Media-Url': 'https://example.com/photo.png',
  'X-Serpent-Content-Type': 'image/png',
  'X-Serpent-Filename': 'photo.png',
};

// ---------------------------------------------------------------------------
// Schema tests
// ---------------------------------------------------------------------------

describe('save-intent schema', () => {
  it('accepts a valid image intent', () => {
    const intent = {
      kind: 'image',
      sourcePageUrl: 'https://example.com/gallery',
      mediaUrl: 'https://example.com/photo.png',
    };
    expect(saveIntentSchema.parse(intent)).toEqual(intent);
  });

  it('accepts a valid video intent with optional mediaType', () => {
    const intent = {
      kind: 'video',
      sourcePageUrl: 'https://example.com/watch',
      mediaUrl: 'https://example.com/video.mp4',
      mediaType: 'video/mp4',
    };
    expect(saveIntentSchema.parse(intent)).toEqual(intent);
  });

  it('accepts an intent without mediaType', () => {
    const intent = {
      kind: 'image',
      sourcePageUrl: 'https://example.com/gallery',
      mediaUrl: 'https://example.com/photo.png',
    };
    const parsed = saveIntentSchema.parse(intent);
    expect(parsed).not.toHaveProperty('mediaType');
  });

  it('rejects a missing kind field', () => {
    expect(() =>
      saveIntentSchema.parse({
        sourcePageUrl: 'https://example.com',
        mediaUrl: 'https://example.com/photo.png',
      }),
    ).toThrow();
  });

  it('rejects a missing sourcePageUrl field', () => {
    expect(() =>
      saveIntentSchema.parse({
        kind: 'image',
        mediaUrl: 'https://example.com/photo.png',
      }),
    ).toThrow();
  });

  it('rejects a missing mediaUrl field', () => {
    expect(() =>
      saveIntentSchema.parse({
        kind: 'image',
        sourcePageUrl: 'https://example.com',
      }),
    ).toThrow();
  });

  it('rejects an invalid kind value', () => {
    expect(() =>
      saveIntentSchema.parse({
        kind: 'document',
        sourcePageUrl: 'https://example.com',
        mediaUrl: 'https://example.com/file.pdf',
      }),
    ).toThrow();
  });

  it('rejects a non-http scheme for sourcePageUrl', () => {
    expect(() =>
      saveIntentSchema.parse({
        kind: 'image',
        sourcePageUrl: 'file:///etc/passwd',
        mediaUrl: 'https://example.com/photo.png',
      }),
    ).toThrow();
  });

  it('rejects a non-http scheme for mediaUrl', () => {
    expect(() =>
      saveIntentSchema.parse({
        kind: 'image',
        sourcePageUrl: 'https://example.com',
        mediaUrl: 'data:image/png;base64,abc123',
      }),
    ).toThrow();
  });

  it('rejects a javascript: scheme for sourcePageUrl', () => {
    expect(() =>
      saveIntentSchema.parse({
        kind: 'image',
        sourcePageUrl: 'javascript:alert(1)',
        mediaUrl: 'https://example.com/photo.png',
      }),
    ).toThrow();
  });

  it('rejects extra unknown properties', () => {
    expect(() =>
      saveIntentSchema.parse({
        kind: 'image',
        sourcePageUrl: 'https://example.com',
        mediaUrl: 'https://example.com/photo.png',
        filePath: '/etc/passwd',
      }),
    ).toThrow();
  });

  it('rejects an empty string for sourcePageUrl', () => {
    expect(() =>
      saveIntentSchema.parse({
        kind: 'image',
        sourcePageUrl: '',
        mediaUrl: 'https://example.com/photo.png',
      }),
    ).toThrow();
  });

  it('rejects null input', () => {
    expect(() => saveIntentSchema.parse(null)).toThrow();
  });

  it('rejects non-object input', () => {
    expect(() => saveIntentSchema.parse('not an object')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Server integration tests
// ---------------------------------------------------------------------------

describe('createExtensionServer', () => {
  let server: ExtensionServer | null = null;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.server.close(() => resolve()));
      server = null;
    }
  });

  it('starts on the requested port and responds to GET /ping', async () => {
    server = await startServer({ port: TEST_PORT });

    const ping = await getPing(server.port);
    expect(ping.status).toBe(200);
    expect(ping.body).toEqual({ app: 'Serpent' });
  });

  it('falls back to the next port when the first is occupied', async () => {
    const occupant = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end('occupied');
    });
    await new Promise<void>((resolve) => occupant.listen(TEST_PORT, '127.0.0.1', resolve));

    try {
      server = await startServer({ port: TEST_PORT });
      expect(server.port).toBe(TEST_PORT + 1);

      const ping = await getPing(server.port);
      expect(ping.status).toBe(200);
    } finally {
      occupant.close();
    }
  });

  it('falls back to port+2 when first two are occupied', async () => {
    const occupant1 = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end('1');
    });
    const occupant2 = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end('2');
    });
    await new Promise<void>((r) => occupant1.listen(TEST_PORT, '127.0.0.1', r));
    await new Promise<void>((r) => occupant2.listen(TEST_PORT + 1, '127.0.0.1', r));

    try {
      server = await startServer({ port: TEST_PORT });
      expect(server.port).toBe(TEST_PORT + 2);

      const ping = await getPing(server.port);
      expect(ping.status).toBe(200);
    } finally {
      occupant1.close();
      occupant2.close();
    }
  });

  it('returns 202 for a valid save intent', async () => {
    const intents: SaveIntent[] = [];
    server = await startServer({
      port: TEST_PORT,
      onSaveIntent: (i) => {
        intents.push(i);
      },
    });

    const res = await post(server.port, {
      kind: 'image',
      sourcePageUrl: 'https://example.com/gallery',
      mediaUrl: 'https://example.com/photo.png',
      targetFolderId: 'folder-1',
    });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ status: 'accepted' });
    expect(intents).toHaveLength(1);
    expect(intents[0]).toEqual({
      kind: 'image',
      sourcePageUrl: 'https://example.com/gallery',
      mediaUrl: 'https://example.com/photo.png',
      targetFolderId: 'folder-1',
    });
  });

  it('returns folder list for GET /folders', async () => {
    server = await startServer({
      port: TEST_PORT,
      onListFolders: async () => ({
        ok: true,
        folders: [
          {
            folderId: 'folder-1',
            name: '场景',
            relativePath: '场景',
          },
        ],
      }),
    });

    const res = await getFolders(server.port);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'ok',
      folders: [
        {
          folderId: 'folder-1',
          name: '场景',
          relativePath: '场景',
        },
      ],
    });
  });

  it('waits for async acceptance before returning 202', async () => {
    let completed = false;
    server = await startServer({
      port: TEST_PORT,
      onSaveIntent: async () => {
        await Promise.resolve();
        completed = true;
        return { accepted: true };
      },
    });

    const res = await post(server.port, {
      kind: 'image',
      sourcePageUrl: 'https://example.com',
      mediaUrl: 'https://example.com/a.png',
    });
    expect(res.status).toBe(202);
    expect(completed).toBe(true);
  });

  it('returns the downstream rejection instead of a false 202', async () => {
    server = await startServer({
      port: TEST_PORT,
      onSaveIntent: async () => ({ accepted: false, status: 503, reason: 'no active library' }),
    });

    const res = await post(server.port, {
      kind: 'image',
      sourcePageUrl: 'https://example.com',
      mediaUrl: 'https://example.com/a.png',
    });
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'rejected', reason: 'no active library' });
  });

  it('returns 500 and reports a downstream exception', async () => {
    const errors: Error[] = [];
    server = await startServer({
      port: TEST_PORT,
      onSaveIntent: async () => {
        throw new Error('downstream failed');
      },
      onError: (error) => errors.push(error),
    });

    const res = await post(server.port, {
      kind: 'image',
      sourcePageUrl: 'https://example.com',
      mediaUrl: 'https://example.com/a.png',
    });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ status: 'rejected', reason: 'internal error' });
    expect(errors[0]?.message).toBe('downstream failed');
  });

  it('returns 413 before buffering an oversized JSON body', async () => {
    server = await startServer({ port: TEST_PORT });
    const res = await postRaw(server.port, Buffer.alloc(20 * 1024, 0x20));
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ status: 'rejected', reason: 'payload too large' });
  });

  it('accepts a valid Chrome extension Origin', async () => {
    server = await startServer({ port: TEST_PORT });
    const res = await post(
      server.port,
      {
        kind: 'image',
        sourcePageUrl: 'https://example.com',
        mediaUrl: 'https://example.com/a.png',
      },
      { origin: `chrome-extension://${'a'.repeat(32)}` },
    );
    expect(res.status).toBe(202);
  });

  it.each(['https://evil.example', 'http://127.0.0.1:9999', 'null', 'chrome-extension://short'])(
    'rejects untrusted POST Origin %s',
    async (origin) => {
      server = await startServer({ port: TEST_PORT });
      const res = await post(
        server.port,
        {
          kind: 'image',
          sourcePageUrl: 'https://example.com',
          mediaUrl: 'https://example.com/a.png',
        },
        { origin },
      );
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ status: 'rejected', reason: 'forbidden origin' });
    },
  );

  it('calls onSaveIntent with a valid video intent including mediaType', async () => {
    const intents: SaveIntent[] = [];
    server = await startServer({
      port: TEST_PORT,
      onSaveIntent: (i) => {
        intents.push(i);
      },
    });

    const res = await post(server.port, {
      kind: 'video',
      sourcePageUrl: 'https://example.com/watch',
      mediaUrl: 'https://example.com/video.mp4',
      mediaType: 'video/mp4',
    });

    expect(res.status).toBe(202);
    expect(intents[0]).toMatchObject({
      kind: 'video',
      sourcePageUrl: 'https://example.com/watch',
      mediaUrl: 'https://example.com/video.mp4',
      mediaType: 'video/mp4',
    });
  });

  it('returns 400 for an invalid JSON body (non-http scheme)', async () => {
    server = await startServer({ port: TEST_PORT });

    const res = await post(server.port, {
      kind: 'image',
      sourcePageUrl: 'https://example.com',
      mediaUrl: 'file:///etc/passwd',
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ status: 'rejected', reason: 'invalid body' });
  });

  it('returns 400 for missing required fields', async () => {
    server = await startServer({ port: TEST_PORT });

    const res = await post(server.port, {
      kind: 'image',
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ status: 'rejected', reason: 'invalid body' });
  });

  it('returns 400 for non-JSON Content-Type', async () => {
    server = await startServer({ port: TEST_PORT });

    const res = await post(server.port, 'not json', { contentType: 'text/plain' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ status: 'rejected', reason: 'invalid content-type' });
  });

  it('returns 400 for unparseable JSON', async () => {
    server = await startServer({ port: TEST_PORT });

    const payload = 'not-json';
    const result = await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: server!.port,
          path: '/save',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf-8');
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(text) });
          });
        },
      );
      req.on('error', reject);
      req.write(payload);
      req.end();
    });

    expect(result.status).toBe(400);
    expect(result.body).toEqual({ status: 'rejected', reason: 'invalid json' });
  });

  it('returns 404 for unknown endpoints', async () => {
    server = await startServer({ port: TEST_PORT });

    const result = await new Promise<{ status: number }>((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${server!.port}/unknown`, (res) => {
          resolve({ status: res.statusCode ?? 0 });
        })
        .on('error', reject);
    });

    expect(result.status).toBe(404);
  });

  it('ignores non-POST requests to /save', async () => {
    server = await startServer({ port: TEST_PORT });

    const result = await new Promise<{ status: number }>((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${server!.port}/save`, (res) => {
          resolve({ status: res.statusCode ?? 0 });
        })
        .on('error', reject);
    });

    expect(result.status).toBe(404);
  });

  it('stops accepting connections after server.close()', async () => {
    server = await startServer({ port: TEST_PORT });

    const port = server.port;
    server.server.close();
    server = null;

    await expect(
      post(port, {
        kind: 'image',
        sourcePageUrl: 'https://x.com',
        mediaUrl: 'https://x.com/i.png',
      }),
    ).rejects.toThrow();
  });

  it('reports errors via onError when all ports are occupied', async () => {
    const occupants: http.Server[] = [];
    for (const port of [TEST_PORT, TEST_PORT + 1, TEST_PORT + 2]) {
      const s = http.createServer((_req, res) => {
        res.writeHead(200);
        res.end();
      });
      await new Promise<void>((r) => s.listen(port, '127.0.0.1', r));
      occupants.push(s);
    }

    const errors: Error[] = [];
    try {
      await startServer({
        port: TEST_PORT,
        onError: (e) => errors.push(e),
      });
      expect.fail('Expected createExtensionServer to throw when all ports are occupied');
    } catch (err) {
      expect((err as Error).message).toContain('Failed to bind');
      expect(errors).toHaveLength(1);
      expect(errors[0]!.message).toContain('Failed to bind');
    } finally {
      for (const s of occupants) s.close();
    }
  });

  describe('POST /save-upload', () => {
    it('returns 202 for a valid upload and calls onSaveUpload', async () => {
      const uploads: SaveUploadRequest[] = [];
      const stagingRoot = path.join(os.tmpdir(), `serpent-ext-test-${randomUUID()}`);
      await mkdir(stagingRoot, { recursive: true });

      try {
        server = await startServer({
          port: TEST_PORT,
          uploadStagingRoot: stagingRoot,
          onSaveUpload: async (upload) => {
            uploads.push(upload);
            return { accepted: true };
          },
        });

        const payload = Buffer.from('fake-image-bytes');
        const res = await postUpload(server.port, payload, validUploadHeaders);

        expect(res.status).toBe(202);
        expect(res.body).toEqual({ status: 'accepted' });
        expect(uploads).toHaveLength(1);
        expect(uploads[0]).toMatchObject({
          kind: 'image',
          sourcePageUrl: 'https://example.com/gallery',
          mediaUrl: 'https://example.com/photo.png',
          contentType: 'image/png',
          filename: 'photo.png',
          byteLength: payload.length,
        });

        const fileContent = await readFile(uploads[0]!.stagedFilePath);
        expect(fileContent).toEqual(payload);
        await rm(uploads[0]!.stagingDirectory, { recursive: true, force: true });
      } finally {
        await rm(stagingRoot, { recursive: true, force: true });
      }
    });

    it('returns 400 when required upload headers are missing', async () => {
      server = await startServer({ port: TEST_PORT });

      const res = await postUpload(server.port, Buffer.from('x'), {
        'X-Serpent-Kind': 'image',
      });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ status: 'rejected', reason: 'invalid source page url' });
    });

    it('returns 413 when Content-Length exceeds the upload cap', async () => {
      server = await startServer({ port: TEST_PORT });

      const res = await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: server!.port,
            path: '/save-upload',
            method: 'POST',
            headers: {
              ...validUploadHeaders,
              'Content-Length': String(MAX_EXTENSION_UPLOAD_BYTES + 1),
            },
          },
          (response) => {
            const chunks: Buffer[] = [];
            response.on('data', (chunk: Buffer) => chunks.push(chunk));
            response.on('end', () => {
              const text = Buffer.concat(chunks).toString('utf-8');
              resolve({ status: response.statusCode ?? 0, body: JSON.parse(text) });
            });
          },
        );
        req.on('error', reject);
        req.end(Buffer.from('small-body'));
      });

      expect(res.status).toBe(413);
      expect(res.body).toEqual({ status: 'rejected', reason: 'payload too large' });
    });

    it('streams the request body to staging before invoking onSaveUpload', async () => {
      const uploads: SaveUploadRequest[] = [];
      const stagingRoot = path.join(os.tmpdir(), `serpent-ext-test-${randomUUID()}`);
      await mkdir(stagingRoot, { recursive: true });

      try {
        server = await startServer({
          port: TEST_PORT,
          uploadStagingRoot: stagingRoot,
          onSaveUpload: async (upload) => {
            uploads.push(upload);
            const staged = await readFile(upload.stagedFilePath);
            expect(staged.toString('utf-8')).toBe('streamed-payload');
            return { accepted: true };
          },
        });

        const res = await postUpload(
          server.port,
          Buffer.from('streamed-payload'),
          validUploadHeaders,
        );

        expect(res.status).toBe(202);
        expect(uploads[0]?.stagingDirectory).toContain(stagingRoot);
        await rm(uploads[0]!.stagingDirectory, { recursive: true, force: true });
      } finally {
        await rm(stagingRoot, { recursive: true, force: true });
      }
    });
  });
});
