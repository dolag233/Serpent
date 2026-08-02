import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { startDesktopAttachedMcp } from '../../src/main/desktop-attached-mcp';
import { listPluginMcpTools } from '../../src/mcp/plugin-tool-catalog';

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function lineReader(socket: net.Socket): () => Promise<Record<string, unknown>> {
  let buffer = '';
  const queued: Record<string, unknown>[] = [];
  const waiters: Array<(line: Record<string, unknown>) => void> = [];
  socket.on('data', (chunk: string) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const waiter = waiters.shift();
      if (waiter) waiter(parsed);
      else queued.push(parsed);
    }
  });
  return () => {
    const queuedLine = queued.shift();
    if (queuedLine) return Promise.resolve(queuedLine);
    return new Promise((resolve) => waiters.push(resolve));
  };
}

describe('Desktop attached MCP plugin bridge', () => {
  it('lists and calls exported plugin tools only on a write-authorized attachment', async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), 'serpent-attached-mcp-unit-'));
    roots.push(userDataPath);
    const record = {
      executionId: 'execution-1',
      source: 'mcp' as const,
      libraryId: 'library-1',
      sessionId: 'session-1',
      status: 'created' as const,
    };
    const pluginTool = listPluginMcpTools([{
      pluginId: 'com.example.mcp-probe',
      commandId: 'declared',
      title: 'Declared',
      mcpExported: true,
    }])[0]!;
    const pluginCall = vi.fn().mockResolvedValue({ status: 'succeeded' });
    const handle = await startDesktopAttachedMcp({
      userDataPath,
      journal: {
        create: vi.fn(() => record),
        start: vi.fn(() => ({ ...record, status: 'awaiting-authorization' as const })),
        authorizeFromDesktop: vi.fn(() => ({ ok: true, execution: { ...record, status: 'running' as const } })),
        cancel: vi.fn(),
      } as never,
      gateway: { execute: vi.fn() } as never,
      getActiveLibraryId: () => 'library-1',
      getLibrarySummary: async () => ({ libraryId: 'library-1', displayName: 'Test library' }),
      confirmAttach: async () => true,
      focusMainWindow: () => true,
      applySelection: () => ({
        libraryId: 'library-1',
        mode: 'replace' as const,
        selectedAssetIds: [],
        primaryAssetId: null,
        ignoredAssetIds: [],
      }),
      browseControl: {
        getState: vi.fn(),
        openFolder: vi.fn(),
        setDiscovery: vi.fn(),
        revealAsset: vi.fn(),
        openViewer: vi.fn(),
        closeViewer: vi.fn(),
        navigateViewer: vi.fn(),
      } as never,
      pluginTools: {
        list: (libraryId) => {
          expect(libraryId).toBe('library-1');
          return [pluginTool];
        },
        isKnown: () => true,
        call: pluginCall,
      },
      logger: { info: vi.fn(), error: vi.fn() },
    });

    const socket = typeof handle.endpointInfo.endpoint === 'string'
      ? net.createConnection(handle.endpointInfo.endpoint)
      : net.createConnection(handle.endpointInfo.endpoint);
    socket.setEncoding('utf8');
    const nextLine = lineReader(socket);
    try {
      await new Promise<void>((resolve) => socket.once('connect', resolve));
      socket.write(`${JSON.stringify({
        type: 'hello',
        protocolVersion: 1,
        nonce: handle.endpointInfo.nonce,
        clientName: 'unit-test',
        requestWriteAccess: true,
      })}\n`);
      await expect(nextLine()).resolves.toMatchObject({ type: 'hello.result', ok: true });

      socket.write(`${JSON.stringify({
        type: 'mcp.request',
        requestId: 'list-1',
        method: 'tools/list',
        params: {},
      })}\n`);
      const listed = await nextLine();
      const listResult = listed.result as { tools: Array<{ name: string }> };
      expect(listResult.tools.map((tool) => tool.name)).toContain(pluginTool.name);

      socket.write(`${JSON.stringify({
        type: 'mcp.request',
        requestId: 'call-1',
        method: 'tools/call',
        params: { name: pluginTool.name, arguments: { assetIds: ['asset-1'] } },
      })}\n`);
      const called = await nextLine();
      expect(called).toMatchObject({ type: 'mcp.response', requestId: 'call-1', ok: true });
      expect(pluginCall).toHaveBeenCalledWith(expect.objectContaining({
        pluginId: 'com.example.mcp-probe',
        commandId: 'declared',
        executionId: 'execution-1',
        libraryId: 'library-1',
        context: { assetIds: ['asset-1'] },
      }));
    } finally {
      socket.destroy();
      await handle.close();
    }
  });
});
