import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DesktopControlPlane } from '../../src/main/desktop-control-plane';

const logger = {
  info: () => undefined,
  error: () => undefined,
};

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

function nextLine(socket: net.Socket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      socket.off('data', onData);
      resolve(JSON.parse(buffer.slice(0, newline)) as Record<string, unknown>);
    };
    socket.on('data', onData);
    socket.once('error', reject);
  });
}

describe('DesktopControlPlane', () => {
  it('requires the per-process nonce before forwarding MCP requests', async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), 'serpent-desktop-control-'));
    const plane = new DesktopControlPlane({
      userDataPath,
      logger,
      onHello: async ({ clientName, requestWriteAccess }, sessionId) => ({
        ok: true,
        protocolVersion: 1,
        sessionId,
        libraryId: 'library-1',
        displayName: clientName,
        writeAccessGranted: requestWriteAccess,
      }),
      onMcpRequest: async (_session, request) => ({
        method: request.method,
        params: request.params,
      }),
    });
    const endpoint = await plane.start();
    cleanups.push(async () => {
      await plane.close();
      await rm(userDataPath, { recursive: true, force: true });
    });

    const socket = typeof endpoint.endpoint === 'string'
      ? net.createConnection(endpoint.endpoint)
      : net.createConnection(endpoint.endpoint);
    socket.setEncoding('utf8');
    await new Promise<void>((resolve) => socket.once('connect', resolve));
    socket.write(`${JSON.stringify({
      type: 'hello',
      protocolVersion: 1,
      nonce: endpoint.nonce,
      clientName: 'unit-test',
      requestWriteAccess: false,
    })}\n`);
    await expect(nextLine(socket)).resolves.toMatchObject({
      type: 'hello.result',
      ok: true,
      libraryId: 'library-1',
    });

    socket.write(`${JSON.stringify({
      type: 'mcp.request',
      requestId: 'request-1',
      method: 'tools/list',
      params: {},
    })}\n`);
    await expect(nextLine(socket)).resolves.toMatchObject({
      type: 'mcp.response',
      requestId: 'request-1',
      ok: true,
    });
    socket.destroy();
  });

  it('rejects a wrong nonce without invoking the attach handler', async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), 'serpent-desktop-control-'));
    let helloCalls = 0;
    const plane = new DesktopControlPlane({
      userDataPath,
      logger,
      onHello: async (_input, sessionId) => {
        helloCalls += 1;
        return {
          ok: true,
          protocolVersion: 1,
          sessionId,
          libraryId: 'library-1',
          displayName: 'unit-test',
          writeAccessGranted: false,
        };
      },
      onMcpRequest: async () => null,
    });
    const endpoint = await plane.start();
    cleanups.push(async () => {
      await plane.close();
      await rm(userDataPath, { recursive: true, force: true });
    });

    const socket = typeof endpoint.endpoint === 'string'
      ? net.createConnection(endpoint.endpoint)
      : net.createConnection(endpoint.endpoint);
    socket.setEncoding('utf8');
    await new Promise<void>((resolve) => socket.once('connect', resolve));
    socket.write(`${JSON.stringify({
      type: 'hello',
      protocolVersion: 1,
      nonce: 'wrong',
      clientName: 'unit-test',
      requestWriteAccess: false,
    })}\n`);
    await expect(nextLine(socket)).resolves.toMatchObject({
      type: 'error',
      code: 'DESKTOP_CONTROL_ATTACH_DENIED',
    });
    expect(helloCalls).toBe(0);
    socket.destroy();
  });
});
