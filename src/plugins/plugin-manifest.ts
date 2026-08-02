import { z } from 'zod';

import { isValidPluginAccelerator } from '../shared/plugin-accelerator';
import {
  normalizePluginRuntimeMode,
  pluginRuntimeModeSchema,
  type PluginRuntimeMode,
} from './plugin-runtime-mode';

export const PLUGIN_MANIFEST_VERSION = 1 as const;
export const PLUGIN_API_VERSION = 1 as const;
export const PLUGIN_MANIFEST_FILE_NAME = 'serpent-plugin.json';

const pluginIdPattern = /^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$/u;
const localIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const sha256Pattern = /^[a-f0-9]{64}$/u;
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

export const pluginIdSchema = z.string().min(3).max(64).regex(pluginIdPattern, {
  message: 'Plugin id must use lowercase letters, numbers, dots, hyphens, and underscores.',
});

export const pluginLocalIdSchema = z.string().min(1).max(64).regex(localIdPattern, {
  message: 'Plugin-local identifiers must use lowercase letters, numbers, dots, hyphens, and underscores.',
});

export const pluginPackagePathSchema = z.string().min(1).max(1_024).superRefine((value, context) => {
  if (value.includes('\\') || value.includes('\0') || value.startsWith('/') || /^[A-Za-z]:/u.test(value)) {
    context.addIssue({ code: 'custom', message: 'Plugin package paths must be relative POSIX paths.' });
    return;
  }

  const segments = value.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    context.addIssue({ code: 'custom', message: 'Plugin package paths must not traverse outside the package.' });
  }
});

export interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: readonly string[];
}

export function parseSemver(value: string): ParsedSemver | undefined {
  const match = semverPattern.exec(value);
  if (match === null) return undefined;
  const [, major, minor, patch, prerelease] = match;
  if (major === undefined || minor === undefined || patch === undefined) return undefined;
  const prereleaseParts = prerelease === undefined ? [] : prerelease.split('.');
  if (prereleaseParts.some((part) => /^\d+$/u.test(part) && part.length > 1 && part.startsWith('0'))) {
    return undefined;
  }
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: prereleaseParts,
  };
}

function comparePrerelease(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === rightPart) continue;
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    const leftNumber = /^\d+$/u.test(leftPart);
    const rightNumber = /^\d+$/u.test(rightPart);
    if (leftNumber && rightNumber) return Number(leftPart) - Number(rightPart);
    if (leftNumber) return -1;
    if (rightNumber) return 1;
    return leftPart.localeCompare(rightPart);
  }
  return 0;
}

export function compareSemver(left: ParsedSemver, right: ParsedSemver): number {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  if (left.patch !== right.patch) return left.patch - right.patch;
  return comparePrerelease(left.prerelease, right.prerelease);
}

type SemverComparator = {
  operator: '>' | '>=' | '<' | '<=' | '=';
  version: ParsedSemver;
};

function parseSemverComparator(value: string): SemverComparator | undefined {
  const match = /^(>=|<=|>|<|=)?(.+)$/u.exec(value);
  if (match === null) return undefined;
  const operator = (match[1] ?? '=') as SemverComparator['operator'];
  const version = parseSemver(match[2] ?? '');
  return version === undefined ? undefined : { operator, version };
}

/**
 * The v1 package format intentionally accepts only explicit SemVer comparators
 * (and `*`). It keeps compatibility decisions deterministic across the app and
 * avoids importing a package manager's much broader range grammar into the
 * installer.
 */
export function isValidSemverRange(value: string): boolean {
  if (value === '*') return true;
  return value.split('||').every((alternative) => {
    const comparators = alternative.trim().split(/\s+/u).filter(Boolean);
    return comparators.length > 0 && comparators.every((comparator) => parseSemverComparator(comparator) !== undefined);
  });
}

export function satisfiesSemverRange(versionValue: string, range: string): boolean {
  const version = parseSemver(versionValue);
  if (version === undefined || !isValidSemverRange(range)) return false;
  if (range === '*') return true;

  return range.split('||').some((alternative) => alternative.trim().split(/\s+/u)
    .filter(Boolean)
    .every((rawComparator) => {
      const comparator = parseSemverComparator(rawComparator);
      if (comparator === undefined) return false;
      const comparison = compareSemver(version, comparator.version);
      switch (comparator.operator) {
        case '>': return comparison > 0;
        case '>=': return comparison >= 0;
        case '<': return comparison < 0;
        case '<=': return comparison <= 0;
        case '=': return comparison === 0;
      }
    }));
}

export const semverSchema = z.string().superRefine((value, context) => {
  if (parseSemver(value) === undefined) {
    context.addIssue({ code: 'custom', message: 'Version must use SemVer (for example 1.2.0).' });
  }
});

export const semverRangeSchema = z.string().min(1).max(256).superRefine((value, context) => {
  if (!isValidSemverRange(value)) {
    context.addIssue({
      code: 'custom',
      message: 'Serpent engine ranges use explicit SemVer comparators (for example >=0.2.0 <1.0.0).',
    });
  }
});

export const pluginPermissionSchema = z.enum([
  'library.read',
  'folder.read',
  'folder.write',
  'asset.read',
  'metadata.read',
  'tag.read',
  'collection.read',
  'job.read',
  'metadata.write',
  'tag.write',
  'collection.write',
  'ai.enqueue',
  'job.manage',
  'file.import',
  'file.move',
  'file.rename',
  'trash.write',
  'clipboard.read',
  'clipboard.write',
  'content.read',
  'content.write',
  'net.fetch',
  'storage.read',
  'storage.write',
  'data.files',
  'secrets.read',
  'secrets.write',
  'ui.workspace',
  'ui.inspector',
  'ui.viewer',
  'ui.settings',
  'ui.notify',
  'input.shortcut',
  'input.capture.viewer',
  'input.capture.application',
  'hook.blocking',
  'preview.provider',
  'thumbnail.provider',
  'metadata.extractor',
  'import.provider',
  'export.provider',
  'ai.provider',
  'derived-field.provider',
  'search.provider',
  'theme.trusted-css',
]);
export type PluginPermission = z.infer<typeof pluginPermissionSchema>;

const pluginPlatformSchema = z.enum(['darwin', 'win32', 'linux']);
const pluginArchitectureSchema = z.enum(['arm64', 'x64', 'ia32']);
const sha256Schema = z.string().regex(sha256Pattern, 'Expected a lowercase SHA-256 digest.');

const nativeModuleSchema = z.strictObject({
  platform: pluginPlatformSchema,
  arch: pluginArchitectureSchema,
  nodeAbi: z.number().int().positive(),
});

const restrictedRuntimeSchema = z.strictObject({
  mode: z.literal('restricted'),
  entry: pluginPackagePathSchema,
});

const unrestrictedRuntimeSchema = z.strictObject({
  mode: z.literal('unrestricted'),
  entry: pluginPackagePathSchema,
  nativeModules: z.array(nativeModuleSchema).min(1).max(32).optional(),
});

const pluginRuntimeCanonicalSchema = z.discriminatedUnion('mode', [
  restrictedRuntimeSchema,
  unrestrictedRuntimeSchema,
]);

/** Accepts legacy `standard`/`trusted` aliases and normalizes to restricted/unrestricted. */
export const pluginRuntimeSchema = z.preprocess((value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (typeof record.mode !== 'string') return value;
  try {
    return { ...record, mode: normalizePluginRuntimeMode(record.mode) };
  } catch {
    return value;
  }
}, pluginRuntimeCanonicalSchema);

export type PluginRuntime = z.infer<typeof pluginRuntimeCanonicalSchema>;
export type { PluginRuntimeMode };
export { pluginRuntimeModeSchema, normalizePluginRuntimeMode };

const contributionCommandSchema = z.strictObject({
  id: pluginLocalIdSchema,
  title: z.string().min(1).max(160),
  mcp: z.strictObject({
    export: z.literal(true),
  }).optional(),
});
type ContributionMenuItem = {
  command?: string;
  id?: string;
  title?: string;
  group?: string;
  before?: string;
  after?: string;
  submenu?: ContributionMenuItem[];
};

const contributionMenuItemSchema: z.ZodType<ContributionMenuItem> = z.lazy(() => z.strictObject({
  command: pluginLocalIdSchema.optional(),
  id: pluginLocalIdSchema.optional(),
  title: z.string().min(1).max(160).optional(),
  group: z.string().min(1).max(64).optional(),
  before: pluginLocalIdSchema.optional(),
  after: pluginLocalIdSchema.optional(),
  submenu: z.array(contributionMenuItemSchema).max(64).optional(),
}).superRefine((item, context) => {
  const hasCommand = item.command !== undefined;
  const hasSubmenu = item.submenu !== undefined;
  if (hasCommand === hasSubmenu) {
    context.addIssue({
      code: 'custom',
      message: 'A menu item must declare either command or submenu.',
    });
  }
  if (hasSubmenu && (item.id === undefined || item.title === undefined)) {
    context.addIssue({
      code: 'custom',
      path: ['id'],
      message: 'A submenu must declare id and title.',
    });
  }
  if (hasCommand && item.id !== undefined) {
    context.addIssue({
      code: 'custom',
      path: ['id'],
      message: 'A command menu item must not declare id.',
    });
  }
  if (item.before !== undefined && item.after !== undefined) {
    context.addIssue({
      code: 'custom',
      path: ['before'],
      message: 'A menu item may declare before or after, not both.',
    });
  }
}));
const contributionToolbarItemSchema = z.strictObject({
  id: pluginLocalIdSchema,
  command: pluginLocalIdSchema,
  title: z.string().min(1).max(160).optional(),
});
const contributionInspectorSectionSchema = z.strictObject({
  id: pluginLocalIdSchema,
  command: pluginLocalIdSchema,
  title: z.string().min(1).max(160).optional(),
});
const contributionViewerActionSchema = z.strictObject({
  id: pluginLocalIdSchema,
  command: pluginLocalIdSchema,
  title: z.string().min(1).max(160).optional(),
});
const contributionShortcutSchema = z.strictObject({
  id: pluginLocalIdSchema,
  command: pluginLocalIdSchema,
  accelerator: z.string().min(1).max(64),
});
const contributionViewSchema = z.strictObject({
  id: pluginLocalIdSchema,
  title: z.string().min(1).max(160),
  location: z.enum(['sidebar', 'workspace', 'inspector', 'viewer', 'settings']),
  /** Relative HTML entry for a sandboxed custom UI view. */
  entry: pluginPackagePathSchema.optional(),
});
const contributionSettingSchema = z.strictObject({
  id: pluginLocalIdSchema,
  title: z.string().min(1).max(160),
  type: z.enum(['boolean', 'number', 'string', 'select']),
  description: z.string().min(1).max(2_000).optional(),
  options: z.array(z.strictObject({
    value: z.string().min(1).max(128),
    label: z.string().min(1).max(160),
  })).max(64).optional(),
}).superRefine((setting, context) => {
  if (setting.type === 'select' && (setting.options === undefined || setting.options.length === 0)) {
    context.addIssue({
      code: 'custom',
      path: ['options'],
      message: 'Select settings must declare at least one option.',
    });
  }
  if (setting.options !== undefined
    && new Set(setting.options.map((option) => option.value)).size !== setting.options.length) {
    context.addIssue({
      code: 'custom',
      path: ['options'],
      message: 'Setting option values must be unique.',
    });
  }
});
const contributionHookSchema = z.strictObject({
  id: pluginLocalIdSchema,
  event: z.string().min(1).max(128),
  blocking: z.boolean().default(false),
});
const contributionJobSchema = z.strictObject({
  id: pluginLocalIdSchema,
  title: z.string().min(1).max(160),
  recovery: z.enum(['idempotent', 'checkpoint']).default('idempotent'),
});
const providerFieldIdSchema = z.string().min(1).max(128).regex(
  /^[A-Za-z][A-Za-z0-9._-]*$/u,
  'Provider field identifiers must start with a letter and contain only letters, numbers, dots, hyphens, and underscores.',
);
const providerExtensionSchema = z.string().min(1).max(32).regex(
  /^\.?[A-Za-z0-9][A-Za-z0-9+_-]*$/u,
  'Provider extensions must be simple extension names such as ".probe" or "png".',
);
const providerMimeTypeSchema = z.string().min(3).max(128).regex(
  /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/u,
  'Provider MIME types must use a type/subtype pair such as "image/png".',
);
const contributionProviderSchema = z.strictObject({
  id: pluginLocalIdSchema,
  kind: z.enum([
    'preview',
    'thumbnail',
    'metadata',
    'import',
    'export',
    'ai',
    'derived-field',
    'search',
  ]),
  extensions: z.array(providerExtensionSchema).max(64).optional(),
  mimeTypes: z.array(providerMimeTypeSchema).max(64).optional(),
  fieldId: providerFieldIdSchema.optional(),
  fieldType: z.enum(['string', 'number', 'boolean', 'date', 'json']).optional(),
}).superRefine((provider, context) => {
  if ((provider.kind === 'preview' || provider.kind === 'thumbnail' || provider.kind === 'metadata')
    && (provider.extensions === undefined || provider.extensions.length === 0)) {
    context.addIssue({
      code: 'custom',
      path: ['extensions'],
      message: 'Preview, thumbnail, and metadata providers must declare at least one extension.',
    });
  }
  if (provider.kind === 'import'
    && (provider.extensions === undefined || provider.extensions.length === 0)
    && (provider.mimeTypes === undefined || provider.mimeTypes.length === 0)) {
    context.addIssue({
      code: 'custom',
      path: ['extensions'],
      message: 'Import providers must declare at least one extension or MIME type.',
    });
  }
  if ((provider.kind === 'export' || provider.kind === 'ai')
    && (provider.extensions === undefined || provider.extensions.length === 0)) {
    context.addIssue({
      code: 'custom',
      path: ['extensions'],
      message: 'Export and AI providers must declare at least one extension.',
    });
  }
  if (provider.kind !== 'derived-field') return;
  if (provider.fieldId === undefined) {
    context.addIssue({ code: 'custom', path: ['fieldId'], message: 'Derived-field providers must declare fieldId.' });
  }
  if (provider.fieldType === undefined) {
    context.addIssue({ code: 'custom', path: ['fieldType'], message: 'Derived-field providers must declare fieldType.' });
  }
});

/** Host design tokens that sandboxed plugin iframes may override via theme packages. */
export const PLUGIN_UI_THEME_TOKEN_NAMES = [
  '--canvas',
  '--pane',
  '--raised',
  '--divider',
  '--text',
  '--secondary',
  '--tertiary',
  '--accent',
  '--warning',
  '--danger',
  '--success',
  '--font-ui',
] as const;

const PLUGIN_UI_THEME_TOKEN_ALLOWLIST = new Set<string>(PLUGIN_UI_THEME_TOKEN_NAMES);

const pluginThemeTokenMapSchema = z.record(
  z.string().regex(/^--[a-z0-9-]+$/u),
  z.string().max(512),
).superRefine((tokens, context) => {
  if (Object.keys(tokens).length > 32) {
    context.addIssue({
      code: 'custom',
      message: 'Theme token overrides must stay within the bounded token map size.',
    });
  }
  for (const key of Object.keys(tokens)) {
    if (!PLUGIN_UI_THEME_TOKEN_ALLOWLIST.has(key)) {
      context.addIssue({
        code: 'custom',
        path: [key],
        message: 'Theme token overrides must use supported Serpent design tokens.',
      });
    }
  }
});

export const contributionThemeSchema = z.strictObject({
  id: pluginLocalIdSchema,
  light: pluginThemeTokenMapSchema.optional(),
  dark: pluginThemeTokenMapSchema.optional(),
}).superRefine((theme, context) => {
  if ((theme.light === undefined || Object.keys(theme.light).length === 0)
    && (theme.dark === undefined || Object.keys(theme.dark).length === 0)) {
    context.addIssue({
      code: 'custom',
      message: 'Theme packages must declare at least one light or dark token override.',
    });
  }
});
export type PluginContributionTheme = z.infer<typeof contributionThemeSchema>;

export const pluginThemePackageSchema = z.strictObject({
  light: pluginThemeTokenMapSchema.default({}),
  dark: pluginThemeTokenMapSchema.default({}),
});
export type PluginThemePackage = z.infer<typeof pluginThemePackageSchema>;

export const pluginContributesSchema = z.strictObject({
  commands: z.array(contributionCommandSchema).max(256).default([]),
  menus: z.record(z.string().min(1).max(128), z.array(contributionMenuItemSchema).max(256)).default({}),
  toolbar: z.array(contributionToolbarItemSchema).max(64).default([]),
  inspector: z.array(contributionInspectorSectionSchema).max(64).default([]),
  viewerActions: z.array(contributionViewerActionSchema).max(64).default([]),
  shortcuts: z.array(contributionShortcutSchema).max(64).default([]),
  views: z.array(contributionViewSchema).max(128).default([]),
  settings: z.array(contributionSettingSchema).max(128).default([]),
  hooks: z.array(contributionHookSchema).max(128).default([]),
  jobs: z.array(contributionJobSchema).max(128).default([]),
  providers: z.array(contributionProviderSchema).max(128).default([]),
  themes: z.array(contributionThemeSchema).max(8).default([]),
});

const repositorySchema = z.url().refine((value) => {
  const url = new URL(value);
  const repositoryPath = url.pathname.split('/').filter(Boolean);
  return url.protocol === 'https:' && url.hostname === 'github.com' && repositoryPath.length === 2;
}, 'Repository must be an HTTPS GitHub repository URL.');

const pluginManifestObjectSchema = z.strictObject({
  manifestVersion: z.literal(PLUGIN_MANIFEST_VERSION),
  id: pluginIdSchema,
  version: semverSchema,
  name: z.string().min(1).max(160),
  description: z.string().min(1).max(2_000),
  author: z.string().min(1).max(160),
  license: z.string().min(1).max(160),
  repository: repositorySchema.optional(),
  engines: z.strictObject({
    serpent: semverRangeSchema,
    pluginApi: z.literal(PLUGIN_API_VERSION),
  }),
  runtime: pluginRuntimeSchema,
  ui: z.strictObject({
    entry: pluginPackagePathSchema,
  }).optional(),
  permissions: z.array(pluginPermissionSchema).max(64).superRefine((permissions, context) => {
    if (new Set(permissions).size !== permissions.length) {
      context.addIssue({ code: 'custom', message: 'Plugin permissions must not contain duplicates.' });
    }
  }),
  contributes: pluginContributesSchema,
  mcp: z.strictObject({
    expose: z.array(pluginLocalIdSchema).max(128).default([]),
  }).optional(),
});

export const pluginManifestSchema = pluginManifestObjectSchema.superRefine((manifest, context) => {
  const contributionIds = [
    ...manifest.contributes.commands.map((contribution) => contribution.id),
    ...manifest.contributes.toolbar.map((contribution) => contribution.id),
    ...manifest.contributes.inspector.map((contribution) => contribution.id),
    ...manifest.contributes.viewerActions.map((contribution) => contribution.id),
    ...manifest.contributes.shortcuts.map((contribution) => contribution.id),
    ...manifest.contributes.views.map((contribution) => contribution.id),
    ...manifest.contributes.settings.map((contribution) => contribution.id),
    ...manifest.contributes.hooks.map((contribution) => contribution.id),
    ...manifest.contributes.jobs.map((contribution) => contribution.id),
    ...manifest.contributes.providers.map((contribution) => contribution.id),
    ...manifest.contributes.themes.map((contribution) => contribution.id),
  ];
  if (new Set(contributionIds).size !== contributionIds.length) {
    context.addIssue({ code: 'custom', path: ['contributes'], message: 'Contribution identifiers must be unique within a plugin.' });
  }

  const commandIds = new Set(manifest.contributes.commands.map((command) => command.id));
  const validateMenuItems = (
    menuName: string,
    items: ContributionMenuItem[],
    parentPath: number[] = [],
    depth = 1,
  ): void => {
    if (depth > 3) {
      context.addIssue({
        code: 'custom',
        path: ['contributes', 'menus', menuName, ...parentPath],
        message: 'Plugin submenus may be nested at most three levels deep.',
      });
      return;
    }
    for (const [index, item] of items.entries()) {
      const itemPath = [...parentPath, index];
      if (item.command !== undefined && !commandIds.has(item.command)) {
        context.addIssue({
          code: 'custom',
          path: ['contributes', 'menus', menuName, ...itemPath, 'command'],
          message: 'Menu items must reference a command declared by this manifest.',
        });
      }
      if (item.submenu !== undefined) {
        validateMenuItems(menuName, item.submenu, itemPath, depth + 1);
      }
    }
  };
  for (const [menuName, items] of Object.entries(manifest.contributes.menus)) {
    validateMenuItems(menuName, items);
  }
  for (const [index, item] of manifest.contributes.toolbar.entries()) {
    if (!commandIds.has(item.command)) {
      context.addIssue({
        code: 'custom',
        path: ['contributes', 'toolbar', index, 'command'],
        message: 'Toolbar items must reference a command declared by this manifest.',
      });
    }
  }
  for (const [index, item] of manifest.contributes.inspector.entries()) {
    if (!commandIds.has(item.command)) {
      context.addIssue({
        code: 'custom',
        path: ['contributes', 'inspector', index, 'command'],
        message: 'Inspector sections must reference a command declared by this manifest.',
      });
    }
  }
  for (const [index, item] of manifest.contributes.viewerActions.entries()) {
    if (!commandIds.has(item.command)) {
      context.addIssue({
        code: 'custom',
        path: ['contributes', 'viewerActions', index, 'command'],
        message: 'Viewer actions must reference a command declared by this manifest.',
      });
    }
  }
  for (const [index, item] of manifest.contributes.shortcuts.entries()) {
    if (!commandIds.has(item.command)) {
      context.addIssue({
        code: 'custom',
        path: ['contributes', 'shortcuts', index, 'command'],
        message: 'Shortcuts must reference a command declared by this manifest.',
      });
    }
    if (!isValidPluginAccelerator(item.accelerator)) {
      context.addIssue({
        code: 'custom',
        path: ['contributes', 'shortcuts', index, 'accelerator'],
        message: 'Shortcut accelerators must use Electron accelerator syntax (for example F9 or CmdOrCtrl+Shift+K).',
      });
    }
  }
  for (const [index, commandId] of (manifest.mcp?.expose ?? []).entries()) {
    if (!commandIds.has(commandId)) {
      context.addIssue({
        code: 'custom',
        path: ['mcp', 'expose', index],
        message: 'MCP-exposed commands must be declared by this manifest.',
      });
    }
  }
});
export type PluginManifest = z.infer<typeof pluginManifestSchema>;

/**
 * Manifest declaration is only one half of MCP exposure. The local user must
 * separately enable each returned command in Main-owned settings.
 */
export function getPluginMcpExportedCommandIds(manifest: PluginManifest): Set<string> {
  const exported = new Set(manifest.mcp?.expose ?? []);
  for (const command of manifest.contributes.commands) {
    if (command.mcp?.export === true) exported.add(command.id);
  }
  return exported;
}

export interface PluginCompatibilityTarget {
  serpentVersion: string;
  pluginApiVersion: number;
  platform: z.infer<typeof pluginPlatformSchema>;
  arch: z.infer<typeof pluginArchitectureSchema>;
  nodeAbi: number;
}

export type PluginCompatibilityResult =
  | { ok: true }
  | {
    ok: false;
    code: 'PLUGIN_SERPENT_VERSION_UNSUPPORTED' | 'PLUGIN_API_VERSION_UNSUPPORTED' | 'PLUGIN_PLATFORM_UNSUPPORTED';
    message: string;
  };

export function validatePluginManifestCompatibility(
  manifest: PluginManifest,
  target: PluginCompatibilityTarget,
): PluginCompatibilityResult {
  if (!satisfiesSemverRange(target.serpentVersion, manifest.engines.serpent)) {
    return {
      ok: false,
      code: 'PLUGIN_SERPENT_VERSION_UNSUPPORTED',
      message: 'This plugin version does not support the current Serpent version.',
    };
  }
  if (target.pluginApiVersion !== manifest.engines.pluginApi) {
    return {
      ok: false,
      code: 'PLUGIN_API_VERSION_UNSUPPORTED',
      message: 'This plugin requires a different Plugin API version.',
    };
  }
  if (manifest.runtime.mode === 'unrestricted' && manifest.runtime.nativeModules !== undefined
    && !manifest.runtime.nativeModules.some((nativeModule) => nativeModule.platform === target.platform
      && nativeModule.arch === target.arch
      && nativeModule.nodeAbi === target.nodeAbi)) {
    return {
      ok: false,
      code: 'PLUGIN_PLATFORM_UNSUPPORTED',
      message: 'This plugin package does not include a compatible native module for this device.',
    };
  }
  return { ok: true };
}

/** Exported for the package lock verifier without exposing a second digest grammar. */
export const pluginSha256Schema = sha256Schema;
