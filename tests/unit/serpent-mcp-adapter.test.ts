import { describe, expect, it } from 'vitest';

import {
  createAutomationCommandGateway,
  type AutomationExecutionResolver,
  type AutomationWorkerClient,
} from '../../src/automation/command-gateway';
import { automationCommandRegistry } from '../../src/automation/command-registry';
import { callSerpentMcpTool } from '../../src/mcp/call-tool';
import { createSerpentMcpServer } from '../../src/mcp/create-serpent-mcp-server';
import { listSerpentMcpTools, resolveSerpentMcpTool } from '../../src/mcp/tool-catalog';
import type { WorkerCommand } from '../../src/shared/protocol/requests';
import type { WorkerResult } from '../../src/shared/protocol/responses';

const readCapabilities = [
  'library.read',
  'folder.read',
  'asset.read',
  'metadata.read',
  'tag.read',
  'collection.read',
  'job.read',
] as const;

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

  constructor(private readonly nextResult: WorkerResult) {}

  async request(command: WorkerCommand): Promise<WorkerResult> {
    this.commands.push(command);
    return this.nextResult;
  }
}

describe('Serpent MCP tool catalog', () => {
  it('lists only public Registry tools when write access is not granted', () => {
    const listed = listSerpentMcpTools({ writeAccessGranted: false });
    expect(listed.apiVersion).toBe(1);
    expect(listed.tools.length).toBeGreaterThan(0);
    expect(listed.tools.every((tool) => tool.annotations.readOnlyHint)).toBe(true);
    expect(listed.tools.map((tool) => tool.name)).toContain('serpent_asset_search');
    expect(listed.tools.map((tool) => tool.name)).not.toContain('serpent_tag_create');
    expect(listed.tools.map((tool) => tool.name)).not.toContain('serpent_folder_create');
  });

  it('exposes execution-approved write tools after local write access is granted, not plan-gated file ops', () => {
    const listed = listSerpentMcpTools({ writeAccessGranted: true });
    const names = listed.tools.map((tool) => tool.name);
    expect(names).toContain('serpent_tag_create');
    expect(names).toContain('serpent_folder_create');
    expect(names).toContain('serpent_collection_create');
    expect(names).toContain('serpent_ai_enqueue');
    expect(names).not.toContain('serpent_asset_trash');
    expect(names).not.toContain('serpent_asset_rename_file');
    expect(listed.tools.every((tool) => tool.approvalPolicy === 'none' || tool.approvalPolicy === 'execution')).toBe(true);
  });

  it('keeps MCP tool names Registry-owned and free of eval/shell/sql surfaces', () => {
    const listed = listSerpentMcpTools({ writeAccessGranted: true });
    for (const tool of listed.tools) {
      expect(tool.name).toMatch(/^serpent_[a-z0-9_]+$/u);
      expect(tool.name).not.toMatch(/eval|shell|sql|fetch|net|fs|process|exec/iu);
      expect(tool.inputSchema).toBeTypeOf('object');
      expect(tool.annotations.openWorldHint).toBe(false);
    }
    expect(resolveSerpentMcpTool('serpent_eval_code')).toBeUndefined();
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
      arguments: {},
      executionId: 'mcp-execution',
      exposure: { writeAccessGranted: false },
      gateway,
    });
    expect(result).toMatchObject({
      ok: true,
      commandId: 'library.inspect',
      result: { libraryId: 'library-1', displayName: 'Selected' },
    });
    expect(worker.commands).toEqual([{ type: 'library.list' }]);
  });

  it('rejects write tools until write access is configured', async () => {
    // Worker result is unused: exposure gate rejects before Gateway dispatch.
    const worker = new RecordingWorker({ ok: true, type: 'tag.list', tags: [] });
    const gateway = createAutomationCommandGateway(worker, resolver());
    const result = await callSerpentMcpTool({
      toolName: 'serpent_tag_create',
      arguments: { name: 'x' },
      executionId: 'mcp-execution',
      exposure: { writeAccessGranted: false },
      gateway,
    });
    expect(result).toMatchObject({ ok: false, code: 'MCP_TOOL_NOT_EXPOSED' });
    expect(worker.commands).toHaveLength(0);
  });

  it('requires a Main-bound executionId', async () => {
    const worker = new RecordingWorker({ ok: true, type: 'library.list', libraries: [] });
    const gateway = createAutomationCommandGateway(worker, resolver());
    const result = await callSerpentMcpTool({
      toolName: 'serpent_library_inspect',
      arguments: {},
      executionId: undefined,
      exposure: { writeAccessGranted: false },
      gateway,
    });
    expect(result).toMatchObject({ ok: false, code: 'MCP_EXECUTION_REQUIRED' });
  });

  it('builds an MCP Server whose tools stay Registry-backed', () => {
    const worker = new RecordingWorker({ ok: true, type: 'library.list', libraries: [] });
    const gateway = createAutomationCommandGateway(worker, resolver());
    const server = createSerpentMcpServer({
      gateway,
      getExecutionId: () => 'mcp-execution',
      getExposure: () => ({ writeAccessGranted: false }),
    });
    expect(server).toBeTruthy();
    expect(listSerpentMcpTools({ writeAccessGranted: false }).tools.map((tool) => tool.name))
      .toContain('serpent_asset_search');
  });
});
