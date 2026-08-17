import { afterEach, describe, expect, it } from 'vitest';

import { WebDAVDriver } from '../../src/worker/sync/webdav-driver';
import { DriverUnsupportedError } from '../../src/worker/sync/remote-storage';
import { startMockWebDAVServer } from './webdav-fixture-server';

const servers: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('WebDAVDriver against mock server (Serpent-xffq)', () => {
  it('writes, reads, lists, moves and deletes files with proper URL encoding', async () => {
    const server = await startMockWebDAVServer();
    servers.push(server);
    const driver = new WebDAVDriver({ baseUrl: server.baseUrl });

    await driver.mkdir('参考资源库/assets');
    const payload = Buffer.from('hello-sync');
    const written = await driver.write('参考资源库/assets/hello 01.bin', payload);
    expect(written.status).toBe(201);

    const readBack = await driver.read('参考资源库/assets/hello 01.bin');
    expect(readBack.body.equals(payload)).toBe(true);

    const entries = await driver.list('参考资源库/assets/', '1');
    expect(entries.some((entry) => entry.path.includes('hello 01.bin') && !entry.isDirectory)).toBe(true);

    expect(await driver.exists('参考资源库/assets/hello 01.bin')).toBe(true);
    expect(await driver.exists('参考资源库/assets/missing.bin')).toBe(false);

    await driver.move('参考资源库/assets/hello 01.bin', '参考资源库/assets/renamed.bin');
    expect(await driver.exists('参考资源库/assets/renamed.bin')).toBe(true);
    expect(await driver.exists('参考资源库/assets/hello 01.bin')).toBe(false);

    await driver.delete('参考资源库/assets/renamed.bin');
    expect(await driver.exists('参考资源库/assets/renamed.bin')).toBe(false);
  });

  it('supports Basic authentication and reports readable auth errors', async () => {
    const server = await startMockWebDAVServer({ auth: 'basic', username: 'alice', password: 'secret' });
    servers.push(server);

    const anonymous = new WebDAVDriver({ baseUrl: server.baseUrl });
    await expect(anonymous.write('a.txt', Buffer.from('x'))).rejects.toMatchObject({
      code: 'AUTH_FAILED',
    });

    const authenticated = new WebDAVDriver({ baseUrl: server.baseUrl, username: 'alice', password: 'secret' });
    await expect(authenticated.write('a.txt', Buffer.from('x'))).resolves.toBeTruthy();
  });

  it('supports Digest authentication', async () => {
    const server = await startMockWebDAVServer({ auth: 'digest', username: 'alice', password: 'secret' });
    servers.push(server);

    const authenticated = new WebDAVDriver({ baseUrl: server.baseUrl, username: 'alice', password: 'secret' });
    await expect(authenticated.write('a.txt', Buffer.from('digest-ok'))).resolves.toBeTruthy();
    const readBack = await authenticated.read('a.txt');
    expect(readBack.body.toString()).toBe('digest-ok');
  });

  it('enforces If-Match conditional writes when the server supports ETags', async () => {
    const server = await startMockWebDAVServer({ supportsEtag: true });
    servers.push(server);
    const driver = new WebDAVDriver({ baseUrl: server.baseUrl });

    const first = await driver.write('doc.txt', Buffer.from('v1'));
    expect(first.etag).toBeTruthy();
    await expect(driver.write('doc.txt', Buffer.from('stale'), { ifMatch: '"stale"' })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    await expect(driver.write('doc.txt', Buffer.from('v2'), { ifMatch: first.etag })).resolves.toBeTruthy();
  });

  it('throws DriverUnsupportedError when MOVE is unavailable', async () => {
    const server = await startMockWebDAVServer({ supportsMove: false });
    servers.push(server);
    const driver = new WebDAVDriver({ baseUrl: server.baseUrl });

    await driver.write('a.txt', Buffer.from('x'));
    await expect(driver.move('a.txt', 'b.txt')).rejects.toBeInstanceOf(DriverUnsupportedError);
  });

  it('probes capabilities correctly', async () => {
    const server = await startMockWebDAVServer({ supportsEtag: true, supportsMove: true, supportsDepthInfinity: true });
    servers.push(server);
    const driver = new WebDAVDriver({ baseUrl: server.baseUrl });

    const capabilities = await driver.probe();
    expect(capabilities.auth).toBe('none');
    expect(capabilities.supportsDepthInfinity).toBe(true);
    expect(capabilities.supportsEtagIfMatch).toBe(true);
    expect(capabilities.supportsMove).toBe(true);

    const limited = await startMockWebDAVServer({ supportsEtag: false, supportsMove: false, supportsDepthInfinity: false });
    servers.push(limited);
    const limitedDriver = new WebDAVDriver({ baseUrl: limited.baseUrl });
    const limitedCapabilities = await limitedDriver.probe();
    expect(limitedCapabilities.supportsDepthInfinity).toBe(false);
    expect(limitedCapabilities.supportsEtagIfMatch).toBe(false);
    expect(limitedCapabilities.supportsMove).toBe(false);
  });

  it('detects Basic auth requirement through probe', async () => {
    const server = await startMockWebDAVServer({ auth: 'basic', username: 'alice', password: 'secret' });
    servers.push(server);
    // 匿名探测不抛错：返回 auth 要求，其余能力保持未知（false），由上层提示用户配置凭据。
    const anonymous = new WebDAVDriver({ baseUrl: server.baseUrl });
    const anonymousCapabilities = await anonymous.probe();
    expect(anonymousCapabilities.auth).toBe('basic');

    const authenticated = new WebDAVDriver({ baseUrl: server.baseUrl, username: 'alice', password: 'secret' });
    const capabilities = await authenticated.probe();
    expect(capabilities.auth).toBe('basic');
  });

  it('reports wrong credentials as a readable probe failure', async () => {
    const server = await startMockWebDAVServer({ auth: 'basic', username: 'alice', password: 'secret' });
    servers.push(server);
    const wrong = new WebDAVDriver({ baseUrl: server.baseUrl, username: 'alice', password: 'wrong' });
    await expect(wrong.probe()).rejects.toMatchObject({ code: 'AUTH_FAILED' });
  });

  it('maps transport failures to readable, retryable errors', async () => {
    const driver = new WebDAVDriver({ baseUrl: 'http://127.0.0.1:1/', timeoutMs: 2000 });
    await expect(driver.list('')).rejects.toMatchObject({
      code: 'CONNECTION_REFUSED',
      retryable: true,
    });
  });
});
