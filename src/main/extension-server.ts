import * as http from 'node:http';
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
});

export type SaveIntent = z.infer<typeof saveIntentSchema>;

// ---------------------------------------------------------------------------
// Server options
// ---------------------------------------------------------------------------

export interface ExtensionServerOptions {
  /** Starting port (default 19876). Falls back to port+1, port+2 on EADDRINUSE. */
  port?: number;
  /** Called with the validated save intent on POST /save. */
  onSaveIntent: (intent: SaveIntent) => void;
  /** Optional error callback for server-level errors (e.g. bind failure). */
  onError?: (error: Error) => void;
}

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

// ---------------------------------------------------------------------------
// createExtensionServer
// ---------------------------------------------------------------------------

/**
 * Starts a lightweight HTTP server bound to 127.0.0.1. Accepts:
 *
 *   GET  /ping  → 200 {"app":"Serpent"}
 *   POST /save  → 202 on valid save-intent JSON, 400/403 otherwise
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

    // -------- POST /save --------
    if (req.method === 'POST' && req.url === '/save') {
      const contentType = req.headers['content-type'] ?? '';
      if (!contentType.includes('application/json')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'rejected', reason: 'invalid content-type' }));
        return;
      }

      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
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

        // Fire-and-forget: call onSaveIntent synchronously, then respond 202.
        try {
          options.onSaveIntent(result.data);
        } catch {
          // Swallow — the intent was validated; downstream errors are
          // handled by the caller's onError path.
        }

        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'accepted' }));
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
