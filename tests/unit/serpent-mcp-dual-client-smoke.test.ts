import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import {
  createAutomationCommandGateway,
  type AutomationExecutionResolver,
  type AutomationWorkerClient,
} from '../../src/automation/command-gateway';
import { createSerpentMcpServer } from '../../src/mcp/create-serpent-mcp-server';
import { listSerpentMcpTools } from '../../src/mcp/tool-catalog';
import type { WorkerCommand } from '../../src/shared/protocol/requests';
import type { WorkerResult } from '../../src/shared/protocol/responses';
import { mcpContext, readCapabilities, readExposure } from './serpent-mcp-test-fixtures';

function resolver(): AutomationExecutionResolver {
  return {
    resolve: (executionId) => executionId === 'mcp-execution'
      ? {
          executionId: 'mcp-execution',
          source: 'mcp',
          libraryId: 'library-1',
          grantedCapabilities: [...readCapabilities],
        }
      : undefined,
  };
}

class RecordingWorker implements AutomationWorkerClient {
  readonly commands: WorkerCommand[] = [];

  async request(command: WorkerCommand): Promise<WorkerResult> {
    this.commands.push(command);
    if (command.type === 'library.list') {
      return {
        ok: true,
        type: 'library.list',
        libraries: [
          { libraryId: 'library-1', displayName: 'Selected', libraryPath: '/libraries/selected' },
        ],
      };
    }
    if (command.type === 'asset.search') {
      return {
        ok: true,
        type: 'asset.search.result',
        items: [],
        total: 0,
        offset: 0,
      };
    }
    throw new Error(`Unexpected worker command: ${command.type}`);
  }
}

describe('Serpent MCP dual-client smoke (Phase C)', () => {
  it('serves tools/list and tools/call to an MCP SDK Client over linked in-memory transport', async () => {
    const worker = new RecordingWorker();
    const gateway = createAutomationCommandGateway(worker, resolver());
    const server = createSerpentMcpServer({
      gateway,
      backend: {
        getExecutionContext: () => mcpContext(readExposure),
        getToolExposure: () => readExposure,
        getPluginTools: () => undefined,
      },
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'serpent-test-host-a', version: '1.0.0' });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const listed = await client.listTools();
    const catalogNames = listSerpentMcpTools(readExposure).tools.map((tool) => tool.name);
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual([...catalogNames].sort());
    // Requestable tools stay discoverable while the Permission Broker owns the
    // ask/allow decision at call time.
    expect(listed.tools.map((tool) => tool.name)).toContain('serpent_tag_create');

    const called = await client.callTool({
      name: 'serpent_library_inspect',
      arguments: { libraryId: 'library-1' },
    });
    expect(called.isError).not.toBe(true);
    const text = Array.isArray(called.content)
      ? called.content.find((part) => part.type === 'text' && 'text' in part)
      : undefined;
    expect(text && 'text' in text ? text.text : '').toContain('"libraryId": "library-1"');
    expect(worker.commands).toEqual([{ type: 'library.list' }]);

    await client.close();
    await server.close();
  });

  it('serves the same Registry tools to a second MCP SDK Client identity', async () => {
    const worker = new RecordingWorker();
    const gateway = createAutomationCommandGateway(worker, resolver());
    const server = createSerpentMcpServer({
      gateway,
      backend: {
        getExecutionContext: () => mcpContext(readExposure),
        getToolExposure: () => readExposure,
        getPluginTools: () => undefined,
      },
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'serpent-test-host-b', version: '2.0.0' });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const listed = await client.listTools();
    expect(listed.tools.some((tool) => tool.name === 'serpent_asset_search')).toBe(true);
    const search = await client.callTool({
      name: 'serpent_asset_search',
      arguments: { libraryId: 'library-1', query: null, limit: 10 },
    });
    expect(search.isError).not.toBe(true);
    expect(worker.commands.some((command) => command.type === 'asset.search')).toBe(true);

    await client.close();
    await server.close();
  });
});
