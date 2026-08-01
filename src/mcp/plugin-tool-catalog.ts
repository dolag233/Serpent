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

export function listPluginMcpTools(
  commands: readonly PluginMcpCommandSource[],
  isEnabled: (command: PluginMcpCommandSource) => boolean = () => true,
): PluginMcpToolDefinition[] {
  return commands
    .filter((command) => command.mcpExported && isEnabled(command))
    .map((command) => ({
      name: pluginMcpToolName(command.pluginId, command.commandId),
      description: `${command.title} (plugin command ${command.pluginId}.${command.commandId})`,
      pluginId: pluginIdSchema.parse(command.pluginId),
      commandId: pluginLocalIdSchema.parse(command.commandId),
      inputSchema: pluginMcpInputSchemaJson,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
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
    assetIds: { type: 'array', items: { type: 'string' }, maxItems: 256 },
    folderIds: { type: 'array', items: { type: 'string' }, maxItems: 256 },
    collectionIds: { type: 'array', items: { type: 'string' }, maxItems: 256 },
  },
  anyOf: [
    { required: ['assetIds'] },
    { required: ['folderIds'] },
    { required: ['collectionIds'] },
  ],
};
