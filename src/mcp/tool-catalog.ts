import {
  AUTOMATION_API_VERSION,
  automationCommandRegistry,
  getAutomationCommandPermissionMetadata,
  type AutomationCapability,
  type AutomationCommandDescriptor,
  type AutomationCommandId,
  type AutomationImpact,
} from '../automation/command-registry';
import type { McpAccessMode } from '../shared/mcp';

/** Credential policy only. It deliberately contains no active library state. */
export type SerpentMcpToolExposure = {
  accessMode?: McpAccessMode;
  /** @deprecated retained for non-MCP adapters while migration completes. */
  activeLibraryId?: string | null;
  /** @deprecated capability grants are no longer used to build tools/list. */
  grantedCapabilities?: readonly AutomationCapability[];
  hostCapabilities: readonly ('desktop-ui')[];
};

export function mcpExposureAllowsWrite(exposure: SerpentMcpToolExposure): boolean {
  // Registry tools are static in both modes. Plugin tools have their own
  // declaration/permission surface; until that surface is projected into the
  // stateless contract, only Full Access may expose them.
  return exposure.accessMode === 'full-access';
}

export type SerpentMcpToolDefinition = {
  name: string;
  commandId: AutomationCommandId;
  description: string;
  inputSchema: Record<string, unknown>;
  outputLimit: number;
  impact: AutomationImpact;
  approvalPolicy: AutomationCommandDescriptor['approvalPolicy'];
  requiredCapabilities: readonly string[];
  requestableCapabilities: readonly AutomationCapability[];
  riskTier: ReturnType<typeof getAutomationCommandPermissionMetadata>['riskTier'];
  canPersistPermission: boolean;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    openWorldHint: false;
  };
};

const FORBIDDEN_TOOL_NAME_FRAGMENT = /(?:^|_)(?:eval|shell|sql|fetch|net|fs|process|exec)(?:_|$)/iu;

function isMcpEligible(descriptor: AutomationCommandDescriptor): boolean {
  return descriptor.allowedSources.includes('mcp');
}

function libraryContextForDescriptor(
  descriptor: AutomationCommandDescriptor,
): 'none' | 'active' | 'transition' {
  if (descriptor.libraryContext !== undefined) return descriptor.libraryContext;
  return descriptor.targetScope === 'library'
    || descriptor.targetScope === 'asset'
    || descriptor.targetScope === 'asset-set'
    || descriptor.targetScope === 'job-set'
    ? 'active'
    : 'none';
}

function shouldExpose(
  descriptor: AutomationCommandDescriptor,
  exposure: SerpentMcpToolExposure,
): boolean {
  if (!isMcpEligible(descriptor)) return false;
  if (descriptor.hostCapabilities !== undefined) {
    const available = new Set(exposure.hostCapabilities ?? []);
    if (descriptor.hostCapabilities.some((capability) => !available.has(capability))) return false;
  }
  if (descriptor.mcp.public) return true;
  return descriptor.approvalPolicy === 'execution'
    || descriptor.approvalPolicy === 'plan'
    || descriptor.requiredCapabilities.length > 0;
}

function asJsonSchemaObject(schema: object): Record<string, unknown> {
  const record = schema as Record<string, unknown>;
  return record.type === undefined ? { ...record, type: 'object' } : { ...record };
}

function withExplicitLibraryTarget(
  schema: Record<string, unknown>,
  required: boolean,
): Record<string, unknown> {
  const properties = schema.properties !== null && typeof schema.properties === 'object'
    ? { ...(schema.properties as Record<string, unknown>) }
    : {};
  properties.libraryId = {
    type: 'string',
    description: '目标资源库的稳定 ID。每次库内调用都必须显式指定。',
  };
  const currentRequired = Array.isArray(schema.required) ? [...schema.required] : [];
  if (required && !currentRequired.includes('libraryId')) currentRequired.push('libraryId');
  return {
    ...schema,
    properties,
    ...(currentRequired.length === 0 ? {} : { required: currentRequired }),
  };
}

/**
 * Serpent-8b5b.2: dangerous tools accept the agent's second-phase confirmation
 * on the SAME tool call. The gateway strips these fields after the challenge
 * is consumed, so they never reach the worker schema.
 */
function withChallengeConfirmationFields(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const properties = schema.properties !== null && typeof schema.properties === 'object'
    ? { ...(schema.properties as Record<string, unknown>) }
    : {};
  properties.challengeId = {
    type: 'string',
    description: '第一次调用返回的 challengeId。第二次调用必须原样回传。',
  };
  properties.planHash = {
    type: 'string',
    nullable: true,
    description: '风险报告中的 planHash；第二次调用必须原样回传。',
  };
  properties.acknowledged = {
    type: 'boolean',
    description: '第二次调用必须为 true；单独 true 而缺少精确 challengeId/planHash 不生效。',
  };
  properties.idempotencyKey = {
    type: 'string',
    description: '第二次调用的幂等键，用于审计与去重。',
  };
  return { ...schema, properties };
}

/** Builds the single MCP tools/list projection from the Automation Registry. */
export function listSerpentMcpTools(
  exposure: SerpentMcpToolExposure,
): { apiVersion: typeof AUTOMATION_API_VERSION; tools: SerpentMcpToolDefinition[] } {
  const tools: SerpentMcpToolDefinition[] = [];
  const seenNames = new Set<string>();

  for (const descriptor of automationCommandRegistry) {
    if (!shouldExpose(descriptor, exposure)) continue;
    const name = descriptor.mcp.toolName;
    if (FORBIDDEN_TOOL_NAME_FRAGMENT.test(name)) {
      throw new Error(`Automation MCP tool name is forbidden: ${name}`);
    }
    if (seenNames.has(name)) throw new Error(`Duplicate Automation MCP tool name: ${name}`);
    seenNames.add(name);
    const mcpInputSchema = 'inputSchema' in descriptor.mcp
      ? descriptor.mcp.inputSchema
      : undefined;
    const inputSchema = asJsonSchemaObject(
      (mcpInputSchema ?? descriptor.inputSchema).toJSONSchema(),
    );
    const explicitLibraryTarget = libraryContextForDescriptor(descriptor) === 'active';
    const permission = getAutomationCommandPermissionMetadata(descriptor);
    const baseInputSchema = explicitLibraryTarget
      ? withExplicitLibraryTarget(inputSchema, true)
      : inputSchema;
    tools.push({
      name,
      commandId: descriptor.commandId,
      description: [
        descriptor.summary,
        `commandId=${descriptor.commandId}`,
        `impact=${descriptor.impact}`,
        `risk=${permission.riskTier}`,
        `approval=${descriptor.approvalPolicy}`,
        `outputLimit=${descriptor.mcp.outputLimit}`,
      ].join(' · '),
      inputSchema: descriptor.criticalOperation === true
        ? withChallengeConfirmationFields(baseInputSchema)
        : baseInputSchema,
      outputLimit: descriptor.mcp.outputLimit,
      impact: descriptor.impact,
      approvalPolicy: descriptor.approvalPolicy,
      requiredCapabilities: descriptor.requiredCapabilities,
      requestableCapabilities: permission.requestableCapabilities,
      riskTier: permission.riskTier,
      canPersistPermission: permission.canPersist,
      annotations: {
        readOnlyHint: descriptor.impact === 'read',
        destructiveHint: descriptor.impact === 'destructive',
        openWorldHint: false,
      },
    });
  }
  return { apiVersion: AUTOMATION_API_VERSION, tools };
}

export function resolveSerpentMcpTool(
  toolName: string,
  exposure: SerpentMcpToolExposure,
): SerpentMcpToolDefinition | undefined {
  return listSerpentMcpTools(exposure).tools.find((tool) => tool.name === toolName);
}

export function automationLibraryContextForMcpTool(
  tool: SerpentMcpToolDefinition,
): 'none' | 'active' | 'transition' {
  const descriptor = automationCommandRegistry.find((candidate) => candidate.commandId === tool.commandId);
  if (descriptor === undefined) return 'none';
  return libraryContextForDescriptor(descriptor);
}
