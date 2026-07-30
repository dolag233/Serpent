import {
  AUTOMATION_API_VERSION,
  type AutomationCommandId,
} from '../automation/command-registry';
import type {
  AutomationCommandEnvelope,
  AutomationCommandGateway,
  AutomationGatewayResult,
} from '../automation/command-gateway';
import { resolveSerpentMcpTool, type SerpentMcpToolExposure } from './tool-catalog';

export type SerpentMcpCallToolSuccess = {
  ok: true;
  toolName: string;
  commandId: AutomationCommandId;
  result: unknown;
  truncated: boolean;
};

export type SerpentMcpCallToolFailure = {
  ok: false;
  code:
    | 'MCP_TOOL_NOT_FOUND'
    | 'MCP_TOOL_NOT_EXPOSED'
    | 'MCP_EXECUTION_REQUIRED'
    | 'MCP_GATEWAY_FAILURE';
  message: string;
  gateway?: AutomationGatewayResult;
};

export type SerpentMcpCallToolResult = SerpentMcpCallToolSuccess | SerpentMcpCallToolFailure;

export type SerpentMcpCallToolInput = {
  toolName: string;
  arguments: unknown;
  executionId: string | undefined;
  exposure: SerpentMcpToolExposure;
  gateway: AutomationCommandGateway;
};

/**
 * Maps one MCP tools/call into a Gateway envelope. The adapter never chooses
 * libraryId, source, or capabilities — those stay on the Main-owned execution.
 */
export async function callSerpentMcpTool(
  input: SerpentMcpCallToolInput,
): Promise<SerpentMcpCallToolResult> {
  const tool = resolveSerpentMcpTool(input.toolName, input.exposure);
  if (!tool) {
    const knownWithoutWrite = resolveSerpentMcpTool(input.toolName, { writeAccessGranted: true });
    if (knownWithoutWrite && !input.exposure.writeAccessGranted) {
      return {
        ok: false,
        code: 'MCP_TOOL_NOT_EXPOSED',
        message: `Tool ${input.toolName} requires local write access configuration.`,
      };
    }
    return {
      ok: false,
      code: 'MCP_TOOL_NOT_FOUND',
      message: `Unknown Serpent MCP tool: ${input.toolName}`,
    };
  }

  if (input.executionId === undefined || input.executionId.trim().length === 0) {
    return {
      ok: false,
      code: 'MCP_EXECUTION_REQUIRED',
      message: 'MCP tools/call requires a Main-bound automation executionId.',
    };
  }

  const envelope: AutomationCommandEnvelope = {
    apiVersion: AUTOMATION_API_VERSION,
    commandId: tool.commandId,
    executionId: input.executionId,
    input: input.arguments ?? {},
  };

  const gatewayResult = await input.gateway.execute(envelope);
  if (!gatewayResult.ok) {
    return {
      ok: false,
      code: 'MCP_GATEWAY_FAILURE',
      message: 'Automation Gateway rejected the MCP tool call.',
      gateway: gatewayResult,
    };
  }

  return {
    ok: true,
    toolName: tool.name,
    commandId: tool.commandId,
    result: gatewayResult.result,
    truncated: false,
  };
}
