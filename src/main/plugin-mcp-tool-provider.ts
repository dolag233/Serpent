import type { PluginActivationCoordinator } from './plugin-activation-coordinator';
import {
  listPluginMcpTools,
  pluginMcpCommandContextSchema,
  type PluginMcpCommandContext,
  type PluginMcpToolDefinition,
} from '../mcp/plugin-tool-catalog';
import type { SerpentMcpPluginToolBridge } from '../mcp/call-tool';

/**
 * Main-owned bridge between MCP and active plugin command contributions.
 * Commands declared with `mcp.export` are listed and callable whenever the
 * owning plugin is active for the bound library. MCP still applies the local
 * write-access gate before invoking this bridge.
 */
export class PluginMcpToolProvider implements SerpentMcpPluginToolBridge {
  constructor(
    private readonly options: {
      activationCoordinator: PluginActivationCoordinator;
      getLibraryId: () => string | null;
    },
  ) {}

  list(libraryIdOverride?: string): readonly PluginMcpToolDefinition[] {
    const libraryId = libraryIdOverride ?? this.options.getLibraryId();
    if (libraryId === null) return [];
    const commands = this.options.activationCoordinator.listMcpCommandContributions({ libraryId });
    return listPluginMcpTools(commands);
  }

  isKnown(toolName: string, libraryIdOverride?: string): boolean {
    const libraryId = libraryIdOverride ?? this.options.getLibraryId();
    if (libraryId === null) return false;
    return this.list(libraryId).some((tool) => tool.name === toolName);
  }

  async call(input: {
    pluginId: string;
    commandId: string;
    context: unknown;
    executionId: string;
    libraryId?: string;
  }): Promise<unknown> {
    const libraryId = input.libraryId ?? this.options.getLibraryId();
    if (libraryId === null) throw new Error('Plugin MCP commands require an open library.');
    const command = this.options.activationCoordinator
      .listMcpCommandContributions({ libraryId })
      .find((candidate) => candidate.pluginId === input.pluginId && candidate.commandId === input.commandId);
    if (command === undefined || !command.mcpExported) {
      throw new Error('The plugin MCP command is not declared for export.');
    }
    const context: PluginMcpCommandContext = pluginMcpCommandContextSchema.parse(input.context);
    const result = await this.options.activationCoordinator.runCommand({
      libraryId,
      pluginId: command.pluginId,
      commandId: command.commandId,
      ...(context.assetIds === undefined ? {} : { assetIds: context.assetIds }),
      ...(context.folderIds === undefined ? {} : { folderIds: context.folderIds }),
      ...(context.collectionIds === undefined ? {} : { collectionIds: context.collectionIds }),
    });
    if (result.complete.status !== 'succeeded') {
      throw new Error('The plugin command did not complete successfully.');
    }
    return result.complete;
  }
}
