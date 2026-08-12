import {
  AUTOMATION_API_VERSION,
  automationCommandRegistry,
  type AutomationCommandId,
} from '../automation/command-registry';
import type {
  AutomationCommandEnvelope,
  AutomationCommandGateway,
  AutomationGatewayResult,
  AutomationExecutionContext,
} from '../automation/command-gateway';
import type { AutomationGatewayErrorCode } from '../shared/automation-host-command-error';
import type { PublicErrorCode } from '../shared/protocol/errors';
import { normalizeAutomationAssetSearchInput } from '../main/normalize-automation-asset-search-input';
import {
  parsePluginMcpToolArguments,
  type PluginMcpToolDefinition,
} from './plugin-tool-catalog';
import {
  automationLibraryContextForMcpTool,
  mcpExposureAllowsWrite,
  resolveSerpentMcpTool,
  type SerpentMcpToolExposure,
} from './tool-catalog';

export type SerpentMcpCallToolSuccess = {
  ok: true;
  toolName: string;
  commandId?: AutomationCommandId;
  plugin?: { pluginId: string; commandId: string };
  result: unknown;
  historyEntryId?: string;
  libraryId?: string;
  /** ADR-0031 §2: the last known library change sequence echoed on responses. */
  libraryChangeSequence?: number;
  undoGroupId?: string;
};

export type SerpentMcpCallToolFailure = {
  ok: false;
  code:
    | 'MCP_TOOL_NOT_FOUND'
    | 'MCP_TOOL_NOT_EXPOSED'
    | 'MCP_EXECUTION_REQUIRED'
    | 'MCP_LIBRARY_TARGET_REQUIRED'
    | 'MCP_LIBRARY_TARGET_INVALID'
    | 'AUTOMATION_OUTPUT_LIMIT_EXCEEDED'
    | AutomationGatewayErrorCode
    | PublicErrorCode
    | 'MCP_GATEWAY_FAILURE';
  message: string;
  /** Serpent review: structured error contract (§10) — retryable + version. */
  retryable?: boolean;
  currentVersion?: number;
  libraryId?: string;
  gateway?: AutomationGatewayResult;
};

export type SerpentMcpCallToolResult = SerpentMcpCallToolSuccess | SerpentMcpCallToolFailure;

export type SerpentMcpPluginToolBridge = {
  list: (libraryId?: string) => readonly PluginMcpToolDefinition[];
  isKnown: (toolName: string, libraryId?: string) => boolean;
  call: (input: {
    pluginId: string;
    commandId: string;
    context: unknown;
    executionId: string;
    libraryId?: string;
    signal?: AbortSignal;
  }) => Promise<unknown>;
};

export type SerpentMcpCallToolInput = {
  toolName: string;
  arguments: unknown;
  context: AutomationExecutionContext | undefined;
  exposure: SerpentMcpToolExposure;
  gateway: AutomationCommandGateway;
  pluginTools?: SerpentMcpPluginToolBridge;
  /** ADR-0031 §2: last known library change sequence for the response echo. */
  getLibraryChangeSequence?: (libraryId: string) => number | undefined;
  signal?: AbortSignal;
};

/** Transient gateway codes a client may reasonably retry unchanged (§10). */
const RETRYABLE_GATEWAY_CODES = new Set([
  'LIBRARY_BUSY',
  'AUTOMATION_LIBRARY_CONTEXT_BUSY',
]);

function contextWithRequestSignal(
  context: AutomationExecutionContext | undefined,
  requestSignal: AbortSignal | undefined,
): AutomationExecutionContext | undefined {
  if (context === undefined || requestSignal === undefined) return context;
  const executionSignal = context.abortSignal;
  if (executionSignal === undefined) return { ...context, abortSignal: requestSignal };
  if (executionSignal === requestSignal) return context;
  return { ...context, abortSignal: AbortSignal.any([executionSignal, requestSignal]) };
}

function outputLimitFor(input: SerpentMcpCallToolInput): number {
  return input.context?.resourceBudget?.maxOutputBytes ?? 1024 * 1024;
}

function outputWithinBudget(value: unknown, maxBytes: number): boolean {
  const serialized = JSON.stringify(value) ?? 'null';
  return Buffer.byteLength(serialized, 'utf8') <= maxBytes;
}

/** Maps one MCP tools/call into a Main-owned Gateway envelope. */
export async function callSerpentMcpTool(
  input: SerpentMcpCallToolInput,
): Promise<SerpentMcpCallToolResult> {
  const context = contextWithRequestSignal(input.context, input.signal);
  const executionId = context?.executionId;
  const libraryId = context?.libraryId ?? undefined;
  const tool = resolveSerpentMcpTool(input.toolName, input.exposure);
  if (!tool) {
    const knownRegistryTool = automationCommandRegistry.some((descriptor) => descriptor.mcp.toolName === input.toolName);
    const knownPluginTool = input.pluginTools?.isKnown(input.toolName, libraryId) === true;
    const pluginTool = input.pluginTools?.list(libraryId).find((candidate) => candidate.name === input.toolName);
    if (pluginTool !== undefined) {
      if (!mcpExposureAllowsWrite(input.exposure)) {
        return { ok: false, code: 'MCP_TOOL_NOT_EXPOSED', message: `Plugin MCP tool ${input.toolName} is not enabled.` };
      }
      if (executionId === undefined || executionId.trim().length === 0) {
        return { ok: false, code: 'MCP_EXECUTION_REQUIRED', message: 'MCP tools/call requires a Main-bound automation execution.' };
      }
      try {
        if (input.signal?.aborted) {
          return {
            ok: false,
            code: 'AUTOMATION_EXECUTION_CANCELLED',
            message: 'The MCP tool call was cancelled by the client.',
          };
        }
        const context = parsePluginMcpToolArguments(pluginTool, input.arguments ?? {});
        const result = await input.pluginTools!.call({
          pluginId: pluginTool.pluginId,
          commandId: pluginTool.commandId,
          context,
          executionId,
          ...(libraryId === undefined ? {} : { libraryId }),
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        });
        if (input.signal?.aborted) {
          return {
            ok: false,
            code: 'AUTOMATION_EXECUTION_CANCELLED',
            message: 'The MCP tool call was cancelled by the client.',
          };
        }
        if (!outputWithinBudget(result, outputLimitFor(input))) {
          return { ok: false, code: 'AUTOMATION_OUTPUT_LIMIT_EXCEEDED', message: 'The MCP result exceeds the execution output budget.' };
        }
        return {
          ok: true,
          toolName: pluginTool.name,
          plugin: { pluginId: pluginTool.pluginId, commandId: pluginTool.commandId },
          result,
        };
      } catch {
        return { ok: false, code: 'MCP_GATEWAY_FAILURE', message: 'Plugin command rejected the MCP tool call.' };
      }
    }
    if (knownPluginTool) {
      return { ok: false, code: 'MCP_TOOL_NOT_EXPOSED', message: `Plugin MCP tool ${input.toolName} is not enabled.` };
    }
    if (knownRegistryTool) {
      return { ok: false, code: 'MCP_TOOL_NOT_EXPOSED', message: `MCP tool ${input.toolName} is not enabled.` };
    }
    return { ok: false, code: 'MCP_TOOL_NOT_FOUND', message: `Unknown Serpent MCP tool: ${input.toolName}` };
  }

  if (executionId === undefined || executionId.trim().length === 0) {
    return { ok: false, code: 'MCP_EXECUTION_REQUIRED', message: 'MCP tools/call requires a Main-bound automation execution.' };
  }
  const rawArguments = input.arguments ?? {};
  const rawRecord = rawArguments !== null && typeof rawArguments === 'object' && !Array.isArray(rawArguments)
    ? rawArguments as Record<string, unknown>
    : {};
  const libraryContext = automationLibraryContextForMcpTool(tool);
  let explicitLibraryId: string | undefined;
  if (libraryContext === 'active') {
    // Stateless contract (Serpent-8b5b): every library-scoped call carries its
    // own explicit target. Existence is validated by the Gateway/Worker
    // (LIBRARY_NOT_FOUND); the MCP layer only rejects empty or non-string
    // targets with a stable error, never a human prompt.
    if (typeof rawRecord.libraryId !== 'string' || rawRecord.libraryId.trim().length === 0) {
      return {
        ok: false,
        code: 'MCP_LIBRARY_TARGET_REQUIRED',
        message: `MCP tool ${tool.name} requires an explicit libraryId. Use serpent_library_list_open or serpent_library_create first.`,
      };
    }
    explicitLibraryId = rawRecord.libraryId.trim();
  }
  const commandArguments = libraryContext === 'active'
    ? Object.fromEntries(Object.entries(rawRecord).filter(([key]) => key !== 'libraryId'))
    : rawArguments;
  const commandInput = tool.commandId === 'asset.search'
    ? (normalizeAutomationAssetSearchInput(commandArguments) ?? commandArguments)
    : commandArguments;
  const envelope: AutomationCommandEnvelope = {
    apiVersion: AUTOMATION_API_VERSION,
    commandId: tool.commandId,
    executionId,
    input: commandInput,
  };
  const gatewayResult = await input.gateway.execute(envelope, {
    signal: input.signal,
    contextOverrides: {
      ...(explicitLibraryId === undefined ? {} : { libraryId: explicitLibraryId }),
      stateless: true,
    },
  });
  if (!gatewayResult.ok) {
    // Serpent-8b5b.2: a dangerous call answered with a two-phase challenge is
    // a structured risk report for the agent, not an error.
    if ('challenge' in gatewayResult && gatewayResult.challenge !== undefined) {
      return {
        ok: true,
        toolName: tool.name,
        commandId: tool.commandId,
        result: gatewayResult.challenge,
      };
    }
    const gatewayError = (gatewayResult as { error: { code: string; message?: string; currentEntityVersion?: number } }).error;
    return {
      ok: false,
      code: gatewayError.code as SerpentMcpCallToolFailure['code'],
      message: gatewayError.message ?? gatewayError.code,
      // Serpent review: structured error contract (§10) — transient codes are
      // flagged retryable, entity-version conflicts carry the current version.
      ...(RETRYABLE_GATEWAY_CODES.has(gatewayError.code) ? { retryable: true } : {}),
      ...(gatewayError.currentEntityVersion === undefined
        ? {}
        : { currentVersion: gatewayError.currentEntityVersion }),
      ...(explicitLibraryId === undefined ? {} : { libraryId: explicitLibraryId }),
      gateway: gatewayResult,
    };
  }
  if (!outputWithinBudget(gatewayResult.result, outputLimitFor({ ...input, context }))) {
    return { ok: false, code: 'AUTOMATION_OUTPUT_LIMIT_EXCEEDED', message: 'The MCP result exceeds the execution output budget.' };
  }
  const libraryChangeSequence = explicitLibraryId === undefined
    || input.getLibraryChangeSequence === undefined
    ? undefined
    : input.getLibraryChangeSequence(explicitLibraryId);
  return {
    ok: true,
    toolName: tool.name,
    commandId: tool.commandId,
    result: gatewayResult.result,
    ...(gatewayResult.historyEntryId === undefined ? {} : { historyEntryId: gatewayResult.historyEntryId }),
    ...(explicitLibraryId === undefined ? {} : { libraryId: explicitLibraryId }),
    ...(libraryChangeSequence === undefined ? {} : { libraryChangeSequence }),
    ...(gatewayResult.undoGroupId === undefined ? {} : { undoGroupId: gatewayResult.undoGroupId }),
  };
}
