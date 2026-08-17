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
