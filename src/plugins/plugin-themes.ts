import type { PluginManifest, PluginPermission, PluginThemePackage } from './plugin-manifest';
import { pluginThemePackageSchema } from './plugin-manifest';

export {
  PLUGIN_UI_THEME_TOKEN_NAMES,
  contributionThemeSchema,
  pluginThemePackageSchema,
  type PluginContributionTheme,
  type PluginThemePackage,
} from './plugin-manifest';

export const PLUGIN_TRUSTED_CSS_PERMISSION: PluginPermission = 'theme.trusted-css';

export function pluginRequiresTrustedCssDisclosure(
  permissions: readonly string[],
): boolean {
  return permissions.includes(PLUGIN_TRUSTED_CSS_PERMISSION);
}

/**
 * Merges all declared theme contributions into one bounded light/dark package.
 * Later contributions override earlier ones for the same token name.
 */
export function extractPluginThemePackage(
  manifest: Pick<PluginManifest, 'contributes'>,
): PluginThemePackage | undefined {
  const themes = manifest.contributes?.themes ?? [];
  if (themes.length === 0) return undefined;

  const light: Record<string, string> = {};
  const dark: Record<string, string> = {};
  for (const theme of themes) {
    Object.assign(light, theme.light ?? {});
    Object.assign(dark, theme.dark ?? {});
  }
  const parsed = pluginThemePackageSchema.safeParse({ light, dark });
  if (!parsed.success) return undefined;
  if (Object.keys(parsed.data.light).length === 0 && Object.keys(parsed.data.dark).length === 0) {
    return undefined;
  }
  return parsed.data;
}

/**
 * Applies Host-read CSS variables first, then plugin token overrides for the
 * active resolved theme. Standard plugins only receive iframe-scoped tokens.
 */
export function mergePluginIframeThemeTokens(input: {
  hostTokens: Readonly<Record<string, string>>;
  themePackage: PluginThemePackage | undefined;
  resolvedTheme: 'light' | 'dark';
}): Record<string, string> {
  const overrides = input.themePackage?.[input.resolvedTheme] ?? {};
  return {
    ...input.hostTokens,
    ...overrides,
  };
}

export function buildPluginUiThemeHostMessage(input: {
  contributionId: string;
  instanceId: string;
  resolvedTheme: 'light' | 'dark';
  hostTokens: Readonly<Record<string, string>>;
  themePackage: PluginThemePackage | undefined;
}) {
  return {
    type: 'plugin-ui.theme' as const,
    contributionId: input.contributionId,
    instanceId: input.instanceId,
    theme: input.resolvedTheme,
    tokens: mergePluginIframeThemeTokens({
      hostTokens: input.hostTokens,
      themePackage: input.themePackage,
      resolvedTheme: input.resolvedTheme,
    }),
  };
}
