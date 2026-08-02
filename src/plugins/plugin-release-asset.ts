/**
 * GitHub Release asset naming and platform matching for plugin distribution.
 * Spec: docs/manual/plugins/distribution-and-updates.md
 */

export const PLUGIN_PLATFORM_TOKENS = [
  'darwin-arm64',
  'darwin-x64',
  'win32-x64',
  'win32-arm64',
  'win32-ia32',
  'linux-x64',
  'linux-arm64',
  'any',
] as const;

export type PluginPlatformToken = (typeof PLUGIN_PLATFORM_TOKENS)[number];

export type ParsedPluginReleaseAssetName = {
  pluginId: string;
  version: string;
  platformToken: PluginPlatformToken;
  fileName: string;
};

const PLATFORM_TOKEN_SET = new Set<string>(PLUGIN_PLATFORM_TOKENS);

const PLATFORM_TOKEN_ALTERNATION = PLUGIN_PLATFORM_TOKENS
  .slice()
  .sort((left, right) => right.length - left.length)
  .map((token) => token.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
  .join('|');

const ASSET_NAME_PATTERN = new RegExp(
  `^(.+)-((?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)(?:-[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?)-(${PLATFORM_TOKEN_ALTERNATION})\\.zip$`,
  'u',
);

export function isPluginPlatformToken(value: string): value is PluginPlatformToken {
  return PLATFORM_TOKEN_SET.has(value);
}

export function pluginPlatformTokenFor(
  platform: NodeJS.Platform | string,
  arch: string,
): PluginPlatformToken | undefined {
  const candidate = `${platform}-${arch}`;
  return isPluginPlatformToken(candidate) ? candidate : undefined;
}

export function currentPluginPlatformToken(
  platform: NodeJS.Platform | string = process.platform,
  arch: string = process.arch,
): PluginPlatformToken {
  const token = pluginPlatformTokenFor(platform, arch);
  if (token === undefined) {
    throw new Error(`Unsupported plugin platform: ${platform}-${arch}`);
  }
  return token;
}

export function parsePluginReleaseAssetFileName(fileName: string): ParsedPluginReleaseAssetName | undefined {
  const match = ASSET_NAME_PATTERN.exec(fileName);
  if (match === null) return undefined;
  const pluginId = match[1];
  const version = match[2];
  const platformToken = match[3];
  if (pluginId === undefined || version === undefined || platformToken === undefined) return undefined;
  if (!isPluginPlatformToken(platformToken)) return undefined;
  if (!/^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$/u.test(pluginId)) return undefined;
  return { pluginId, version, platformToken, fileName };
}

export type PluginReleaseAssetCandidate = {
  name: string;
  browserDownloadUrl?: string;
};

/**
 * Prefer an exact platform-arch asset, then `any`. Returns undefined when neither exists.
 */
export function selectPluginReleaseAsset<T extends PluginReleaseAssetCandidate>(
  assets: readonly T[],
  platformToken: PluginPlatformToken,
  options?: { pluginId?: string; version?: string },
): T | undefined {
  const parsed = assets.flatMap((asset) => {
    const detail = parsePluginReleaseAssetFileName(asset.name);
    if (detail === undefined) return [];
    if (options?.pluginId !== undefined && detail.pluginId !== options.pluginId) return [];
    if (options?.version !== undefined && detail.version !== options.version) return [];
    return [{ asset, detail }];
  });
  const exact = parsed.find((entry) => entry.detail.platformToken === platformToken);
  if (exact !== undefined) return exact.asset;
  const any = parsed.find((entry) => entry.detail.platformToken === 'any');
  return any?.asset;
}

export function stripSemverTagPrefix(tag: string): string {
  return tag.startsWith('v') || tag.startsWith('V') ? tag.slice(1) : tag;
}
