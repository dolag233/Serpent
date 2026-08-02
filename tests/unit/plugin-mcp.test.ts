import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getPluginMcpExportedCommandIds,
  pluginManifestSchema,
} from '../../src/plugins/plugin-manifest';
import {
  listPluginMcpTools,
  pluginMcpToolName,
} from '../../src/mcp/plugin-tool-catalog';
import { PluginMcpExposureStore } from '../../src/main/plugin-mcp-exposure-store';
import { PluginMcpToolProvider } from '../../src/main/plugin-mcp-tool-provider';
import { callSerpentMcpTool } from '../../src/mcp/call-tool';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('PLUGIN-031 manifest and MCP exposure contract', () => {
  it('accepts command-level declarations and keeps legacy top-level declarations', () => {
    const manifest = pluginManifestSchema.parse({
      manifestVersion: 1,
      id: 'com.example.mcp-probe',
      version: '1.0.0',
      name: 'MCP Probe',
      description: 'MCP probe',
      author: 'Serpent',
      license: 'MIT',
      engines: { serpent: '>=0.2.0 <1.0.0', pluginApi: 1 },
      runtime: { mode: 'restricted', entry: 'entry/main.js' },
      permissions: ['library.read'],
      contributes: {
        commands: [
          { id: 'declared', title: 'Declared', mcp: { export: true } },
          { id: 'legacy', title: 'Legacy' },
          { id: 'hidden', title: 'Hidden' },
        ],
      },
      mcp: { expose: ['legacy'] },
    });

    expect(getPluginMcpExportedCommandIds(manifest)).toEqual(new Set(['declared', 'legacy']));
  });

  it('exposes declared MCP commands by default and hides undeclared ones', () => {
    const commands = [
      {
        pluginId: 'com.example.mcp-probe',
        commandId: 'declared',
        title: 'Declared',
        mcpExported: true,
      },
      {
        pluginId: 'com.example.mcp-probe',
        commandId: 'hidden',
        title: 'Hidden',
        mcpExported: false,
      },
    ];
    const listed = listPluginMcpTools(commands);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      name: pluginMcpToolName('com.example.mcp-probe', 'declared'),
      pluginId: 'com.example.mcp-probe',
      commandId: 'declared',
    });
    expect(listed[0]?.inputSchema).not.toHaveProperty('path');
    expect(listed[0]?.inputSchema).not.toHaveProperty('secret');
  });

  it('persists optional device exposure records without paths or secrets', async () => {
    const userData = mkdtempSync(path.join(tmpdir(), 'serpent-plugin-mcp-'));
    roots.push(userData);
    const store = new PluginMcpExposureStore(userData);
    await store.load();

    expect(store.isEnabled('com.example.mcp-probe', 'declared')).toBe(false);
    await store.setEnabled({
      pluginId: 'com.example.mcp-probe',
      commandId: 'declared',
      enabled: true,
    });
    expect(store.isEnabled('com.example.mcp-probe', 'declared')).toBe(true);

    const persisted = readFileSync(path.join(userData, 'plugin-mcp-exposure.json'), 'utf8');
    expect(persisted).toContain('declared');
    expect(persisted).not.toMatch(/(?:path|secret|token|apiKey)/iu);

    await store.setEnabled({
      pluginId: 'com.example.mcp-probe',
      commandId: 'declared',
      enabled: false,
    });
    expect(store.isEnabled('com.example.mcp-probe', 'declared')).toBe(false);
  });
});

describe('PLUGIN-031 MCP call gate', () => {
  it('does not invoke an exported plugin command from a read-only MCP connection', async () => {
    const toolName = pluginMcpToolName('com.example.mcp-probe', 'declared');
    const result = await callSerpentMcpTool({
      toolName,
      arguments: { assetIds: ['asset-1'] },
      executionId: 'mcp-execution',
      exposure: { writeAccessGranted: false },
      gateway: {} as never,
      pluginTools: {
        list: () => listPluginMcpTools([{
          pluginId: 'com.example.mcp-probe',
          commandId: 'declared',
          title: 'Declared',
          mcpExported: true,
        }]),
        isKnown: () => true,
        call: async () => {
          throw new Error('must not be called');
        },
      },
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'MCP_TOOL_NOT_EXPOSED',
    });
  });

  it('lists only active exported plugin commands for the bound library', () => {
    const coordinator = {
      listMcpCommandContributions: vi.fn(() => [{
        pluginId: 'com.example.mcp-probe',
        commandId: 'declared',
        title: 'Declared',
        mcpExported: true as const,
      }]),
    };
    const provider = new PluginMcpToolProvider({
      activationCoordinator: coordinator as never,
      getLibraryId: () => 'library-1',
    });

    expect(provider.list()).toMatchObject([{
      name: pluginMcpToolName('com.example.mcp-probe', 'declared'),
    }]);
    expect(coordinator.listMcpCommandContributions).toHaveBeenCalledWith({ libraryId: 'library-1' });
  });

  it('refuses a plugin command that is not currently listed', async () => {
    const result = await callSerpentMcpTool({
      toolName: pluginMcpToolName('com.example.mcp-probe', 'declared'),
      arguments: { assetIds: ['asset-1'] },
      executionId: 'mcp-execution',
      exposure: { writeAccessGranted: true },
      gateway: {} as never,
      pluginTools: {
        list: () => [],
        isKnown: (toolName) => toolName === pluginMcpToolName('com.example.mcp-probe', 'declared'),
        call: async () => {
          throw new Error('must not be called');
        },
      },
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'MCP_TOOL_NOT_EXPOSED',
    });
  });

  it('routes a declared plugin command with only bounded context IDs', async () => {
    const calls: unknown[] = [];
    const toolName = pluginMcpToolName('com.example.mcp-probe', 'declared');
    const result = await callSerpentMcpTool({
      toolName,
      arguments: { assetIds: ['asset-1'] },
      executionId: 'mcp-execution',
      exposure: { writeAccessGranted: true },
      gateway: {} as never,
      pluginTools: {
        list: () => listPluginMcpTools([{
          pluginId: 'com.example.mcp-probe',
          commandId: 'declared',
          title: 'Declared',
          mcpExported: true,
        }]),
        isKnown: () => true,
        call: async (input) => {
          calls.push(input);
          return { status: 'succeeded' as const };
        },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      toolName,
      plugin: {
        pluginId: 'com.example.mcp-probe',
        commandId: 'declared',
      },
    });
    expect(calls).toEqual([expect.objectContaining({
      executionId: 'mcp-execution',
      context: { assetIds: ['asset-1'] },
    })]);
  });
});
