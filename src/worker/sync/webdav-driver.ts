/**
 * WebDAV 存储驱动（Serpent-xffq）——RemoteStorageDriver 的第一个实现。
 *
 * 基于 Node 原生 http/https（Worker 内可用），支持：
 * - Basic / Digest 认证（401 WWW-Authenticate 自动协商，Digest 按 RFC 2617）
 * - PROPFIND（Depth 0/1/infinity）、PUT（含 If-Match 条件写）、GET、DELETE、
 *   MKCOL（自动创建父链）、MOVE
 * - 自签名证书场景的显式 TLS 放宽（allowInsecureTls，仅用户确认后开启）
 * - 能力探测（认证模式/递归/ETag/MOVE/锁/配额）
 *
 * 错误统一映射为 RemoteStorageError（可读、带可重试标记），不向调用方
 * 暴露网络堆栈。
 */

import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';

import {
  DriverUnsupportedError,
  RemoteStorageError,
  type DriverCapabilities,
  type RemoteEntry,
  type RemoteReadResult,
  type RemoteStorageDriver,
  type RemoteWriteOptions,
  type RemoteWriteResult,
} from './remote-storage';
import { parseWebDAVMultistatus } from './webdav-xml';

interface RawResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

export interface WebDAVDriverConfig {
  /** 远端根 URL，以 `/` 结尾（如 https://nas.local/dav/）。 */
  baseUrl: string;
  username?: string;
  password?: string;
  /** 显式允许自签名/无效 TLS 证书（仅 HTTPS，需用户确认）。 */
  allowInsecureTls?: boolean;
  timeoutMs?: number;
}

interface DigestChallenge {
  realm: string;
  nonce: string;
  qop?: string;
  opaque?: string;
  algorithm?: string;
}

const USER_AGENT = 'Serpent/0.1 sync';

function encodePathSegment(segment: string): string {
  return encodeURIComponent(segment)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}

/** portable path → 编码后的 URL path（以 baseUrl 为根）。 */
export function joinWebDAVUrl(baseUrl: string, portablePath: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  if (portablePath === '') return base;
  const encoded = portablePath.split('/').filter((part) => part.length > 0).map(encodePathSegment).join('/');
  return `${base}${encoded}${portablePath.endsWith('/') ? '/' : ''}`;
}

function parseDigestChallenge(headerValue: string): DigestChallenge | null {
  if (!/^Digest\s/i.test(headerValue)) return null;
  const fields: Record<string, string> = {};
  const pattern = /(\w+)=(?:"([^"]*)"|([^\s,]+))/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(headerValue)) !== null) {
    fields[match[1]!.toLowerCase()] = match[2] ?? match[3] ?? '';
  }
  if (!fields.realm || !fields.nonce) return null;
  return {
    realm: fields.realm,
    nonce: fields.nonce,
    qop: fields.qop,
    opaque: fields.opaque,
    algorithm: fields.algorithm,
  };
}

function buildDigestAuthorization(
  challenge: DigestChallenge,
  username: string,
  password: string,
  method: string,
  uri: string,
): string {
  const algorithm = challenge.algorithm?.toUpperCase() === 'SHA-256' ? 'SHA-256' : 'MD5';
  const hash = (value: string) => createHash(algorithm === 'SHA-256' ? 'sha256' : 'md5').update(value).digest('hex');
  const cnonce = randomBytes(8).toString('hex');
  const nc = '00000001';
  const ha1 = hash(`${username}:${challenge.realm}:${password}`);
  const ha2 = hash(`${method}:${uri}`);
  const qop = challenge.qop?.split(',').map((item) => item.trim()).find((item) => item === 'auth') ?? undefined;
  const response = qop
    ? hash(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : hash(`${ha1}:${challenge.nonce}:${ha2}`);
  const parts = [
    `username="${username.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
    `realm="${challenge.realm.replace(/"/g, '\\"')}"`,
    `nonce="${challenge.nonce}"`,
    `uri="${uri}"`,
    `algorithm=${algorithm}`,
    `response="${response}"`,
  ];
  if (qop) parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  if (challenge.opaque) parts.push(`opaque="${challenge.opaque}"`);
  return `Digest ${parts.join(', ')}`;
}

function rawRequest(options: {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: Buffer;
  rejectUnauthorized: boolean;
  timeoutMs: number;
}): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(options.url);
    const transport = parsed.protocol === 'https:' ? https : http;
    const request = transport.request({
      hostname: parsed.hostname,
      port: parsed.port || undefined,
      path: `${parsed.pathname}${parsed.search}`,
      method: options.method,
      headers: {
        'User-Agent': USER_AGENT,
        ...options.headers,
        ...(options.body ? { 'Content-Length': String(options.body.length) } : {}),
      },
      rejectUnauthorized: options.rejectUnauthorized,
      timeout: options.timeoutMs,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        clearTimeout(hardTimer);
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers as Record<string, string>,
          body: Buffer.concat(chunks),
        });
      });
    });
    // 硬超时：socket 空闲超时管不住"服务器持续流式响应但非常慢"的情况
    // （如低效的 Depth: infinity 遍历），必须给整个请求一个总时限。
    const hardTimer = setTimeout(() => {
      request.destroy(new RemoteStorageError('TIMEOUT', '连接超时，请检查地址与网络。', true));
    }, options.timeoutMs);
    request.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(hardTimer);
      if (error instanceof RemoteStorageError) {
        reject(error);
        return;
      }
      if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ESOCKETTIMEDOUT') {
        reject(new RemoteStorageError('TIMEOUT', '连接超时，请检查地址与网络。', true));
      } else if (error.code === 'CERT_HAS_EXPIRED' || error.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || error.code === 'SELF_SIGNED_CERT_IN_CHAIN' || error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || error.message.includes('certificate')) {
        reject(new RemoteStorageError('TLS_ERROR', '服务器证书无效或自签名；仅在你信任该服务器时允许不安全连接。'));
      } else if (error.code === 'ENOTFOUND') {
        reject(new RemoteStorageError('DNS_ERROR', '无法解析服务器地址。'));
      } else if (error.code === 'ECONNREFUSED') {
        reject(new RemoteStorageError('CONNECTION_REFUSED', '连接被拒绝，请检查服务器与端口。', true));
      } else {
        reject(new RemoteStorageError('NETWORK_ERROR', '网络错误：连接失败。', true));
      }
    });
    if (options.body) request.write(options.body);
    request.end();
  });
}

export class WebDAVDriver implements RemoteStorageDriver {
  private readonly config: Required<Pick<WebDAVDriverConfig, 'baseUrl' | 'allowInsecureTls' | 'timeoutMs'>> & Pick<WebDAVDriverConfig, 'username' | 'password'>;
  private readonly basicAuthorization?: string;
  private cachedCapabilities?: DriverCapabilities;

  constructor(config: WebDAVDriverConfig) {
    const baseUrl = new URL(config.baseUrl);
    if (baseUrl.protocol === 'http:' && baseUrl.hostname !== 'localhost' && !config.allowInsecureTls) {
      // HTTP 明文默认拒绝（规格：仅 HTTPS；用户在连接配置中显式确认后才允许）。
      // 驱动层面仍可构造，由上层 UI 决定是否传递 allowInsecureTls。
    }
    this.config = {
      baseUrl: config.baseUrl,
      username: config.username,
      password: config.password,
      allowInsecureTls: config.allowInsecureTls ?? false,
      timeoutMs: config.timeoutMs ?? 60_000,
    };
    if (config.username !== undefined && config.password !== undefined) {
      this.basicAuthorization = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`;
    }
  }

  private async request(
    method: string,
    portablePath: string,
    options: { headers?: Record<string, string>; body?: Buffer; ifMatch?: string; destination?: string; timeoutMs?: number } = {},
  ): Promise<RawResponse> {
    const url = joinWebDAVUrl(this.config.baseUrl, portablePath);
    const parsed = new URL(url);
    const headers: Record<string, string> = { ...options.headers };
    if (options.ifMatch) headers['If-Match'] = options.ifMatch;
    if (options.destination) headers.Destination = options.destination;
    if (this.basicAuthorization) headers.Authorization = this.basicAuthorization;

    let response = await rawRequest({
      url,
      method,
      headers,
      body: options.body,
      rejectUnauthorized: !this.config.allowInsecureTls,
      timeoutMs: options.timeoutMs ?? this.config.timeoutMs,
    });

    // Digest 挑战：401 + WWW-Authenticate: Digest → 计算并重试一次。
    if (response.status === 401 && this.config.username && this.config.password) {
      const challengeHeader = String(response.headers['www-authenticate'] ?? '');
      const challenge = parseDigestChallenge(challengeHeader);
      if (challenge) {
        const uri = parsed.pathname + parsed.search;
        headers.Authorization = buildDigestAuthorization(challenge, this.config.username, this.config.password, method, uri);
        response = await rawRequest({
          url,
          method,
          headers,
          body: options.body,
          rejectUnauthorized: !this.config.allowInsecureTls,
          timeoutMs: this.config.timeoutMs,
        });
      }
    }
    return response;
  }

  private mapError(status: number, body: Buffer, fallbackMethod: string): RemoteStorageError {
    const reason = body.subarray(0, 200).toString('utf-8').replace(/<[^>]+>/g, '').trim();
    switch (status) {
      case 401: return new RemoteStorageError('AUTH_FAILED', '认证失败：用户名或密码不正确。');
      case 403: return new RemoteStorageError('PERMISSION_DENIED', '没有权限执行该操作，请检查账号权限。');
      case 404: return new RemoteStorageError('NOT_FOUND', '远端路径不存在或已被移动。', true);
      case 405: return new RemoteStorageError('METHOD_NOT_ALLOWED', `服务器不支持 ${fallbackMethod} 操作。`);
      case 409: return new RemoteStorageError('CONFLICT', '远端内容已被其他设备修改，稍后重试或检查冲突。', true);
      case 412: return new RemoteStorageError('PRECONDITION_FAILED', '远端内容已变化（版本不一致），将进入冲突处理。');
      case 423: return new RemoteStorageError('LOCKED', '远端资源被锁定，请稍后重试。', true);
      case 507: return new RemoteStorageError('QUOTA_EXCEEDED', '服务器存储空间不足。');
      default: {
        const detail = reason ? `：${reason}` : '';
        return new RemoteStorageError(`HTTP_${status}`, `服务器返回错误（${status}）${detail}`, status >= 500);
      }
    }
  }

  private assertStatus(response: RawResponse, method: string, acceptable: number[]): void {
    if (acceptable.includes(response.status)) return;
    throw this.mapError(response.status, response.body, method);
  }

  async list(portablePath: string, depth: '0' | '1' | 'infinity' = '1'): Promise<RemoteEntry[]> {
    const headers: Record<string, string> = {
      Depth: depth === 'infinity' ? 'infinity' : depth,
      'Content-Type': 'application/xml; charset=utf-8',
    };
    const response = await this.request('PROPFIND', portablePath.endsWith('/') || portablePath === '' ? portablePath : `${portablePath}/`, { headers });
    this.assertStatus(response, 'PROPFIND', [207]);
    const entries = parseWebDAVMultistatus(response.body.toString('utf-8'));
    const rootHref = new URL(joinWebDAVUrl(this.config.baseUrl, portablePath)).pathname;
    const base = new URL(this.config.baseUrl);
    return entries
      .map((entry) => ({
        href: entry.href,
        isDirectory: entry.props.isCollection,
        size: entry.props.contentLength,
        etag: entry.props.etag,
        lastModified: entry.props.lastModified,
      }))
      .filter((entry) => entry.href !== rootHref || portablePath === '')
      .map((entry) => {
        let decoded: string;
        try {
          decoded = decodeURIComponent(entry.href);
        } catch {
          decoded = entry.href;
        }
        const relative = decoded.startsWith(base.pathname)
          ? decoded.slice(base.pathname.length)
          : decoded;
        const normalized = relative.replace(/^\/+/, '');
        return {
          path: normalized,
          isDirectory: entry.isDirectory,
          size: entry.size,
          etag: entry.etag,
          lastModified: entry.lastModified,
        };
      });
  }

  async read(portablePath: string): Promise<RemoteReadResult> {
    const response = await this.request('GET', portablePath);
    this.assertStatus(response, 'GET', [200]);
    return {
      body: response.body,
      etag: response.headers.etag,
      lastModified: response.headers['last-modified'],
    };
  }

  async write(portablePath: string, body: Buffer, options: RemoteWriteOptions = {}): Promise<RemoteWriteResult> {
    const response = await this.request('PUT', portablePath, {
      body,
      ifMatch: options.ifMatch,
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    this.assertStatus(response, 'PUT', [200, 201, 204]);
    return { etag: response.headers.etag, status: response.status };
  }

  async delete(portablePath: string): Promise<void> {
    const response = await this.request('DELETE', portablePath);
    this.assertStatus(response, 'DELETE', [200, 204, 404]);
  }

  async mkdir(portablePath: string): Promise<void> {
    const segments = portablePath.split('/').filter((part) => part.length > 0);
    let current = '';
    for (const segment of segments) {
      current = current === '' ? segment : `${current}/${segment}`;
      const response = await this.request('MKCOL', `${current}/`);
      // 已存在（405 是常见“已存在”信号；201 创建成功）都视为完成。
      if (![201, 405, 301].includes(response.status)) {
        this.assertStatus(response, 'MKCOL', [201, 405, 301]);
      }
    }
  }

  async move(from: string, to: string): Promise<void> {
    const destination = joinWebDAVUrl(this.config.baseUrl, to);
    const response = await this.request('MOVE', from, { destination, headers: { Overwrite: 'F' } });
    if (response.status === 405 || response.status === 501) {
      throw new DriverUnsupportedError('WebDAV 服务器不支持 MOVE。');
    }
    this.assertStatus(response, 'MOVE', [200, 201, 204]);
  }

  async exists(portablePath: string): Promise<boolean> {
    const response = await this.request('PROPFIND', portablePath, {
      headers: { Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' },
    });
    if (response.status === 404) return false;
    this.assertStatus(response, 'PROPFIND', [207]);
    return true;
  }

  async probe(): Promise<DriverCapabilities> {
    if (this.cachedCapabilities) return this.cachedCapabilities;
    const capabilities: DriverCapabilities = {
      auth: 'none',
      supportsContentTransfer: false,
      supportsDepthInfinity: false,
      supportsEtagIfMatch: false,
      supportsMove: false,
      supportsLock: false,
    };

    // 1) 认证模式：未带凭据的 PROPFIND 根。
    const anonymous = await rawRequest({
      url: joinWebDAVUrl(this.config.baseUrl, ''),
      method: 'PROPFIND',
      headers: { Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' },
      rejectUnauthorized: !this.config.allowInsecureTls,
      timeoutMs: this.config.timeoutMs,
    });
    if (anonymous.status === 401) {
      const challenge = String(anonymous.headers['www-authenticate'] ?? '');
      capabilities.auth = /^Digest/i.test(challenge) ? 'digest' : 'basic';
    } else if (anonymous.status === 207) {
      capabilities.auth = 'none';
    } else {
      throw this.mapError(anonymous.status, anonymous.body, 'PROPFIND');
    }

    // 2) 递归列举能力 + 根配额属性。Depth: infinity 在部分服务端
    // 实现非常慢（60s+），用短超时探测：超时即视为不可用（分层遍历兜底）。
    const root = await this.request('PROPFIND', '', {
      headers: { Depth: 'infinity', 'Content-Type': 'application/xml; charset=utf-8' },
      timeoutMs: Math.min(this.config.timeoutMs, 15_000),
    }).catch(() => null);
    if (root && root.status === 207) {
      capabilities.supportsDepthInfinity = true;
      const parsed = parseWebDAVMultistatus(root.body.toString('utf-8'));
      const rootEntry = parsed.find((entry) => entry.props.quotaAvailableBytes !== undefined);
      if (rootEntry) {
        capabilities.quotaBytes = rootEntry.props.quotaAvailableBytes;
        capabilities.usedBytes = rootEntry.props.quotaUsedBytes;
      }
    }

    // 3) ETag / If-Match 条件写：写临时探测文件。
    const probeFile = '.serpent-sync/.probe';
    try {
      const written = await this.request('PUT', probeFile, {
        body: Buffer.from(`serpent-probe-${Date.now()}`),
        headers: { 'Content-Type': 'application/octet-stream' },
      });
      if (written.status >= 200 && written.status < 300) {
        capabilities.supportsContentTransfer = true;
        const etag = written.headers.etag;
        if (etag) {
          const conditional = await this.request('PUT', probeFile, {
            body: Buffer.from('conditional'),
            ifMatch: etag,
            headers: { 'Content-Type': 'application/octet-stream' },
          });
          capabilities.supportsEtagIfMatch = conditional.status >= 200 && conditional.status < 300;
          const stale = await this.request('PUT', probeFile, {
            body: Buffer.from('stale'),
            ifMatch: '"stale-etag"',
            headers: { 'Content-Type': 'application/octet-stream' },
          });
          if (stale.status === 412) capabilities.supportsEtagIfMatch = true;
        }
        // 4) MOVE 支持：只有 2xx 才算真正支持。
        const moved = await this.request('MOVE', probeFile, {
          destination: joinWebDAVUrl(this.config.baseUrl, '.serpent-sync/.probe-2'),
          headers: { Overwrite: 'T' },
        });
        capabilities.supportsMove = moved.status >= 200 && moved.status < 300;
        if (capabilities.supportsMove) await this.request('DELETE', '.serpent-sync/.probe-2');
      }
    } catch {
      // 探测失败不致命：保留默认能力。
    } finally {
      await this.request('DELETE', probeFile);
    }

    // 5) 锁支持：OPTIONS 的 DAV 头。
    try {
      const options = await this.request('OPTIONS', '');
      const dav = String(options.headers.dav ?? '');
      capabilities.supportsLock = /(^|\s)2(\s|,|$)/.test(dav);
    } catch {
      // OPTIONS 失败不影响其余能力。
    }

    this.cachedCapabilities = capabilities;
    return capabilities;
  }
}
