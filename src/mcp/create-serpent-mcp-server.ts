import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import type { AutomationCommandGateway, AutomationExecutionContext } from '../automation/command-gateway';
import { AUTOMATION_API_VERSION } from '../automation/command-registry';
import { callSerpentMcpTool, type SerpentMcpPluginToolBridge } from './call-tool';
import { shouldEmitCommandCompleted } from './command-completed-filter';
import type { PluginMcpToolDefinition } from './plugin-tool-catalog';
import { listSerpentMcpTools, mcpExposureAllowsWrite, type SerpentMcpToolExposure } from './tool-catalog';

export type SerpentMcpSessionEvent =
  | { type: 'context-changed' }
  | { type: 'tools-changed' }
  | { type: 'library-changed'; libraryId: string; changeSequence: number };

export interface SerpentMcpSessionBackend {
  getExecutionContext(): AutomationExecutionContext | undefined;
  getToolExposure(): SerpentMcpToolExposure;
  getPluginTools(): SerpentMcpPluginToolBridge | undefined;
  /** Last known library change sequence for the response echo (ADR-0031 §2). */
  getLibraryChangeSequence?(libraryId: string): number | undefined;
  subscribe?(listener: (event: SerpentMcpSessionEvent) => void): () => void;
}

export type SerpentMcpServerOptions = {
  backend: SerpentMcpSessionBackend;
  gateway: AutomationCommandGateway;
  serverName?: string;
  serverVersion?: string;
  /**
   * Desktop feedback for MCP tool results (Serpent-fmbr): fired only when a
   * non-read command actually executed (two-phase challenge reports excluded),
   * with the structured result so the renderer can show the same toast as the
   * manual operation. Read-only and failed calls deliberately emit nothing.
   */
  onCommandCompleted?: (input: {
    commandId: string;
    result: unknown;
  }) => void;
};

function toolResultText(payload: unknown): {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
} {
  const serialized = JSON.stringify(payload, null, 2);
  if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
    return {
      content: [{ type: 'text', text: serialized }],
      structuredContent: payload as Record<string, unknown>,
    };
  }
  return { content: [{ type: 'text', text: serialized }] };
}

/** Creates the only MCP protocol implementation used by Serpent. */
export function createSerpentMcpServer(options: SerpentMcpServerOptions): Server {
  const { backend, gateway } = options;
  const server = new Server(
    {
      name: options.serverName ?? 'serpent',
      version: options.serverVersion ?? String(AUTOMATION_API_VERSION),
    },
    { capabilities: { tools: { listChanged: true }, logging: {} } },
  );

  const currentExposure = (): SerpentMcpToolExposure => backend.getToolExposure();
  const pluginTools = (): readonly PluginMcpToolDefinition[] => {
    const exposure = currentExposure();
    const writeEnabled = mcpExposureAllowsWrite(exposure);
    if (!writeEnabled) return [];
    // Plugin tools are part of the static credential catalogue. A library
    // target, when required, is supplied in the individual call.
    const listed = backend.getPluginTools()?.list(undefined) ?? [];
    return listed;
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const listed = listSerpentMcpTools(currentExposure());
    const pluginDefinitions = pluginTools();
    const names = new Set(listed.tools.map((tool) => tool.name));
    for (const tool of pluginDefinitions) {
      if (names.has(tool.name)) throw new Error(`Duplicate MCP tool name: ${tool.name}`);
      names.add(tool.name);
    }
    return {
      tools: [
        ...listed.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
        })),
        ...pluginDefinitions.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
        })),
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const progressToken = request.params._meta?.progressToken;
    const reportProgress = progressToken === undefined
      ? undefined
      : async (progress: number, total = 1, message?: string): Promise<void> => {
        try {
          await extra.sendNotification({
            method: 'notifications/progress',
            params: {
              progressToken,
              progress,
              total,
              ...(message === undefined ? {} : { message }),
            },
          });
        } catch {
          // Progress is advisory. A disconnected notification stream must not
          // turn the underlying Gateway result into a second failure.
        }
      };
    await reportProgress?.(0, 1, 'Serpent is running the tool.');
    const result = await callSerpentMcpTool({
      toolName: request.params.name,
      arguments: request.params.arguments ?? {},
      context: backend.getExecutionContext(),
      exposure: currentExposure(),
      gateway,
      pluginTools: backend.getPluginTools(),
      ...(backend.getLibraryChangeSequence === undefined
        ? {}
        : { getLibraryChangeSequence: backend.getLibraryChangeSequence }),
      signal: extra.signal,
    });
    await reportProgress?.(1, 1, result.ok ? 'Serpent completed the tool.' : 'Serpent rejected the tool call.');
    if (result.ok && result.commandId !== undefined && result.plugin === undefined) {
      // Serpent-fmbr: only executed non-read commands surface on the desktop;
      // read calls and phase-1 challenge reports (nothing executed yet) stay quiet.
      if (shouldEmitCommandCompleted(result.commandId, result.result)) {
        options.onCommandCompleted?.({ commandId: result.commandId, result: result.result });
      }
    }
    if (!result.ok) {
      return {
        ...toolResultText({ ok: false, code: result.code, message: result.message, gateway: result.gateway }),
        isError: true,
      };
    }
    return toolResultText({
      ok: true,
      toolName: result.toolName,
      commandId: result.commandId,
      ...(result.plugin === undefined ? {} : { plugin: result.plugin }),
      ...(result.libraryId === undefined ? {} : { libraryId: result.libraryId }),
      ...(result.libraryChangeSequence === undefined
        ? {}
        : { libraryChangeSequence: result.libraryChangeSequence }),
      result: result.result,
      ...(result.undoGroupId === undefined ? {} : { undoGroupId: result.undoGroupId }),
    });
  });

  const unsubscribe = backend.subscribe?.((event) => {
    if (event.type === 'tools-changed') {
      void server.sendToolListChanged().catch(() => undefined);
    }
    if (event.type === 'library-changed') {
      void server.sendLoggingMessage({
        level: 'info',
        logger: 'serpent.library',
        data: { type: 'library.changed', libraryId: event.libraryId, changeSequence: event.changeSequence },
      }).catch(() => undefined);
    }
  });
  const close = server.close.bind(server);
  server.close = async () => {
    unsubscribe?.();
    await close();
  };
  return server;
}
