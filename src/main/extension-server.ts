import * as http from 'node:http';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { z } from 'zod';
import {
  isValidExtensionUploadMediaUrl,
  isValidExtensionUploadSourcePageUrl,
} from '../shared/protocol/media-url';
import { SEGMENTED_MEDIA_CHUNK_BYTES } from './segmented-media-transfer';
import type {
  CreateSegmentedMediaSessionInput,
  SegmentedMediaTransferManager,
} from './segmented-media-transfer';

// ---------------------------------------------------------------------------
// Save-intent schema — JSON URL save (legacy / fallback)
// ---------------------------------------------------------------------------

const httpUrlSchema = z.string().refine(
  (url) => /^https?:\/\//.test(url),
  { message: 'URL must use http or https scheme' },
);

export const saveIntentSchema = z.strictObject({
  kind: z.enum(['image', 'video']),
  sourcePageUrl: httpUrlSchema,
  mediaUrl: httpUrlSchema,
  mediaType: z.string().optional(),
  targetFolderId: z.string().min(1).nullable().optional(),
});

export type SaveIntent = z.infer<typeof saveIntentSchema>;

export const extensionFolderSchema = z.strictObject({
  folderId: z.string().min(1),
  name: z.string().min(1),
  relativePath: z.string().min(1),
  assetCount: z.number().int().nonnegative().optional(),
});

export type ExtensionFolderSummary = z.infer<typeof extensionFolderSchema>;

export type ListFoldersDisposition =
  | {
      ok: true;
      folders: ExtensionFolderSummary[];
      recentBrowsedFolderIds: string[];
      libraryDisplayName: string;
    }
  | { ok: false; status: number; reason: string };

export interface ExtensionCollectionSummary {
  collectionId: string;
  name: string;
  relativePath: string;
  assetCount?: number;
}

export type ListCollectionsDisposition =
  | {
      ok: true;
      collections: ExtensionCollectionSummary[];
      libraryDisplayName: string;
    }
  | { ok: false; status: number; reason: string };

/** 合集树用 `/` 分段。名称里的斜杠换成全角，避免被拆成额外层级。 */
export function extensionCollectionSummaries(
  collections: readonly {
    collectionId: string;
    parentId: string | null;
    name: string;
    assetCount?: number;
  }[],
): ExtensionCollectionSummary[] {
  const byId = new Map(collections.map((collection) => [collection.collectionId, collection]));
  const memo = new Map<string, string>();
  const segment = (name: string): string => {
    const safe = name.trim().replace(/[\\/]/g, '／');
    return safe.length > 0 ? safe : '未命名合集';
  };
  const pathOf = (collectionId: string, stack: Set<string>): string => {
    const cached = memo.get(collectionId);
    if (cached) return cached;
    const collection = byId.get(collectionId);
    if (!collection) return '未命名合集';
    const own = segment(collection.name);
    if (stack.has(collectionId) || !collection.parentId || !byId.has(collection.parentId)) {
      memo.set(collectionId, own);
      return own;
    }
    stack.add(collectionId);
    const path = `${pathOf(collection.parentId, stack)}/${own}`;
    stack.delete(collectionId);
    memo.set(collectionId, path);
    return path;
  };

  return collections.map((collection) => ({
    collectionId: collection.collectionId,
    name: segment(collection.name),
    relativePath: pathOf(collection.collectionId, new Set()),
    ...(typeof collection.assetCount === 'number' && Number.isFinite(collection.assetCount)
      ? { assetCount: Math.max(0, Math.floor(collection.assetCount)) }
      : {}),
  }));
}

/** Metadata for browser-fetched binary uploads (Serpent-1jyi). */
export interface SaveUploadRequest {
  kind: 'image' | 'video';
  sourcePageUrl?: string;
  mediaUrl?: string;
  contentType: string;
  filename: string;
  stagedFilePath: string;
  stagingDirectory: string;
  targetFolderId?: string | null;
  /** 设置后文件固定进资源库根目录，导入成功后再加入该合集。 */
  targetCollectionId?: string;
  /** Refuse to route a deferred segmented-media fallback into another library. */
  expectedLibraryId?: string;
  byteLength: number;
  focusAppAfterSave: boolean;
  revealInLibrary: boolean;
}

export type SaveUploadDisposition =
  | { accepted: true; duplicate?: true }
  | { accepted: false; status: number; reason: string; failureKind?: 'source-invalid' };

// ---------------------------------------------------------------------------
// Server options
// ---------------------------------------------------------------------------

export interface ExtensionServerOptions {
  /** Starting port (default 19876). Falls back to port+1, port+2 on EADDRINUSE. */
  port?: number;
  /**
   * Directory used to stage browser-uploaded media before Worker import.
   * Typically `app.getPath('temp')`.
   */
  uploadStagingRoot: string;
  /** Called with the validated save intent on POST /save. */
  onSaveIntent: (
    intent: SaveIntent,
  ) => void | SaveIntentDisposition | Promise<void | SaveIntentDisposition>;
  /** Called after POST /save-upload streams the body to a local staging file. */
  onSaveUpload: (
    upload: SaveUploadRequest,
  ) => void | SaveUploadDisposition | Promise<void | SaveUploadDisposition>;
  /** Called on GET /folders. */
  onListFolders: () => ListFoldersDisposition | Promise<ListFoldersDisposition>;
  /** Called on GET /collections. */
  onListCollections: () => ListCollectionsDisposition | Promise<ListCollectionsDisposition>;
  /** Optional HLS/DASH segment session manager. Older clients remain on `/save-upload`. */
  segmentedMediaTransferManager?: SegmentedMediaTransferManager;
  /** Optional error callback for server-level errors (e.g. bind failure). */
  onError?: (error: Error) => void;
}

export type SaveIntentDisposition =
  | { accepted: true; duplicate?: true }
  | { accepted: false; status: number; reason: string; failureKind?: 'source-invalid' };

export interface ExtensionServer {
  server: http.Server;
  port: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isLoopback(addr: string | undefined): boolean {
  if (!addr) return false;
  if (addr === '127.0.0.1' || addr === '::1') return true;
  // Windows / dual-stack Node may report IPv4 loopback clients as IPv4-mapped IPv6.
  if (addr === '::ffff:127.0.0.1') return true;
  return false;
}

function isAllowedOrigin(origin: string | string[] | undefined): boolean {
  // Chromium MV3 service-worker fetches may omit Origin. Any explicit browser
  // Origin must be a real unpacked/store-installed extension origin:
  // - Chromium: chrome-extension://<32 lowercase a-p chars>
  // - Firefox:  moz-extension://<UUID> (Serpent-54122a)
  // Auth is loopback-only (product decision: no pairing token — Serpent-1cxv).
  if (origin === undefined) return true;
  if (Array.isArray(origin)) return false;
  if (/^chrome-extension:\/\/[a-p]{32}$/u.test(origin)) return true;
  return /^moz-extension:\/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(origin);
}

const MAX_SAVE_JSON_BYTES = 16 * 1024;
const MAX_SEGMENTED_SESSION_JSON_BYTES = 512 * 1024;
/** Same cap as Worker remote download (500 MB). */
export const MAX_EXTENSION_UPLOAD_BYTES = 500 * 1024 * 1024;
const UPLOAD_STAGE_PREFIX = 'serpent-ext-upload-';

function jsonResponse(
  res: http.ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function headerValue(headers: http.IncomingHttpHeaders, name: string): string | undefined {
  const raw = headers[name];
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0];
  return undefined;
}

function decodeHeaderText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseBooleanHeader(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  if (value === undefined || value === '') return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  return defaultValue;
}

function parseUploadMetadata(headers: http.IncomingHttpHeaders):
  | {
    ok: true;
    kind: 'image' | 'video';
    sourcePageUrl?: string;
    mediaUrl?: string;
    contentType: string;
    filename: string;
    targetFolderId?: string | null;
    targetCollectionId?: string;
    expectedLibraryId?: string;
    focusAppAfterSave: boolean;
    revealInLibrary: boolean;
  }
  | { ok: false; reason: string } {
  const kindRaw = headerValue(headers, 'x-serpent-kind');
  const sourcePageUrl = decodeHeaderText(headerValue(headers, 'x-serpent-source-page-url'));
  const mediaUrl = decodeHeaderText(headerValue(headers, 'x-serpent-media-url'));
  const localFileUpload = headerValue(headers, 'x-serpent-local-file') === 'true';
  const contentType = normalizeContentType(
    headerValue(headers, 'x-serpent-content-type') ?? headerValue(headers, 'content-type'),
  );
  const filename = decodeHeaderText(headerValue(headers, 'x-serpent-filename')) ?? 'download';
  const targetRaw = headerValue(headers, 'x-serpent-target-folder-id');
  const collectionRaw = headerValue(headers, 'x-serpent-target-collection-id');
  const expectedLibraryId = decodeHeaderText(headerValue(headers, 'x-serpent-expected-library-id'))?.trim();

  if (kindRaw !== 'image' && kindRaw !== 'video') {
    return { ok: false, reason: 'invalid kind' };
  }
  if (!localFileUpload && (!sourcePageUrl || !isValidExtensionUploadSourcePageUrl(sourcePageUrl))) {
    return { ok: false, reason: 'invalid source page url' };
  }
  if (!localFileUpload
    && (!mediaUrl || !sourcePageUrl || !isValidExtensionUploadMediaUrl(mediaUrl, sourcePageUrl))) {
    return { ok: false, reason: 'invalid media url' };
  }
  if (localFileUpload && (sourcePageUrl !== undefined || mediaUrl !== undefined)) {
    return { ok: false, reason: 'invalid local file metadata' };
  }
  if (expectedLibraryId !== undefined
    && (!expectedLibraryId || expectedLibraryId.length > 128 || /[\r\n\0]/u.test(expectedLibraryId))) {
    return { ok: false, reason: 'invalid expected library id' };
  }
  if (!contentType || contentType === 'application/octet-stream') {
    // octet-stream alone is too vague; require an explicit media content-type header.
    if (!headerValue(headers, 'x-serpent-content-type')) {
      return { ok: false, reason: 'missing content type' };
    }
  }
  if (!contentType) {
    return { ok: false, reason: 'missing content type' };
  }

  let targetFolderId: string | null | undefined;
  if (targetRaw === undefined || targetRaw === '') {
    targetFolderId = undefined;
  } else if (targetRaw === 'null') {
    targetFolderId = null;
  } else {
    targetFolderId = decodeHeaderText(targetRaw);
  }

  return {
    ok: true,
    kind: kindRaw,
    sourcePageUrl,
    mediaUrl,
    contentType,
    filename: filename.trim() || 'download',
    targetFolderId,
    ...(decodeHeaderText(collectionRaw)?.trim()
      ? { targetCollectionId: decodeHeaderText(collectionRaw)!.trim() }
      : {}),
    ...(expectedLibraryId ? { expectedLibraryId } : {}),
    focusAppAfterSave: parseBooleanHeader(
      headerValue(headers, 'x-serpent-focus-app-after-save'),
      true,
    ),
    revealInLibrary: parseBooleanHeader(
      headerValue(headers, 'x-serpent-reveal-in-library'),
      true,
    ),
  };
}

function normalizeContentType(value: string | undefined): string {
  return value?.split(';')[0]?.trim().toLowerCase() ?? '';
}

function sizeLimitTransform(maxBytes: number): {
  stream: Transform;
  getByteLength: () => number;
} {
  let byteLength = 0;
  const stream = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      byteLength += chunk.length;
      if (byteLength > maxBytes) {
        callback(Object.assign(new Error('payload too large'), { code: 'PAYLOAD_TOO_LARGE' }));
        return;
      }
      callback(null, chunk);
    },
  });
  return { stream, getByteLength: () => byteLength };
}

async function readRequestBodyLimited(
  request: http.IncomingMessage,
  maxBytes: number,
): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  let byteLength = 0;
  for await (const value of request) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    byteLength += chunk.length;
    if (byteLength > maxBytes) {
      request.resume();
      return undefined;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, byteLength);
}

const segmentedMediaTrackSchema = z.strictObject({
  kind: z.enum(['video', 'audio']),
  segments: z.array(z.strictObject({
    id: z.string().min(1).max(64),
    role: z.enum(['init', 'media']),
    durationMs: z.number().finite().positive().optional(),
    discontinuityBefore: z.boolean().optional(),
  })).min(1).max(20_000),
});

const segmentedMediaSessionSchema = z.strictObject({
  requestId: z.string().uuid(),
  filename: z.string().min(1).max(255),
  sourcePageUrl: httpUrlSchema,
  mediaUrl: httpUrlSchema,
  protocol: z.enum(['hls-ts', 'hls-fmp4', 'dash-fmp4']),
  tracks: z.array(segmentedMediaTrackSchema).min(1).max(2),
  targetFolderId: z.string().min(1).nullable().optional(),
  targetCollectionId: z.string().min(1).optional(),
  expectedLibraryId: z.string().min(1).max(128).optional(),
  focusAppAfterSave: z.boolean().optional(),
  revealInLibrary: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// createExtensionServer
// ---------------------------------------------------------------------------

/**
 * Starts a lightweight HTTP server bound to 127.0.0.1. Accepts:
 *
 *   GET  /ping         → 200 {"app":"Serpent"}
 *   GET  /folders      → 200 {"folders":[...]} on success
 *   GET  /collections  → 200 {"collections":[...]} on success
 *   POST /save         → 202 on valid save-intent JSON (desktop re-download)
 *   POST /save-upload  → 202 after browser-fetched bytes are staged (preferred)
 *
 * Only loopback connections (127.0.0.1, ::1) are accepted. No pairing token
 * (Serpent-1cxv): identity is loopback + optional chrome-extension Origin.
 */
export async function createExtensionServer(
  options: ExtensionServerOptions,
): Promise<ExtensionServer> {
  const startPort = options.port ?? 19876;
  const maxPort = startPort + 2;

  const server = http.createServer((req, res) => {
    res.setHeader('Connection', 'close');

    req.on('error', () => {
      // No-op: the socket will be destroyed automatically by Node.
    });

    if (!isLoopback(req.socket.remoteAddress)) {
      jsonResponse(res, 403, { status: 'rejected', reason: 'forbidden' });
      return;
    }

    if (req.method === 'GET' && req.url === '/ping') {
      jsonResponse(res, 200, { app: 'Serpent' });
      return;
    }

    const mediaTransferRequest = options.segmentedMediaTransferManager;
    const origin = headerValue(req.headers, 'origin');
    const mediaRoute = req.url === '/capabilities'
      || (typeof req.url === 'string' && req.url.startsWith('/media-transfer/sessions'));
    if (mediaRoute && origin && isAllowedOrigin(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Segment-Final');
    }
    if (mediaRoute && req.method === 'OPTIONS') {
      if (!isAllowedOrigin(req.headers.origin)) {
        jsonResponse(res, 403, { status: 'rejected', reason: 'forbidden origin' });
        return;
      }
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === 'GET' && req.url === '/capabilities') {
      if (!isAllowedOrigin(req.headers.origin)) {
        jsonResponse(res, 403, { status: 'rejected', reason: 'forbidden origin' });
        req.resume();
        return;
      }
      jsonResponse(res, 200, {
        status: 'ok',
        segmentedMediaUpload: mediaTransferRequest
          ? {
              version: 1,
              maxAssetBytes: mediaTransferRequest.maxAssetBytes,
              chunkBytes: mediaTransferRequest.chunkBytes,
              protocols: ['hls-ts', 'hls-fmp4', 'dash-fmp4'],
            }
          : null,
      });
      return;
    }

    if (mediaRoute && mediaTransferRequest) {
      if (!isAllowedOrigin(req.headers.origin)) {
        jsonResponse(res, 403, { status: 'rejected', reason: 'forbidden origin' });
        req.resume();
        return;
      }
      const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.method === 'POST' && requestUrl.pathname === '/media-transfer/sessions') {
        if (!(req.headers['content-type'] ?? '').toLowerCase().includes('application/json')) {
          jsonResponse(res, 400, { status: 'rejected', reason: 'invalid content-type' });
          req.resume();
          return;
        }
        const declaredLength = Number(req.headers['content-length']);
        if (Number.isFinite(declaredLength) && declaredLength > MAX_SEGMENTED_SESSION_JSON_BYTES) {
          jsonResponse(res, 413, { status: 'rejected', reason: 'payload too large' });
          req.resume();
          return;
        }
        void (async () => {
          const body = await readRequestBodyLimited(req, MAX_SEGMENTED_SESSION_JSON_BYTES);
          if (!body) {
            jsonResponse(res, 413, { status: 'rejected', reason: 'payload too large' });
            return;
          }
          let payload: unknown;
          try {
            payload = JSON.parse(body.toString('utf8')) as unknown;
          } catch {
            jsonResponse(res, 400, { status: 'rejected', reason: 'invalid json' });
            return;
          }
          const parsed = segmentedMediaSessionSchema.safeParse(payload);
          if (!parsed.success) {
            jsonResponse(res, 400, { status: 'rejected', reason: 'invalid body' });
            return;
          }
          const created = await mediaTransferRequest.create(
            parsed.data as CreateSegmentedMediaSessionInput,
            origin,
          );
          if (!created.ok) {
            jsonResponse(res, created.status, { status: 'rejected', reason: created.reason });
            return;
          }
          jsonResponse(res, 201, {
            status: 'accepted',
            sessionId: created.sessionId,
            token: created.token,
            chunkBytes: created.chunkBytes,
            maxAssetBytes: created.maxAssetBytes,
          });
        })().catch((error: unknown) => {
          options.onError?.(error instanceof Error ? error : new Error(String(error)));
          if (!res.headersSent) jsonResponse(res, 500, { status: 'rejected', reason: 'internal error' });
        });
        return;
      }

      const sessionMatch = /^\/media-transfer\/sessions\/([0-9a-f-]{36})(?:\/(segments\/([a-z0-9_-]{1,64})|commit))?$/iu.exec(requestUrl.pathname);
      if (!sessionMatch) {
        jsonResponse(res, 404, { status: 'rejected', reason: 'not found' });
        req.resume();
        return;
      }
      const sessionId = sessionMatch[1]!;
      const tokenHeader = headerValue(req.headers, 'authorization');
      const token = tokenHeader?.startsWith('Bearer ') ? tokenHeader.slice(7) : undefined;
      if (req.method === 'GET' && sessionMatch[2] === undefined) {
        const snapshot = mediaTransferRequest.snapshot(sessionId, token, origin);
        if (!snapshot) {
          jsonResponse(res, 404, { status: 'rejected', reason: 'session not found' });
          return;
        }
        jsonResponse(res, 200, { ...snapshot });
        return;
      }
      if (req.method === 'PUT' && sessionMatch[3] !== undefined) {
        const offsetRaw = requestUrl.searchParams.get('offset');
        const offset = offsetRaw === null ? NaN : Number(offsetRaw);
        const declaredLength = Number(req.headers['content-length']);
        if (Number.isFinite(declaredLength) && declaredLength > SEGMENTED_MEDIA_CHUNK_BYTES) {
          jsonResponse(res, 413, { status: 'rejected', reason: 'chunk too large' });
          req.resume();
          return;
        }
        if (!Number.isSafeInteger(offset) || offset < 0) {
          jsonResponse(res, 400, { status: 'rejected', reason: 'invalid segment offset' });
          req.resume();
          return;
        }
        void (async () => {
          const bytes = await readRequestBodyLimited(req, SEGMENTED_MEDIA_CHUNK_BYTES);
          if (!bytes) {
            jsonResponse(res, 413, { status: 'rejected', reason: 'chunk too large' });
            return;
          }
          const result = await mediaTransferRequest.uploadChunk({
            sessionId,
            token,
            origin,
            segmentId: sessionMatch[3]!,
            offset,
            final: headerValue(req.headers, 'x-segment-final') === 'true',
            bytes,
          });
          if (!result.ok) {
            jsonResponse(res, result.status, { status: 'rejected', reason: result.reason });
            return;
          }
          jsonResponse(res, 200, { status: 'ok', received: true });
        })().catch((error: unknown) => {
          options.onError?.(error instanceof Error ? error : new Error(String(error)));
          if (!res.headersSent) jsonResponse(res, 500, { status: 'rejected', reason: 'internal error' });
        });
        return;
      }
      if (req.method === 'POST' && sessionMatch[2] === 'commit') {
        void mediaTransferRequest.commit(sessionId, token, origin).then((result) => {
          if (!result.ok) {
            jsonResponse(res, result.status, { status: 'rejected', reason: result.reason });
            return;
          }
          jsonResponse(res, 202, { status: 'accepted', state: 'committing' });
        }).catch((error: unknown) => {
          options.onError?.(error instanceof Error ? error : new Error(String(error)));
          if (!res.headersSent) jsonResponse(res, 500, { status: 'rejected', reason: 'internal error' });
        });
        return;
      }
      if (req.method === 'DELETE' && sessionMatch[2] === undefined) {
        void mediaTransferRequest.cancel(sessionId, token, origin).then((result) => {
          if (!result.ok) {
            jsonResponse(res, result.status, { status: 'rejected', reason: result.reason });
            return;
          }
          const snapshot = mediaTransferRequest.snapshot(sessionId, token, origin);
          jsonResponse(res, 200, {
            status: 'ok',
            ...(result.duplicate ? { duplicate: true } : {}),
            ...(snapshot ? {
              state: snapshot.status,
              cleanupFailed: snapshot.cleanupFailed,
              ...(snapshot.failureKind ? { failureKind: snapshot.failureKind } : {}),
            } : {}),
          });
        }).catch((error: unknown) => {
          options.onError?.(error instanceof Error ? error : new Error(String(error)));
          if (!res.headersSent) jsonResponse(res, 500, { status: 'rejected', reason: 'internal error' });
        });
        return;
      }
      jsonResponse(res, 405, { status: 'rejected', reason: 'method not allowed' });
      req.resume();
      return;
    }

    if (req.method === 'GET' && req.url === '/folders') {
      if (!isAllowedOrigin(req.headers.origin)) {
        jsonResponse(res, 403, { status: 'rejected', reason: 'forbidden origin' });
        req.resume();
        return;
      }

      void Promise.resolve(options.onListFolders())
        .then((disposition) => {
          if (!disposition.ok) {
            jsonResponse(res, disposition.status, {
              status: 'rejected',
              reason: disposition.reason,
            });
            return;
          }
          jsonResponse(res, 200, {
            status: 'ok',
            folders: disposition.folders,
            recentBrowsedFolderIds: disposition.recentBrowsedFolderIds,
            libraryDisplayName: disposition.libraryDisplayName,
          });
        })
        .catch((error) => {
          const normalized = error instanceof Error ? error : new Error(String(error));
          options.onError?.(normalized);
          jsonResponse(res, 500, { status: 'rejected', reason: 'internal error' });
        });
      return;
    }

    if (req.method === 'GET' && req.url === '/collections') {
      if (!isAllowedOrigin(req.headers.origin)) {
        jsonResponse(res, 403, { status: 'rejected', reason: 'forbidden origin' });
        req.resume();
        return;
      }

      void Promise.resolve(options.onListCollections())
        .then((disposition) => {
          if (!disposition.ok) {
            jsonResponse(res, disposition.status, {
              status: 'rejected',
              reason: disposition.reason,
            });
            return;
          }
          jsonResponse(res, 200, {
            status: 'ok',
            collections: disposition.collections,
            libraryDisplayName: disposition.libraryDisplayName,
          });
        })
        .catch((error) => {
          const normalized = error instanceof Error ? error : new Error(String(error));
          options.onError?.(normalized);
          jsonResponse(res, 500, { status: 'rejected', reason: 'internal error' });
        });
      return;
    }

    if (req.method === 'POST' && req.url === '/save-upload') {
      if (!isAllowedOrigin(req.headers.origin)) {
        jsonResponse(res, 403, { status: 'rejected', reason: 'forbidden origin' });
        req.resume();
        return;
      }

      const metadata = parseUploadMetadata(req.headers);
      if (!metadata.ok) {
        jsonResponse(res, 400, { status: 'rejected', reason: metadata.reason });
        req.resume();
        return;
      }

      const declaredLength = Number(req.headers['content-length']);
      if (Number.isFinite(declaredLength) && declaredLength > MAX_EXTENSION_UPLOAD_BYTES) {
        jsonResponse(res, 413, { status: 'rejected', reason: 'payload too large' });
        req.resume();
        return;
      }
      if (Number.isFinite(declaredLength) && declaredLength <= 0) {
        jsonResponse(res, 400, { status: 'rejected', reason: 'empty body' });
        req.resume();
        return;
      }

      void (async () => {
        const stagingDirectory = path.join(
          options.uploadStagingRoot,
          `${UPLOAD_STAGE_PREFIX}${randomUUID()}`,
        );
        const safeName =
          path.basename(metadata.filename).replace(
            // eslint-disable-next-line no-control-regex -- strip illegal filename chars
            /[<>:"/\\|?*\u0000-\u001f]/g,
            '_',
          ) || 'download';
        const stagedFilePath = path.join(stagingDirectory, safeName);
        try {
          await mkdir(stagingDirectory, { recursive: true });
          const limit = sizeLimitTransform(MAX_EXTENSION_UPLOAD_BYTES);
          const writer = createWriteStream(stagedFilePath, { flags: 'wx', mode: 0o600 });
          await pipeline(req, limit.stream, writer);
          const byteLength = limit.getByteLength();
          if (byteLength === 0) {
            await rm(stagingDirectory, { recursive: true, force: true });
            jsonResponse(res, 400, { status: 'rejected', reason: 'empty body' });
            return;
          }

          const disposition = await options.onSaveUpload({
            kind: metadata.kind,
            contentType: metadata.contentType,
            filename: safeName,
            stagedFilePath,
            stagingDirectory,
            targetFolderId: metadata.targetFolderId,
            ...(metadata.targetCollectionId
              ? { targetCollectionId: metadata.targetCollectionId }
              : {}),
            ...(metadata.expectedLibraryId ? { expectedLibraryId: metadata.expectedLibraryId } : {}),
            byteLength,
            focusAppAfterSave: metadata.focusAppAfterSave,
            revealInLibrary: metadata.revealInLibrary,
            ...(metadata.sourcePageUrl === undefined
              ? {}
              : { sourcePageUrl: metadata.sourcePageUrl }),
            ...(metadata.mediaUrl === undefined ? {} : { mediaUrl: metadata.mediaUrl }),
          });

          if (
            disposition &&
            typeof disposition === 'object' &&
            'accepted' in disposition &&
            !disposition.accepted
          ) {
            jsonResponse(res, disposition.status, {
              status: 'rejected',
              reason: disposition.reason,
              ...(disposition.failureKind ? { failureKind: disposition.failureKind } : {}),
            });
            return;
          }

          jsonResponse(res, 202, {
            status: 'accepted',
            ...(disposition?.accepted && disposition.duplicate ? { duplicate: true } : {}),
          });
        } catch (error) {
          try {
            await rm(stagingDirectory, { recursive: true, force: true });
          } catch {
            // Best effort.
          }
          const normalized = error instanceof Error ? error : new Error(String(error));
          if ((normalized as NodeJS.ErrnoException).code === 'PAYLOAD_TOO_LARGE') {
            jsonResponse(res, 413, { status: 'rejected', reason: 'payload too large' });
            return;
          }
          options.onError?.(normalized);
          if (!res.headersSent) {
            jsonResponse(res, 500, { status: 'rejected', reason: 'internal error' });
          }
        }
      })();
      return;
    }

    if (req.method === 'POST' && req.url === '/save') {
      if (!isAllowedOrigin(req.headers.origin)) {
        jsonResponse(res, 403, { status: 'rejected', reason: 'forbidden origin' });
        req.resume();
        return;
      }
      const contentType = req.headers['content-type'] ?? '';
      if (!contentType.includes('application/json')) {
        jsonResponse(res, 400, { status: 'rejected', reason: 'invalid content-type' });
        return;
      }

      const declaredLength = Number(req.headers['content-length']);
      if (Number.isFinite(declaredLength) && declaredLength > MAX_SAVE_JSON_BYTES) {
        jsonResponse(res, 413, { status: 'rejected', reason: 'payload too large' });
        req.resume();
        return;
      }

      const chunks: Buffer[] = [];
      let receivedBytes = 0;
      let rejectedForSize = false;
      req.on('data', (chunk: Buffer) => {
        if (rejectedForSize) return;
        receivedBytes += chunk.length;
        if (receivedBytes > MAX_SAVE_JSON_BYTES) {
          rejectedForSize = true;
          chunks.length = 0;
          jsonResponse(res, 413, { status: 'rejected', reason: 'payload too large' });
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', async () => {
        if (rejectedForSize) return;
        const raw = Buffer.concat(chunks).toString('utf-8');

        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          jsonResponse(res, 400, { status: 'rejected', reason: 'invalid json' });
          return;
        }

        const result = saveIntentSchema.safeParse(parsed);
        if (!result.success) {
          jsonResponse(res, 400, { status: 'rejected', reason: 'invalid body' });
          return;
        }

        let disposition: void | SaveIntentDisposition;
        try {
          disposition = await options.onSaveIntent(result.data);
          if (
            disposition &&
            typeof disposition === 'object' &&
            'accepted' in disposition &&
            !disposition.accepted
          ) {
            jsonResponse(res, disposition.status, {
              status: 'rejected',
              reason: disposition.reason,
              ...(disposition.failureKind ? { failureKind: disposition.failureKind } : {}),
            });
            return;
          }
        } catch (error) {
          const normalized = error instanceof Error ? error : new Error(String(error));
          options.onError?.(normalized);
          jsonResponse(res, 500, { status: 'rejected', reason: 'internal error' });
          return;
        }

        jsonResponse(res, 202, {
          status: 'accepted',
          ...(disposition?.accepted && disposition.duplicate ? { duplicate: true } : {}),
        });
      });
      return;
    }

    jsonResponse(res, 404, { status: 'rejected', reason: 'not found' });
  });

  for (let port = startPort; port <= maxPort; port++) {
    try {
      const boundPort = await new Promise<number>((resolve, reject) => {
        function onError(err: NodeJS.ErrnoException) {
          reject(err);
        }
        server.once('error', onError);
        server.listen(port, '127.0.0.1', () => {
          server.removeListener('error', onError);
          resolve(port);
        });
      });
      return { server, port: boundPort };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EADDRINUSE') {
        options.onError?.(err as Error);
        throw err;
      }
    }
  }

  const finalError = new Error(
    `Failed to bind extension server to any port in range ${startPort}-${maxPort}`,
  );
  options.onError?.(finalError);
  throw finalError;
}
