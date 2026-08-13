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
import { mcpContext, readExposure, writeExposure } from './serpent-mcp-test-fixtures';

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
  it('returns not found for an unknown tool before parsing plugin-only arguments', async () => {
    const result = await callSerpentMcpTool({
      toolName: 'serpent_plugin_unknown_command',
      arguments: {},
      context: mcpContext(writeExposure),
      exposure: writeExposure,
      gateway: {} as never,
      pluginTools: {
        list: () => [],
        isKnown: () => false,
        call: async () => ({ status: 'succeeded' as const }),
      },
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'MCP_TOOL_NOT_FOUND',
    });
  });

  it('rejects a plugin call without an explicit libraryId', async () => {
    const result = await callSerpentMcpTool({
      toolName: pluginMcpToolName('com.example.mcp-probe', 'declared'),
      arguments: { assetIds: ['asset-1'] },
      context: mcpContext(writeExposure),
      exposure: writeExposure,
      gateway: {} as never,
      pluginTools: {
        list: () => [],
        isKnown: () => true,
        call: async () => ({ status: 'succeeded' as const }),
      },
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'MCP_LIBRARY_TARGET_REQUIRED',
    });
  });

  it('does not invoke an exported plugin command from a read-only MCP connection', async () => {
    const toolName = pluginMcpToolName('com.example.mcp-probe', 'declared');
    const result = await callSerpentMcpTool({
      toolName,
      arguments: { libraryId: 'library-1', assetIds: ['asset-1'] },
      context: mcpContext(readExposure),
      exposure: readExposure,
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

  it('lists exported plugin commands without consulting the Desktop focused library', async () => {
    const coordinator = {
      listMcpCommandContributions: vi.fn(() => [{
        pluginId: 'com.example.mcp-probe',
        commandId: 'declared',
        title: 'Declared',
        mcpExported: true as const,
      }]),
    };
    const exposureStore = new PluginMcpExposureStore(
      mkdtempSync(path.join(tmpdir(), 'serpent-plugin-mcp-exposure-')),
    );
    await exposureStore.setEnabled({
      pluginId: 'com.example.mcp-probe',
      commandId: 'declared',
      enabled: true,
    });
    const provider = new PluginMcpToolProvider({
      activationCoordinator: coordinator as never,
      exposureStore,
    });

    expect(provider.list()).toMatchObject([{
      name: pluginMcpToolName('com.example.mcp-probe', 'declared'),
    }]);
    expect(coordinator.listMcpCommandContributions).toHaveBeenCalledWith({});
  });

  it('keeps a disabled plugin known but refuses direct provider execution', async () => {
    const coordinator = {
      listMcpCommandContributions: vi.fn(() => [{
        pluginId: 'com.example.mcp-probe',
        commandId: 'declared',
        title: 'Declared',
        mcpExported: true as const,
      }]),
      runCommand: vi.fn(),
    };
    const exposureStore = new PluginMcpExposureStore(
      mkdtempSync(path.join(tmpdir(), 'serpent-plugin-mcp-disabled-')),
    );
    const provider = new PluginMcpToolProvider({
      activationCoordinator: coordinator as never,
      exposureStore,
    });

    expect(provider.isKnown(pluginMcpToolName('com.example.mcp-probe', 'declared'), 'library-1')).toBe(true);
    await expect(provider.call({
      pluginId: 'com.example.mcp-probe',
      commandId: 'declared',
      context: { assetIds: ['asset-1'] },
      executionId: 'execution-1',
      libraryId: 'library-1',
    })).rejects.toThrow('not enabled');
    expect(coordinator.runCommand).not.toHaveBeenCalled();
  });

  it('refuses a plugin command that is not currently listed', async () => {
    const result = await callSerpentMcpTool({
      toolName: pluginMcpToolName('com.example.mcp-probe', 'declared'),
      arguments: { libraryId: 'library-1', assetIds: ['asset-1'] },
      context: mcpContext(writeExposure),
      exposure: writeExposure,
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
      arguments: { libraryId: 'library-1', assetIds: ['asset-1'] },
      context: mcpContext(writeExposure),
      exposure: writeExposure,
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
