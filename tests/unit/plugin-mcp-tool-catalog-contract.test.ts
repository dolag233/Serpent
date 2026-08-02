import { describe, expect, it } from 'vitest';

import {
  listPluginMcpTools,
  parsePluginMcpToolArguments,
} from '../../src/mcp/plugin-tool-catalog';

describe('plugin MCP tool input schema', () => {
  it('advertises the same non-empty context constraint enforced at runtime', () => {
    const [tool] = listPluginMcpTools([{
      pluginId: 'com.example.mcp-probe',
      commandId: 'inspect',
      title: 'Inspect',
      mcpExported: true,
    }]);
    if (tool === undefined) throw new Error('Expected an exported plugin MCP tool.');

    expect(tool.inputSchema.properties.assetIds).toMatchObject({ minItems: 1, maxItems: 256 });
    expect(tool.inputSchema.properties.folderIds).toMatchObject({ minItems: 1, maxItems: 256 });
    expect(tool.inputSchema.properties.collectionIds).toMatchObject({ minItems: 1, maxItems: 256 });
    expect(() => parsePluginMcpToolArguments(tool, { assetIds: [] })).toThrow();
    expect(parsePluginMcpToolArguments(tool, { assetIds: ['asset-1'] })).toEqual({ assetIds: ['asset-1'] });
  });
});
