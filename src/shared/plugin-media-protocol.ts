import { z } from 'zod';

import { pluginProviderMediaSchema } from '../plugins/plugin-providers';

const nonBlankString = z.string().min(1).max(255);
const providerAssetSchema = z.strictObject({
  assetId: nonBlankString,
  displayName: z.string().max(1_024),
  relativeFilePath: z.string().max(4_096),
  currentRevisionId: nonBlankString,
});

export const pluginMediaProviderRequestSchema = z.strictObject({
  type: z.literal('plugin-media-provider.request'),
  requestId: z.string().uuid(),
  libraryId: nonBlankString,
  assetId: nonBlankString,
  kind: z.enum(['preview', 'thumbnail']),
  asset: providerAssetSchema.optional(),
});

export type PluginMediaProviderRequest = z.infer<typeof pluginMediaProviderRequestSchema>;

export const pluginMediaProviderResultSchema = z.strictObject({
  status: z.enum(['provided', 'native-fallback']),
  assetId: nonBlankString,
  kind: z.enum(['preview', 'thumbnail']),
  providerId: nonBlankString.optional(),
  media: pluginProviderMediaSchema.optional(),
  errorCode: nonBlankString.optional(),
});

export type PluginMediaProviderResult = z.infer<typeof pluginMediaProviderResultSchema>;

export const pluginMediaProviderResponseSchema = z.strictObject({
  type: z.literal('plugin-media-provider.response'),
  requestId: z.string().uuid(),
  result: pluginMediaProviderResultSchema,
});

export type PluginMediaProviderResponse = z.infer<typeof pluginMediaProviderResponseSchema>;

export function parsePluginMediaProviderRequest(input: unknown): PluginMediaProviderRequest {
  return pluginMediaProviderRequestSchema.parse(input);
}

export function parsePluginMediaProviderResponse(input: unknown): PluginMediaProviderResponse {
  return pluginMediaProviderResponseSchema.parse(input);
}

export const pluginThumbnailExtensionsMessageSchema = z.strictObject({
  type: z.literal('plugin-thumbnail-extensions.set'),
  libraryId: nonBlankString,
  extensions: z.array(z.string().min(1).max(32)).max(256),
});
export type PluginThumbnailExtensionsMessage = z.infer<typeof pluginThumbnailExtensionsMessageSchema>;

export function parsePluginThumbnailExtensionsMessage(input: unknown): PluginThumbnailExtensionsMessage | null {
  const parsed = pluginThumbnailExtensionsMessageSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
