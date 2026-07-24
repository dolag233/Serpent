import * as http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Save-intent schema — the shape the browser extension sends to POST /save
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
});

export type ExtensionFolderSummary = z.infer<typeof extensionFolderSchema>;

export type ListFoldersDisposition =
  | { ok: true; folders: ExtensionFolderSummary[] }
  | { ok: false; status: number; reason: string };

// ---------------------------------------------------------------------------
// Server options
// ---------------------------------------------------------------------------

export interface ExtensionServerOptions {
  /** Starting port (default 19876). Falls back to port+1, port+2 on EADDRINUSE. */
  port?: number;
  /** Called with the validated save intent on POST /save. */
  onSaveIntent: (
    intent: SaveIntent,
  ) => void | SaveIntentDisposition | Promise<void | SaveIntentDisposition>;
  /** Called on GET /folders after auth succeeds. */
  onListFolders: () => ListFoldersDisposition | Promise<ListFoldersDisposition>;
  /** Returns the current high-entropy pairing token. Called per request so rotation is immediate. */
  getPairingToken: () => string;
  /** Optional error callback for server-level errors (e.g. bind failure). */
  onError?: (error: Error) => void;
}

export type SaveIntentDisposition =
  | { accepted: true }
  | { accepted: false; status: number; reason: string };

export interface ExtensionServer {
  server: http.Server;
  port: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isLoopback(addr: string | undefined): boolean {
  return addr === '127.0.0.1' || addr === '::1';
}

function isAllowedOrigin(origin: string | string[] | undefined): boolean {
  // Chromium MV3 service-worker fetches may omit Origin. In that controlled
  // case the Bearer token is the caller identity. Any explicit browser Origin
  // must be a real unpacked/store-installed Chromium extension origin.
  if (origin === undefined) return true;
  if (Array.isArray(origin)) return false;
  return /^chrome-extension:\/\/[a-p]{32}$/u.test(origin);
}

function hasValidPairingToken(authorization: string | undefined, expectedToken: string): boolean {
  if (!authorization?.startsWith('Bearer ') || expectedToken.length === 0) return false;
  const suppliedToken = authorization.slice('Bearer '.length);
  const supplied = Buffer.from(suppliedToken, 'utf8');
  const expected = Buffer.from(expectedToken, 'utf8');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

const MAX_SAVE_BODY_BYTES = 16 * 1024;

function jsonResponse(
  res: http.ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// ---------------------------------------------------------------------------
// createExtensionServer
// ---------------------------------------------------------------------------

/**
 * Starts a lightweight HTTP server bound to 127.0.0.1. Accepts:
 *
 *   GET  /ping    → 200 {"app":"Serpent"}
 *   GET  /folders → 200 {"folders":[...]} on success
 *   POST /save    → 202 on valid save-intent JSON, 400/403 otherwise
 *
 * Only loopback connections (127.0.0.1, ::1) are accepted; all others
 * receive 403. If the preferred port is unavailable the server falls
 * back to the next two ports.
 */
export async function createExtensionServer(
  options: ExtensionServerOptions,
): Promise<ExtensionServer> {
  const startPort = options.port ?? 19876;
  const maxPort = startPort + 2;

  const server = http.createServer((req, res) => {
    // Always close the connection after the response to prevent keep-alive
    // races during tests and to keep the server stateless.
    res.setHeader('Connection', 'close');

    // If the request stream errors before we can respond, prevent
    // the error from crashing the server.
    req.on('error', () => {
      // No-op: the socket will be destroyed automatically by Node.
    });

    // -------- loopback guard --------
    if (!isLoopback(req.socket.remoteAddress)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'rejected', reason: 'forbidden' }));
      return;
    }

    // -------- GET /ping --------
    if (req.method === 'GET' && req.url === '/ping') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ app: 'Serpent' }));
      return;
    }

    // -------- GET /folders --------
    if (req.method === 'GET' && req.url === '/folders') {
      if (!isAllowedOrigin(req.headers.origin)) {
        jsonResponse(res, 403, { status: 'rejected', reason: 'forbidden origin' });
        req.resume();
        return;
      }
      if (!hasValidPairingToken(req.headers.authorization, options.getPairingToken())) {
        res.setHeader('WWW-Authenticate', 'Bearer realm="Serpent"');
        jsonResponse(res, 401, { status: 'rejected', reason: 'authentication required' });
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
          jsonResponse(res, 200, { status: 'ok', folders: disposition.folders });
        })
        .catch((error) => {
          const normalized = error instanceof Error ? error : new Error(String(error));
          options.onError?.(normalized);
          jsonResponse(res, 500, { status: 'rejected', reason: 'internal error' });
        });
      return;
    }

    // -------- POST /save --------
    if (req.method === 'POST' && req.url === '/save') {
      if (!isAllowedOrigin(req.headers.origin)) {
        jsonResponse(res, 403, { status: 'rejected', reason: 'forbidden origin' });
        req.resume();
        return;
      }
      if (!hasValidPairingToken(req.headers.authorization, options.getPairingToken())) {
        res.setHeader('WWW-Authenticate', 'Bearer realm="Serpent"');
        jsonResponse(res, 401, { status: 'rejected', reason: 'authentication required' });
        req.resume();
        return;
      }
      const contentType = req.headers['content-type'] ?? '';
      if (!contentType.includes('application/json')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'rejected', reason: 'invalid content-type' }));
        return;
      }

      const declaredLength = Number(req.headers['content-length']);
      if (Number.isFinite(declaredLength) && declaredLength > MAX_SAVE_BODY_BYTES) {
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
        if (receivedBytes > MAX_SAVE_BODY_BYTES) {
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
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'rejected', reason: 'invalid json' }));
          return;
        }

        const result = saveIntentSchema.safeParse(parsed);
        if (!result.success) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'rejected', reason: 'invalid body' }));
          return;
        }

        try {
          const disposition = await options.onSaveIntent(result.data);
          if (
            disposition &&
            typeof disposition === 'object' &&
            'accepted' in disposition &&
            !disposition.accepted
          ) {
            jsonResponse(res, disposition.status, {
              status: 'rejected',
              reason: disposition.reason,
            });
            return;
          }
        } catch (error) {
          const normalized = error instanceof Error ? error : new Error(String(error));
          options.onError?.(normalized);
          jsonResponse(res, 500, { status: 'rejected', reason: 'internal error' });
          return;
        }

        jsonResponse(res, 202, { status: 'accepted' });
      });
      return;
    }

    // -------- unknown --------
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'rejected', reason: 'not found' }));
  });

  // Port fallback: try startPort, then startPort+1, then startPort+2.
  for (let port = startPort; port <= maxPort; port++) {
    try {
      const boundPort = await new Promise<number>((resolve, reject) => {
        function onError(err: NodeJS.ErrnoException) {
          if (err.code === 'EADDRINUSE') {
            reject(err);
          } else {
            reject(err);
          }
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
      // EADDRINUSE — try next port
    }
  }

  const finalError = new Error(
    `Failed to bind extension server to any port in range ${startPort}-${maxPort}`,
  );
  options.onError?.(finalError);
  throw finalError;
}
