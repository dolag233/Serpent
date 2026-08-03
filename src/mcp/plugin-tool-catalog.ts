import { z } from 'zod';

import { pluginIdSchema, pluginLocalIdSchema } from '../plugins/plugin-manifest';

export const pluginMcpCommandContextSchema = z.strictObject({
  assetIds: z.array(z.string().min(1).max(256)).max(256).optional(),
  folderIds: z.array(z.string().min(1).max(256)).max(256).optional(),
  collectionIds: z.array(z.string().min(1).max(256)).max(256).optional(),
}).refine(
  (context) => Boolean(context.assetIds?.length || context.folderIds?.length || context.collectionIds?.length),
  'At least one bounded context ID is required',
);
export type PluginMcpCommandContext = z.infer<typeof pluginMcpCommandContextSchema>;

export type PluginMcpCommandSource = {
  pluginId: string;
  commandId: string;
  title: string;
  mcpExported: boolean;
  pluginInstanceId?: string;
};

export type PluginMcpToolDefinition = {
  name: string;
  description: string;
  pluginId: string;
  commandId: string;
  inputSchema: {
    type: 'object';
    additionalProperties: false;
    properties: Record<string, {
      type: 'array';
      items: { type: 'string' };
      minItems: number;
      maxItems: number;
    }>;
    anyOf: Array<{ required: string[] }>;
  };
};

export function pluginMcpToolName(pluginId: string, commandId: string): string {
  return [
    'serpent_plugin',
    pluginIdSchema.parse(pluginId).replace(/[^a-zA-Z0-9]+/g, '_'),
    pluginLocalIdSchema.parse(commandId).replace(/[^a-zA-Z0-9]+/g, '_'),
  ].join('_');
}

function stableCollisionSuffix(pluginId: string, commandId: string, pluginInstanceId?: string): string {
  let hash = 2166136261;
  const input = `${pluginId}\u0000${commandId}\u0000${pluginInstanceId ?? ''}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function listPluginMcpTools(
  commands: readonly PluginMcpCommandSource[],
  isEnabled: (command: PluginMcpCommandSource) => boolean = () => true,
): PluginMcpToolDefinition[] {
  const candidates = commands
    .filter((command) => command.mcpExported && isEnabled(command))
    .map((command) => ({
      command,
      baseName: pluginMcpToolName(command.pluginId, command.commandId),
      description: `${command.title} (plugin command ${command.pluginId}.${command.commandId})`,
      pluginId: pluginIdSchema.parse(command.pluginId),
      commandId: pluginLocalIdSchema.parse(command.commandId),
      inputSchema: pluginMcpInputSchemaJson,
    }))
    .sort((left, right) => left.baseName.localeCompare(right.baseName)
      || left.pluginId.localeCompare(right.pluginId)
      || left.commandId.localeCompare(right.commandId));
  const baseNameCounts = new Map<string, number>();
  for (const candidate of candidates) {
    baseNameCounts.set(candidate.baseName, (baseNameCounts.get(candidate.baseName) ?? 0) + 1);
  }
  const tools = candidates.map(({ command, baseName, description, pluginId, commandId, inputSchema }) => ({
    name: (baseNameCounts.get(baseName) ?? 0) > 1
      ? `${baseName}_${stableCollisionSuffix(pluginId, commandId, command.pluginInstanceId)}`
      : baseName,
    description,
    pluginId,
    commandId,
    inputSchema,
  }));
  const seenNames = new Set<string>();
  for (const tool of tools) {
    if (seenNames.has(tool.name)) throw new Error(`Duplicate MCP tool name: ${tool.name}`);
    seenNames.add(tool.name);
  }
  return tools;
}

export function parsePluginMcpToolArguments(
  tool: PluginMcpToolDefinition,
  input: unknown,
): PluginMcpCommandContext {
  if (!tool.inputSchema) throw new Error(`Plugin MCP tool ${tool.name} has no input schema`);
  return pluginMcpCommandContextSchema.parse(input);
}

const pluginMcpInputSchemaJson: PluginMcpToolDefinition['inputSchema'] = {
  type: 'object',
  additionalProperties: false,
  properties: {
    assetIds: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 256 },
    folderIds: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 256 },
    collectionIds: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 256 },
  },
  anyOf: [
    { required: ['assetIds'] },
    { required: ['folderIds'] },
    { required: ['collectionIds'] },
  ],
};
