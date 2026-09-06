import { z } from 'zod';

import { pluginIdSchema, semverSchema } from './plugin-manifest';
import { PLUGIN_PLATFORM_TOKENS } from './plugin-release-asset';

export const PLUGIN_COMMUNITY_CATALOG_SCHEMA_VERSION = 1 as const;

export const DEFAULT_PLUGIN_COMMUNITY_CATALOG_URL =
  'https://raw.githubusercontent.com/dolag233/Serpent-Plugin-Pool/main/catalog.v1.json';

export const pluginCommunityLocalizedTextSchema = z.strictObject({
  'zh-CN': z.string().min(1).max(2_000),
  en: z.string().min(1).max(2_000),
});
export type PluginCommunityLocalizedText = z.infer<typeof pluginCommunityLocalizedTextSchema>;

export const pluginCommunityAssetSchema = z.strictObject({
  platform: z.enum(PLUGIN_PLATFORM_TOKENS),
  fileName: z.string().min(1).max(512),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u, 'Expected a lowercase SHA-256 digest.'),
});
export type PluginCommunityAsset = z.infer<typeof pluginCommunityAssetSchema>;

export const pluginCommunityEntrySchema = z.strictObject({
  id: pluginIdSchema,
  tier: z.enum(['first-party', 'certified']),
  repo: z.string().regex(/^[^/\s]+\/[^/\s]+$/u, 'Expected owner/repository.'),
  releaseTag: z.string().min(1).max(255),
  version: semverSchema,
  runtimeMode: z.enum(['restricted', 'unrestricted']),
  minSerpent: z.string().min(1).max(64).optional(),
  author: z.string().min(1).max(160).optional(),
  name: z.strictObject({
    'zh-CN': z.string().min(1).max(160),
    en: z.string().min(1).max(160),
  }),
  description: pluginCommunityLocalizedTextSchema,
  assets: z.array(pluginCommunityAssetSchema).min(1).max(16),
});
export type PluginCommunityEntry = z.infer<typeof pluginCommunityEntrySchema>;

export const pluginCommunityRemovedSchema = z.strictObject({
  id: pluginIdSchema,
  reason: pluginCommunityLocalizedTextSchema,
});
export type PluginCommunityRemoved = z.infer<typeof pluginCommunityRemovedSchema>;

export const pluginCommunityCatalogSchema = z.strictObject({
  schemaVersion: z.literal(PLUGIN_COMMUNITY_CATALOG_SCHEMA_VERSION),
  generatedAt: z.string().min(1).max(64),
  plugins: z.array(pluginCommunityEntrySchema).max(10_000),
  removed: z.array(pluginCommunityRemovedSchema).max(10_000).default([]),
}).superRefine((catalog, context) => {
  const pluginIds = catalog.plugins.map((entry) => entry.id);
  if (new Set(pluginIds).size !== pluginIds.length) {
    context.addIssue({ code: 'custom', path: ['plugins'], message: 'Catalog plugin ids must be unique.' });
  }
  const removedIds = catalog.removed.map((entry) => entry.id);
  if (new Set(removedIds).size !== removedIds.length) {
    context.addIssue({ code: 'custom', path: ['removed'], message: 'Removed plugin ids must be unique.' });
  }
});
export type PluginCommunityCatalog = z.infer<typeof pluginCommunityCatalogSchema>;

export function catalogSha256Url(catalogUrl: string): string {
  return `${catalogUrl}.sha256`;
}

/** Accept a bare digest or `digest  filename` (GNU coreutils). */
export function parseCatalogSha256File(text: string): string | undefined {
  const match = /^\s*([a-fA-F0-9]{64})\b/u.exec(text);
  return match?.[1]?.toLowerCase();
}
