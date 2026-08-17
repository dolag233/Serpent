import type {
  PluginManifest,
  PluginPermission,
  PluginThemeModePackage,
  PluginThemePackage,
  PluginUiThemeReference,
} from './plugin-manifest';
import {
  PLUGIN_UI_THEME_REFERENCE_CSS_VARS,
  pluginThemePackageSchema,
} from './plugin-manifest';

export {
  PLUGIN_UI_THEME_REFERENCE_CSS_VARS,
  PLUGIN_UI_THEME_REFERENCE_NAMES,
  PLUGIN_UI_THEME_TOKEN_NAMES,
  contributionThemeSchema,
  pluginThemePackageSchema,
  type PluginContributionTheme,
  type PluginThemeModePackage,
  type PluginThemePackage,
  type PluginUiThemeReference,
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

  const light: PluginThemeModePackage = { references: {}, tokens: {} };
  const dark: PluginThemeModePackage = { references: {}, tokens: {} };
  for (const theme of themes) {
    Object.assign(light.references, theme.light?.references ?? {});
    Object.assign(light.tokens, theme.light?.tokens ?? {});
    Object.assign(dark.references, theme.dark?.references ?? {});
    Object.assign(dark.tokens, theme.dark?.tokens ?? {});
  }
  const parsed = pluginThemePackageSchema.safeParse({ version: 1, light, dark });
  if (!parsed.success) return undefined;
  if (
    Object.keys(parsed.data.light.references).length === 0
    && Object.keys(parsed.data.light.tokens).length === 0
    && Object.keys(parsed.data.dark.references).length === 0
    && Object.keys(parsed.data.dark.tokens).length === 0
  ) {
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
  const mode = input.themePackage?.[input.resolvedTheme];
  const tokens: Record<string, string> = { ...input.hostTokens };
  if (mode === undefined) return tokens;

  for (const [localName, reference] of Object.entries(mode.references)) {
    const hostTokenName = PLUGIN_UI_THEME_REFERENCE_CSS_VARS[reference as PluginUiThemeReference];
    const hostValue = input.hostTokens[hostTokenName];
    if (hostValue !== undefined) {
      tokens[`--serpent-plugin-ref-${localName}`] = hostValue;
    }
  }
  for (const [localName, value] of Object.entries(mode.tokens)) {
    tokens[`--serpent-plugin-token-${localName}`] = value;
  }
  return tokens;
}

export function buildPluginUiThemeHostMessage(input: {
  contributionId: string;
  instanceId: string;
  resolvedTheme: 'light' | 'dark';
  revision: number;
  contrast?: 'normal' | 'high';
  hostTokens: Readonly<Record<string, string>>;
  themePackage: PluginThemePackage | undefined;
}) {
  return {
    type: 'plugin-ui.theme-changed' as const,
    contributionId: input.contributionId,
    instanceId: input.instanceId,
    theme: input.resolvedTheme,
    contrast: input.contrast ?? 'normal',
    revision: input.revision,
    tokens: mergePluginIframeThemeTokens({
      hostTokens: input.hostTokens,
      themePackage: input.themePackage,
      resolvedTheme: input.resolvedTheme,
    }),
  };
}
