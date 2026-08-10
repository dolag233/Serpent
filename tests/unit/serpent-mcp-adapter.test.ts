import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import {
  createAutomationCommandGateway,
  type AutomationExecutionResolver,
  type AutomationWorkerClient,
} from '../../src/automation/command-gateway';
import { callSerpentMcpTool, type SerpentMcpPluginToolBridge } from '../../src/mcp/call-tool';
import { createSerpentMcpServer } from '../../src/mcp/create-serpent-mcp-server';
import { listSerpentMcpTools, resolveSerpentMcpTool, type SerpentMcpToolExposure } from '../../src/mcp/tool-catalog';
import type { WorkerCommand } from '../../src/shared/protocol/requests';
import type { WorkerResult } from '../../src/shared/protocol/responses';
import {
  mcpContext,
  readCapabilities,
  readExposure,
  writeExposure,
} from './serpent-mcp-test-fixtures';
import { McpPermissionBroker } from '../../src/main/mcp-permission-broker';
import { McpPermissionPolicyStore } from '../../src/main/mcp-permission-policy-store';
import { McpOperationChallengeStore } from '../../src/main/mcp-operation-challenge';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const challengeRoots: string[] = [];

afterEach(() => {
  for (const root of challengeRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});
function createTestPermissionBroker(): McpPermissionBroker {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-mcp-challenge-'));
  challengeRoots.push(root);
  return new McpPermissionBroker({
    policyStore: new McpPermissionPolicyStore(root),
    challengeStore: new McpOperationChallengeStore(),
  });
}

function backend(
  exposure: SerpentMcpToolExposure = readExposure,
  pluginTools?: SerpentMcpPluginToolBridge,
) {
  return {
    getExecutionContext: () => mcpContext(exposure),
    getToolExposure: () => exposure,
    getPluginTools: () => pluginTools,
  };
}

function resolver(): AutomationExecutionResolver {
  return {
    resolve: (executionId) => executionId === 'mcp-execution'
      ? {
          executionId: 'mcp-execution',
          source: 'mcp',
          clientCredentialId: 'test-credential',
          libraryId: 'library-1',
          grantedCapabilities: [...readCapabilities],
        }
      : undefined,
  };
}

class RecordingWorker implements AutomationWorkerClient {
  readonly commands: WorkerCommand[] = [];

  constructor(private readonly nextResult: WorkerResult) {}

  async request(command: WorkerCommand): Promise<WorkerResult> {
    this.commands.push(command);
    return this.nextResult;
  }
}

describe('Serpent MCP tool catalog', () => {
  it('lists requestable Registry tools even when ordinary write permissions are still ask-on-call', () => {
    const listed = listSerpentMcpTools(readExposure);
    expect(listed.apiVersion).toBe(1);
    expect(listed.tools.length).toBeGreaterThan(0);
    expect(listed.tools.map((tool) => tool.name)).toContain('serpent_asset_search');
    expect(listed.tools.map((tool) => tool.name)).toContain('serpent_library_change_sequence');
    expect(listed.tools.map((tool) => tool.name)).toContain('serpent_asset_ai_content_get');
    expect(listed.tools.map((tool) => tool.name)).toContain('serpent_execution_status');
    expect(listed.tools.map((tool) => tool.name)).toContain('serpent_ui_notify');
    expect(listed.tools.map((tool) => tool.name)).toContain('serpent_tag_create');
    expect(listed.tools.map((tool) => tool.name)).toContain('serpent_folder_create');
    expect(listed.tools.find((tool) => tool.name === 'serpent_tag_create')).toMatchObject({
      riskTier: 'controlled',
      requestableCapabilities: ['tag.write'],
      canPersistPermission: true,
    });
  });

  it('exposes execution- and plan-approved write tools after local write access is granted', () => {
    const listed = listSerpentMcpTools(writeExposure);
    const names = listed.tools.map((tool) => tool.name);
    expect(names).toContain('serpent_tag_create');
    expect(names).toContain('serpent_folder_create');
    expect(names).toContain('serpent_collection_create');
    expect(names).toContain('serpent_ai_enqueue');
    expect(names).toContain('serpent_library_create');
    expect(names).toContain('serpent_file_import');
    expect(names).toContain('serpent_asset_trash');
    expect(names).toContain('serpent_asset_move');
    expect(names).toContain('serpent_asset_rename_file');
    expect(listed.tools.every((tool) => tool.approvalPolicy === 'none'
      || tool.approvalPolicy === 'execution'
      || tool.approvalPolicy === 'plan')).toBe(true);
  });

  it('keeps MCP tool names Registry-owned and free of eval/shell/sql surfaces', () => {
    const listed = listSerpentMcpTools(writeExposure);
    const forbidden = /(?:^|_)(?:eval|shell|sql|fetch|net|fs|process|exec)(?:_|$)/iu;
    for (const tool of listed.tools) {
      expect(tool.name).toMatch(/^serpent_[a-z0-9_]+$/u);
      expect(tool.name).not.toMatch(forbidden);
      expect(tool.inputSchema).toBeTypeOf('object');
      expect(tool.annotations.openWorldHint).toBe(false);
    }
    expect(resolveSerpentMcpTool('serpent_eval_code', writeExposure)).toBeUndefined();
  });

  it('exposes explicit filesystem paths and library targets to MCP clients', () => {
    const listed = listSerpentMcpTools(writeExposure);
    const libraryCreate = listed.tools.find((tool) => tool.name === 'serpent_library_create');
    const fileImport = listed.tools.find((tool) => tool.name === 'serpent_file_import');
    expect(libraryCreate?.inputSchema).toHaveProperty('properties.selectedParentPath');
    expect(fileImport?.inputSchema).toHaveProperty('properties.sourcePaths');
    expect(fileImport?.inputSchema).toHaveProperty('properties.libraryId');
  });
});

describe('Serpent MCP tools/call → Gateway', () => {
  it('routes a public tool through the Gateway with source mcp', async () => {
    const worker = new RecordingWorker({
      ok: true,
      type: 'library.list',
      libraries: [
        { libraryId: 'library-other', displayName: 'Other', libraryPath: '/libraries/other' },
        { libraryId: 'library-1', displayName: 'Selected', libraryPath: '/libraries/selected' },
      ],
    });
    const gateway = createAutomationCommandGateway(worker, resolver());
    const result = await callSerpentMcpTool({
      toolName: 'serpent_library_inspect',
      arguments: { libraryId: 'library-1' },
      context: mcpContext(readExposure),
      exposure: readExposure,
      gateway,
    });
    expect(result).toMatchObject({
      ok: true,
      commandId: 'library.inspect',
      result: { libraryId: 'library-1', displayName: 'Selected' },
    });
    expect(result).toEqual(expect.objectContaining({
      ok: true,
      result: { libraryId: 'library-1', displayName: 'Selected' },
    }));
    if (result.ok) {
      expect(result.result).not.toHaveProperty('libraryPath');
    }
    expect(worker.commands).toEqual([{ type: 'library.list' }]);
  });

  it('forwards an MCP request abort signal into the Gateway', async () => {
    const worker = new RecordingWorker({ ok: true, type: 'library.list', libraries: [] });
    const controller = new AbortController();
    controller.abort();
    const gateway = createAutomationCommandGateway(worker, resolver());
    const result = await callSerpentMcpTool({
      toolName: 'serpent_library_inspect',
      arguments: { libraryId: 'library-1' },
      context: mcpContext(readExposure),
      exposure: readExposure,
      gateway,
      signal: controller.signal,
    });
    expect(result).toMatchObject({
      ok: false,
      code: 'AUTOMATION_EXECUTION_CANCELLED',
    });
    expect(worker.commands).toHaveLength(0);
  });

  it('returns execution status through the Gateway without Worker dispatch', async () => {
    const worker = new RecordingWorker({ ok: true, type: 'library.list', libraries: [] });
    const gateway = createAutomationCommandGateway(worker, resolver(), {
      executionStatusHandler: {
        getStatus: (executionId) => executionId === 'mcp-execution'
          ? {
              source: 'mcp',
              projection: {
                executionId: 'mcp-execution',
                status: 'running',
                commandCount: 1,
                succeededCommandCount: 1,
                failedCommandCount: 0,
                lastCommandId: 'library.inspect',
                failureCode: null,
                deadlineAt: '2026-07-31T13:00:00.000Z',
                createdAt: '2026-07-31T12:30:00.000Z',
                finishedAt: null,
                summary: null,
              },
            }
          : undefined,
      },
    });
    const result = await callSerpentMcpTool({
      toolName: 'serpent_execution_status',
      arguments: {},
      context: mcpContext(readExposure),
      exposure: readExposure,
      gateway,
    });
    expect(result).toMatchObject({
      ok: true,
      commandId: 'execution.status',
      result: {
        executionId: 'mcp-execution',
        status: 'running',
        commandCount: 1,
      },
    });
    expect(worker.commands).toHaveLength(0);
  });

  it('normalizes toolbar-style asset.search query strings for MCP like Desktop Console', async () => {
    const worker = new RecordingWorker({
      ok: true,
      type: 'asset.search.result',
      items: [],
      total: 0,
      offset: 0,
    });
    const gateway = createAutomationCommandGateway(worker, {
      resolve: (executionId) => executionId === 'mcp-execution'
        ? {
            executionId: 'mcp-execution',
            source: 'mcp',
            libraryId: 'library-1',
            grantedCapabilities: [...readCapabilities],
          }
        : undefined,
    });
    const result = await callSerpentMcpTool({
      toolName: 'serpent_asset_search',
      arguments: { libraryId: 'library-1', query: 'name:sunny', limit: 50 },
      context: mcpContext(readExposure),
      exposure: readExposure,
      gateway,
    });
    expect(result).toMatchObject({ ok: true, commandId: 'asset.search' });
    expect(worker.commands).toEqual([
      expect.objectContaining({
        type: 'asset.search',
        libraryId: 'library-1',
        query: {
          clauses: [{ field: 'filename', values: ['sunny'], exclude: false }],
        },
        limit: 50,
      }),
    ]);
  });

  it('allows ordinary Auto writes without a human permission prompt', async () => {
    const worker = new RecordingWorker({
      ok: true,
      type: 'tag.created',
      tag: { tagId: 'tag-1', name: 'x', assetCount: 0 },
    });
    const gateway = createAutomationCommandGateway(worker, resolver(), {
      permissionBroker: {
        authorize: async () => ({ allowed: true, scope: 'already-granted' as const }),
        clearExecution: () => undefined,
        clearCredential: () => undefined,
        clearCapability: () => undefined,
      },
    });
    const result = await callSerpentMcpTool({
      toolName: 'serpent_tag_create',
      arguments: { libraryId: 'library-1', name: 'x' },
      context: mcpContext(readExposure),
      exposure: readExposure,
      gateway,
    });
    expect(result).toMatchObject({ ok: true, commandId: 'tag.create' });
    expect(worker.commands).toHaveLength(1);
  });

  it('requires a Main-bound executionId', async () => {
    const worker = new RecordingWorker({ ok: true, type: 'library.list', libraries: [] });
    const gateway = createAutomationCommandGateway(worker, resolver());
    const result = await callSerpentMcpTool({
      toolName: 'serpent_library_inspect',
      arguments: { libraryId: 'library-1' },
      context: undefined,
      exposure: readExposure,
      gateway,
    });
    expect(result).toMatchObject({ ok: false, code: 'MCP_EXECUTION_REQUIRED' });
  });

  it('builds an MCP Server whose tools stay Registry-backed', () => {
    const worker = new RecordingWorker({ ok: true, type: 'library.list', libraries: [] });
    const gateway = createAutomationCommandGateway(worker, resolver());
    const server = createSerpentMcpServer({
      gateway,
      backend: backend(readExposure),
    });
    expect(server).toBeTruthy();
    expect(listSerpentMcpTools(readExposure).tools.map((tool) => tool.name))
      .toContain('serpent_asset_search');
  });

  it('keeps exported plugin tools behind the local write-access gate', async () => {
    const worker = new RecordingWorker({ ok: true, type: 'library.list', libraries: [] });
    const gateway = createAutomationCommandGateway(worker, resolver());
    const pluginTool = {
      name: 'serpent_plugin_com_example_probe_declared',
      description: 'Declared plugin command',
      pluginId: 'com.example.probe',
      commandId: 'declared',
      inputSchema: {
        type: 'object' as const,
        additionalProperties: false as const,
        properties: {},
        anyOf: [{ required: ['assetIds'] }],
      },
    };
    const pluginTools = {
      list: () => [pluginTool],
      isKnown: () => true,
      call: async () => ({ status: 'succeeded' }),
    };
    const readOnlyServer = createSerpentMcpServer({
      gateway,
      backend: backend(readExposure, pluginTools),
    });
    const [readClientTransport, readServerTransport] = InMemoryTransport.createLinkedPair();
    const readClient = new Client({ name: 'plugin-read-only', version: '1.0.0' });
    await Promise.all([
      readOnlyServer.connect(readServerTransport),
      readClient.connect(readClientTransport),
    ]);
    expect((await readClient.listTools()).tools.map((tool) => tool.name))
      .not.toContain(pluginTool.name);
    const denied = await readClient.callTool({ name: pluginTool.name, arguments: { assetIds: ['asset-1'] } });
    expect(denied.isError).toBe(true);
    expect(JSON.stringify(denied.content)).toContain('MCP_TOOL_NOT_EXPOSED');
    await readClient.close();
    await readOnlyServer.close();

    const writeServer = createSerpentMcpServer({
      gateway,
      backend: backend(writeExposure, pluginTools),
    });
    const [writeClientTransport, writeServerTransport] = InMemoryTransport.createLinkedPair();
    const writeClient = new Client({ name: 'plugin-write', version: '1.0.0' });
    await Promise.all([
      writeServer.connect(writeServerTransport),
      writeClient.connect(writeClientTransport),
    ]);
    expect((await writeClient.listTools()).tools.map((tool) => tool.name)).toContain(pluginTool.name);
    const called = await writeClient.callTool({ name: pluginTool.name, arguments: { assetIds: ['asset-1'] } });
    expect(called.isError).not.toBe(true);
    await writeClient.close();
    await writeServer.close();
  });
});

describe('Serpent MCP dangerous two-phase challenge (Serpent-8b5b.2)', () => {
  function dangerousGateway(worker: RecordingWorker) {
    return createAutomationCommandGateway(worker, resolver(), {
      permissionBroker: createTestPermissionBroker(),
    });
  }

  it('issues a risk report on the first call and executes only the exact second call', async () => {
    const worker = new RecordingWorker({
      ok: true,
      type: 'asset.deleted-permanent',
      deletedCount: 1,
      skippedCount: 0,
      skippedReasons: [],
    });
    const gateway = dangerousGateway(worker);
    const input = {
      libraryId: 'library-1',
      assetIds: ['00000000-0000-4000-8000-000000000010'],
    };
    const first = await callSerpentMcpTool({
      toolName: 'serpent_asset_delete_permanent',
      arguments: input,
      context: mcpContext(readExposure),
      exposure: readExposure,
      gateway,
    });
    expect(first).toMatchObject({
      ok: true,
      commandId: 'asset.delete-permanent',
      result: { status: 'confirmation-required', severity: 'dangerous' },
    });
    // Nothing executed on the first call.
    expect(worker.commands).toHaveLength(0);
    if (!first.ok) throw new Error('expected challenge result');
    const challenge = first.result as { challengeId: string; planHash: string | null };

    const confirmed = await callSerpentMcpTool({
      toolName: 'serpent_asset_delete_permanent',
      arguments: {
        ...input,
        challengeId: challenge.challengeId,
        planHash: challenge.planHash,
        acknowledged: true,
        idempotencyKey: 'delete-permanent-1',
      },
      context: mcpContext(readExposure),
      exposure: readExposure,
      gateway,
    });
    expect(confirmed).toMatchObject({
      ok: true,
      commandId: 'asset.delete-permanent',
      result: { deletedCount: 1 },
    });
    expect(worker.commands).toHaveLength(1);
    expect(worker.commands[0]).toMatchObject({
      type: 'asset.delete-permanent',
      libraryId: 'library-1',
      assetIds: ['00000000-0000-4000-8000-000000000010'],
    });
    // The worker command must not carry challenge confirmation fields.
    expect(JSON.stringify(worker.commands[0])).not.toContain('challengeId');
    expect(JSON.stringify(worker.commands[0])).not.toContain('acknowledged');
  });

  it('rejects a stale or forged second call and still executes nothing', async () => {
    const worker = new RecordingWorker({
      ok: true,
      type: 'asset.deleted-permanent',
      deletedCount: 1,
      skippedCount: 0,
      skippedReasons: [],
    });
    const gateway = dangerousGateway(worker);
    const input = {
      libraryId: 'library-1',
      assetIds: ['00000000-0000-4000-8000-000000000010'],
    };
    const first = await callSerpentMcpTool({
      toolName: 'serpent_asset_delete_permanent',
      arguments: input,
      context: mcpContext(readExposure),
      exposure: readExposure,
      gateway,
    });
    if (!first.ok) throw new Error('expected challenge result');

    const forged = await callSerpentMcpTool({
      toolName: 'serpent_asset_delete_permanent',
      arguments: {
        ...input,
        challengeId: '00000000-0000-4000-8000-0000000000ff',
        planHash: null,
        acknowledged: true,
        idempotencyKey: 'delete-permanent-forged',
      },
      context: mcpContext(readExposure),
      exposure: readExposure,
      gateway,
    });
    expect(forged).toMatchObject({ ok: true, result: { status: 'confirmation-required' } });
    expect(worker.commands).toHaveLength(0);
  });
});
