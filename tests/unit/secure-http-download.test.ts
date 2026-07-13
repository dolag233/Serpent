import http from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { defaultPinnedHttpTransport } from '../../src/worker/secure-http-download';

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
  })));
});

describe('defaultPinnedHttpTransport', () => {
  it('connects only to the pinned address while preserving the URL Host header', async () => {
    let receivedHost = '';
    const server = http.createServer((request, response) => {
      receivedHost = request.headers.host ?? '';
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP test server.');

    const controller = new AbortController();
    const response = await defaultPinnedHttpTransport({
      address: '127.0.0.1',
      family: 4,
      headers: { 'User-Agent': 'Serpent/Test' },
      signal: controller.signal,
      // This hostname deliberately cannot resolve. Success proves that the
      // socket lookup consumed the pinned IP instead of consulting DNS again.
      url: new URL(`http://does-not-resolve.invalid:${address.port}/asset.png`),
    });
    const chunks: Buffer[] = [];
    if (!response.body) throw new Error('Expected a response body.');
    for await (const chunk of response.body) chunks.push(Buffer.from(chunk));

    expect(response.status).toBe(200);
    expect(Buffer.concat(chunks)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(receivedHost).toBe(`does-not-resolve.invalid:${address.port}`);
  });
});
