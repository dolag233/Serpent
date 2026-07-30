import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import type { AutomationCommandGateway } from '../automation/command-gateway';
import { AUTOMATION_API_VERSION } from '../automation/command-registry';
import { callSerpentMcpTool } from './call-tool';
import { listSerpentMcpTools, type SerpentMcpToolExposure } from './tool-catalog';

export type SerpentMcpServerOptions = {
  gateway: AutomationCommandGateway;
  /**
   * Main-owned execution for this MCP connection. Callers must create it with
   * `source: 'mcp'` and a session id before exposing tools/call.
   */
  getExecutionId: () => string | undefined;
  getExposure?: () => SerpentMcpToolExposure;
  serverName?: string;
  serverVersion?: string;
};

function toolResultText(payload: unknown): {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
} {
  const text = JSON.stringify(payload, null, 2);
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return {
      content: [{ type: 'text', text }],
      structuredContent: payload as Record<string, unknown>,
    };
  }
  return {
    content: [{ type: 'text', text }],
  };
}

/**
 * Creates a stdio-ready MCP Server whose tools are generated from the
 * Automation Registry and dispatched only through the Gateway.
 */
export function createSerpentMcpServer(options: SerpentMcpServerOptions): Server {
  const server = new Server(
    {
      name: options.serverName ?? 'serpent-mcp',
      version: options.serverVersion ?? String(AUTOMATION_API_VERSION),
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  const exposure = (): SerpentMcpToolExposure => options.getExposure?.() ?? { writeAccessGranted: false };

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const listed = listSerpentMcpTools(exposure());
    return {
      tools: listed.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await callSerpentMcpTool({
      toolName: request.params.name,
      arguments: request.params.arguments ?? {},
      executionId: options.getExecutionId(),
      exposure: exposure(),
      gateway: options.gateway,
    });

    if (!result.ok) {
      const errorPayload = {
        ok: false as const,
        code: result.code,
        message: result.message,
        gateway: result.gateway,
      };
      return {
        ...toolResultText(errorPayload),
        isError: true,
      };
    }

    return toolResultText({
      ok: true,
      toolName: result.toolName,
      commandId: result.commandId,
      result: result.result,
      truncated: result.truncated,
    });
  });

  return server;
}

/**
 * Binds the Serpent MCP Server to process stdio. Diagnostics must stay on
 * stderr; stdout is reserved for MCP JSON-RPC frames.
 */
export async function connectSerpentMcpStdio(server: Server): Promise<StdioServerTransport> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return transport;
}
