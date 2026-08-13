import type { PluginActivationCoordinator } from './plugin-activation-coordinator';
import type { PluginMcpExposureStore } from './plugin-mcp-exposure-store';
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
      exposureStore: PluginMcpExposureStore;
    },
  ) {}

  list(libraryIdOverride?: string): readonly PluginMcpToolDefinition[] {
    // The no-argument form is intentionally global: MCP tools/list is a
    // static catalogue and must not depend on the Desktop focused library.
    // Calls still pass an explicit libraryId and are checked against the
    // target library below.
    const commands = this.options.activationCoordinator.listMcpCommandContributions(
      libraryIdOverride === undefined ? {} : { libraryId: libraryIdOverride },
    );
    return listPluginMcpTools(commands, (command) => this.options.exposureStore.isEnabled(command.pluginId, command.commandId));
  }

  isKnown(toolName: string, libraryIdOverride?: string): boolean {
    const commands = this.options.activationCoordinator.listMcpCommandContributions(
      libraryIdOverride === undefined ? {} : { libraryId: libraryIdOverride },
    );
    // Deliberately ignore the local exposure switch here. The caller uses
    // this predicate to distinguish a known-but-disabled tool from an unknown
    // name; list() remains the user-visible exposure-filtered catalogue.
    return listPluginMcpTools(commands).some((tool) => tool.name === toolName);
  }

  async call(input: {
    pluginId: string;
    commandId: string;
    context: unknown;
    executionId: string;
    libraryId?: string;
    signal?: AbortSignal;
  }): Promise<unknown> {
    if (input.signal?.aborted) throw new Error('The plugin MCP command was cancelled.');
    const libraryId = input.libraryId;
    if (libraryId === undefined || libraryId.trim().length === 0) {
      throw new Error('Plugin MCP commands require an explicit libraryId.');
    }
    const command = this.options.activationCoordinator
      .listMcpCommandContributions({ libraryId })
      .find((candidate) => candidate.pluginId === input.pluginId && candidate.commandId === input.commandId);
    if (command === undefined || !command.mcpExported) {
      throw new Error('The plugin MCP command is not declared for export.');
    }
    if (!this.options.exposureStore.isEnabled(command.pluginId, command.commandId)) {
      throw new Error('The plugin MCP command is not enabled for MCP exposure.');
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
    if (input.signal?.aborted) throw new Error('The plugin MCP command was cancelled.');
    if (result.complete.status !== 'succeeded') {
      throw new Error('The plugin command did not complete successfully.');
    }
    return result.complete;
  }
}
