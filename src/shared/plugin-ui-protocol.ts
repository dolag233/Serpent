import { z } from 'zod';

const requestIdSchema = z.string().min(1).max(128);
const contributionIdSchema = z.string().min(1).max(255);
const instanceIdSchema = z.string().min(1).max(255);
const commandIdSchema = z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9._-]{0,63}$/u);
const storageKeySchema = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]{0,126}[a-z0-9]$/u);

const pluginUiCommandContextSchema = z.strictObject({
  assetIds: z.array(z.string().min(1).max(255)).max(10_000).optional(),
  folderIds: z.array(z.string().min(1).max(255)).max(10_000).optional(),
  collectionIds: z.array(z.string().min(1).max(255)).max(10_000).optional(),
});

function isJsonValue(value: unknown, depth = 0): boolean {
  if (depth > 8 || value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 256 && value.every((item) => isJsonValue(item, depth + 1));
  if (typeof value !== 'object') return false;
  const entries = Object.entries(value);
  return entries.length <= 256
    && entries.every(([key, item]) => key.length <= 128 && isJsonValue(item, depth + 1));
}

export const pluginUiStorageValueSchema = z.unknown().refine((value) => {
  if (!isJsonValue(value)) return false;
  const serialized = JSON.stringify(value);
  return serialized !== undefined && new TextEncoder().encode(serialized).length <= 64 * 1024;
}, 'Plugin UI storage values must be bounded JSON data.');

export const pluginUiIframeMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('plugin-ui.ready'),
    contributionId: contributionIdSchema,
    instanceId: instanceIdSchema,
  }),
  z.strictObject({
    type: z.literal('plugin-ui.invoke-command'),
    requestId: requestIdSchema,
    commandId: commandIdSchema,
    context: pluginUiCommandContextSchema.default({}),
  }),
  z.strictObject({
    type: z.literal('plugin-ui.storage.get'),
    requestId: requestIdSchema,
    key: storageKeySchema,
  }),
  z.strictObject({
    type: z.literal('plugin-ui.storage.set'),
    requestId: requestIdSchema,
    key: storageKeySchema,
    value: pluginUiStorageValueSchema,
  }),
]);
export type PluginUiIframeMessage = z.infer<typeof pluginUiIframeMessageSchema>;

const pluginUiThemeTokensSchema = z.record(
  z.string().regex(/^--[a-z0-9-]+$/u),
  z.string().max(512),
).refine((tokens) => Object.keys(tokens).length <= 128);

export const pluginUiHostMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('plugin-ui.theme'),
    contributionId: contributionIdSchema,
    instanceId: instanceIdSchema,
    theme: z.enum(['light', 'dark']),
    tokens: pluginUiThemeTokensSchema,
  }),
  z.strictObject({
    type: z.literal('plugin-ui.command-result'),
    requestId: requestIdSchema,
    ok: z.boolean(),
    errorCode: z.string().min(1).max(128).optional(),
  }),
  z.strictObject({
    type: z.literal('plugin-ui.storage.result'),
    requestId: requestIdSchema,
    ok: z.boolean(),
    value: pluginUiStorageValueSchema.optional(),
    errorCode: z.string().min(1).max(128).optional(),
  }),
]);
export type PluginUiHostMessage = z.infer<typeof pluginUiHostMessageSchema>;

export function parsePluginUiIframeMessage(input: unknown): PluginUiIframeMessage {
  return pluginUiIframeMessageSchema.parse(input);
}

export function parsePluginUiHostMessage(input: unknown): PluginUiHostMessage {
  return pluginUiHostMessageSchema.parse(input);
}

/**
 * Sandboxed iframes without allow-same-origin report an opaque `null` origin.
 * The source identity is therefore mandatory and is checked by the host in
 * addition to the expected origin.
 */
export function isTrustedPluginUiMessage(input: {
  origin: string;
  source: unknown;
  expectedOrigin: string;
  expectedSource: unknown;
}): boolean {
  return input.origin === input.expectedOrigin && input.source === input.expectedSource;
}
