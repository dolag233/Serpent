import {
  AUTOMATION_API_VERSION,
  automationCommandRegistry,
  type AutomationCommandDescriptor,
  type AutomationCommandId,
  type AutomationImpact,
} from '../automation/command-registry';

/**
 * MCP Host may grant write tools only after a local human configures write
 * access for the connection. Unconfigured connections must list only
 * `mcp.public` (read) tools so the Agent cannot self-elevate by discovery.
 */
export type SerpentMcpToolExposure = {
  writeAccessGranted: boolean;
};

export type SerpentMcpToolDefinition = {
  name: string;
  commandId: AutomationCommandId;
  description: string;
  inputSchema: Record<string, unknown>;
  outputLimit: number;
  impact: AutomationImpact;
  approvalPolicy: AutomationCommandDescriptor['approvalPolicy'];
  requiredCapabilities: readonly string[];
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

function shouldExpose(
  descriptor: AutomationCommandDescriptor,
  exposure: SerpentMcpToolExposure,
): boolean {
  if (!isMcpEligible(descriptor)) return false;
  if (descriptor.mcp.public) return true;
  if (!exposure.writeAccessGranted) return false;
  // Execution-approved low-risk Actions require a connection write grant.
  // Public plan-gated tools remain visible and always open Main's approval
  // boundary; the MCP caller cannot bypass that boundary.
  return descriptor.approvalPolicy === 'execution' || descriptor.approvalPolicy === 'plan';
}

function asJsonSchemaObject(schema: object): Record<string, unknown> {
  const record = schema as Record<string, unknown>;
  if (record.type === undefined) {
    return { ...record, type: 'object' };
  }
  return { ...record };
}

/**
 * Builds the MCP tools/list payload from the Automation Registry. Adapters must
 * not invent parallel tool names or schemas.
 */
export function listSerpentMcpTools(
  exposure: SerpentMcpToolExposure = { writeAccessGranted: false },
): {
  apiVersion: typeof AUTOMATION_API_VERSION;
  tools: SerpentMcpToolDefinition[];
} {
  const tools: SerpentMcpToolDefinition[] = [];
  const seenNames = new Set<string>();

  for (const descriptor of automationCommandRegistry) {
    if (!shouldExpose(descriptor, exposure)) continue;

    const name = descriptor.mcp.toolName;
    if (FORBIDDEN_TOOL_NAME_FRAGMENT.test(name)) {
      throw new Error(`Automation MCP tool name is forbidden: ${name}`);
    }
    if (seenNames.has(name)) {
      throw new Error(`Duplicate Automation MCP tool name: ${name}`);
    }
    seenNames.add(name);

    tools.push({
      name,
      commandId: descriptor.commandId,
      description: [
        descriptor.summary,
        `commandId=${descriptor.commandId}`,
        `impact=${descriptor.impact}`,
        `approval=${descriptor.approvalPolicy}`,
        `outputLimit=${descriptor.mcp.outputLimit}`,
      ].join(' · '),
      inputSchema: asJsonSchemaObject(descriptor.inputSchema.toJSONSchema()),
      outputLimit: descriptor.mcp.outputLimit,
      impact: descriptor.impact,
      approvalPolicy: descriptor.approvalPolicy,
      requiredCapabilities: descriptor.requiredCapabilities,
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
  exposure: SerpentMcpToolExposure = { writeAccessGranted: false },
): SerpentMcpToolDefinition | undefined {
  return listSerpentMcpTools(exposure).tools.find((tool) => tool.name === toolName);
}
