/**
 * 最小内存 WebDAV 服务端 fixture（Serpent-xffq）。
 *
 * 用于在无真实服务端时验证 WebDAVDriver 的认证、PROPFIND 解析、
 * 条件写、MOVE/MKCOL 与能力探测。行为可通过 options 开关模拟
 * 不同服务端差异（认证模式/ETag/递归深度/MOVE 支持）。
 */
import { createHash } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface MockWebDAVOptions {
  auth?: 'none' | 'basic' | 'digest';
  username?: string;
  password?: string;
  supportsEtag?: boolean;
  supportsMove?: boolean;
  supportsDepthInfinity?: boolean;
}

interface StoredFile {
  body: Buffer;
  etag: string;
  lastModified: string;
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function startMockWebDAVServer(options: MockWebDAVOptions = {}): Promise<{
  baseUrl: string;
  close(): Promise<void>;
  files(): Map<string, StoredFile>;
}> {
  const auth = options.auth ?? 'none';
  const username = options.username ?? 'user';
  const password = options.password ?? 'pass';
  const supportsEtag = options.supportsEtag ?? true;
  const supportsMove = options.supportsMove ?? true;
  const supportsDepthInfinity = options.supportsDepthInfinity ?? true;

  const storage = new Map<string, StoredFile>();
  const collections = new Set<string>();

  function decodePath(requestUrl: string): string {
    const pathname = new URL(requestUrl, 'http://localhost').pathname;
    return decodeURIComponent(pathname.replace(/^\/+/, ''));
  }

  function isAuthorized(req: http.IncomingMessage): boolean {
    if (auth === 'none') return true;
    const header = req.headers.authorization ?? '';
    if (auth === 'basic') {
      const expected = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
      return header === expected;
    }
    // Digest：只校验结构（realm/user/nonce/response 存在且 uri 匹配）。
    if (!/^Digest\s/i.test(header)) return false;
    return /username="/.test(header) && /realm="/.test(header) && /nonce="/.test(header) && /response="/.test(header) && /uri="[^"]+"/.test(header);
  }

  function digestChallengeHeader(): string {
    const nonce = createHash('md5').update(String(Date.now())).digest('hex');
    return `Digest realm="mock", nonce="${nonce}", qop="auth", opaque="mock-opaque", algorithm=MD5`;
  }

  function multistatusResponse(paths: Array<{ href: string; isCollection: boolean; body?: Buffer }>): string {
    const responses = paths.map((entry) => {
      const etag = entry.body ? `"${sha256(entry.body)}"` : undefined;
      const length = entry.body ? entry.body.length : 0;
      return `  <D:response>
    <D:href>${entry.href}</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype>${entry.isCollection ? '<D:collection/>' : ''}</D:resourcetype>
        <D:getcontentlength>${length}</D:getcontentlength>
        <D:getlastmodified>Sat, 15 Aug 2026 13:00:00 GMT</D:getlastmodified>${etag ? `
        <D:getetag>${etag}</D:getetag>` : ''}
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`;
    }).join('\n');
    return `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
${responses}
</D:multistatus>`;
  }

  const server = http.createServer((req, res) => {
    void (async () => {
      if (auth !== 'none' && !isAuthorized(req)) {
        res.writeHead(401, { 'WWW-Authenticate': auth === 'digest' ? digestChallengeHeader() : 'Basic realm="mock"' });
        res.end('Not authorized');
        return;
      }
      const path = decodePath(req.url ?? '').replace(/\/+$/, '');
      const method = req.method ?? 'GET';

      if (method === 'OPTIONS') {
        res.writeHead(200, { DAV: '1,2', Allow: 'OPTIONS, PROPFIND, PUT, GET, DELETE, MKCOL, MOVE' });
        res.end();
        return;
      }

      if (method === 'PROPFIND') {
        const depth = String(req.headers.depth ?? '1');
        if (depth === 'infinity' && !supportsDepthInfinity) {
          res.writeHead(403, { 'Content-Type': 'text/plain' });
          res.end('Depth infinity not supported');
          return;
        }
        const prefix = path === '' ? '' : `${path}/`;
        const entries: Array<{ href: string; isCollection: boolean; body?: Buffer }> = [
          { href: `/${path}`, isCollection: true },
        ];
        for (const [key, value] of storage) {
          if (depth === '0') continue;
          if (key.startsWith(prefix) || path === '') {
            const rest = path === '' ? key : key.slice(prefix.length);
            if (depth === '1' && rest.includes('/')) continue;
            entries.push({ href: `/${key}`, isCollection: false, body: value.body });
          }
        }
        for (const collection of collections) {
          if (collection.startsWith(prefix)) {
            entries.push({ href: `/${collection}/`, isCollection: true });
          }
        }
        if (entries.length === 1 && path !== '') {
          const exact = storage.get(path);
          if (!exact && !collections.has(path)) {
            res.writeHead(404);
            res.end('Not found');
            return;
          }
        }
        res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' });
        res.end(multistatusResponse(entries));
        return;
      }

      if (method === 'PUT') {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        const body = Buffer.concat(chunks);
        const existing = storage.get(path);
        if (supportsEtag && req.headers['if-match'] && existing && req.headers['if-match'] !== existing.etag) {
          res.writeHead(412);
          res.end('Precondition failed');
          return;
        }
        const stored: StoredFile = {
          body,
          etag: supportsEtag ? `"${sha256(body)}"` : '',
          lastModified: new Date().toUTCString(),
        };
        storage.set(path, stored);
        collections.delete(path);
        res.writeHead(existing ? 204 : 201, supportsEtag ? { ETag: stored.etag } : {});
        res.end();
        return;
      }

      if (method === 'GET') {
        const stored = storage.get(path);
        if (!stored) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        res.writeHead(200, { ETag: stored.etag, 'Content-Length': String(stored.body.length) });
        res.end(stored.body);
        return;
      }

      if (method === 'DELETE') {
        const hadFile = storage.delete(path);
        if (collections.delete(path)) {
          res.writeHead(204);
          res.end();
          return;
        }
        if (hadFile) {
          res.writeHead(204);
          res.end();
          return;
        }
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      if (method === 'MKCOL') {
        collections.add(path);
        res.writeHead(201);
        res.end();
        return;
      }

      if (method === 'MOVE') {
        if (!supportsMove) {
          res.writeHead(405);
          res.end('MOVE not supported');
          return;
        }
        const destination = new URL(String(req.headers.destination ?? ''), 'http://localhost').pathname;
        const to = decodeURIComponent(destination.replace(/^\/+/, ''));
        const stored = storage.get(path);
        if (stored) {
          storage.set(to, stored);
          storage.delete(path);
        } else if (collections.delete(path)) {
          collections.add(to);
        } else {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        res.writeHead(201);
        res.end();
        return;
      }

      res.writeHead(405);
      res.end();
    })();
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}/`,
        close: () => new Promise((done) => server.close(() => done())),
        files: () => storage,
      });
    });
  });
}
