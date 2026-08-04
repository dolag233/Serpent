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

/**
 * A bounded, declarative condition evaluated against the Host Contribution
 * Context. It is deliberately only a transport-level contract here; the
 * evaluator lives in the renderer/plugin context module.
 */
export const pluginContextExpressionSchema = z.string().min(1).max(4_096).superRefine((value, context) => {
  if (value.trim().length === 0) {
    context.addIssue({ code: 'custom', message: 'Context expressions must not be blank.' });
  }
  if (/\s{64}/u.test(value)) {
    context.addIssue({ code: 'custom', message: 'Context expressions contain excessive whitespace.' });
  }
});
export type PluginContextExpression = z.infer<typeof pluginContextExpressionSchema>;

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
  instanceScope: z.enum(['global', 'library']).default('library'),
});

const unrestrictedRuntimeSchema = z.strictObject({
  mode: z.literal('unrestricted'),
  entry: pluginPackagePathSchema,
  instanceScope: z.enum(['global', 'library']).default('library'),
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

const contributionConditionFields = {
  when: pluginContextExpressionSchema.optional(),
  enablement: pluginContextExpressionSchema.optional(),
  checked: pluginContextExpressionSchema.optional(),
};

const contributionCommandSchema = z.strictObject({
  id: pluginLocalIdSchema,
  title: z.string().min(1).max(160),
  mcp: z.strictObject({
    export: z.literal(true),
  }).optional(),
  ...contributionConditionFields,
});
type ContributionMenuItem = {
  command?: string;
  id?: string;
  title?: string;
  group?: string;
  before?: string;
  after?: string;
  first?: boolean;
  last?: boolean;
  when?: PluginContextExpression;
  enablement?: PluginContextExpression;
  checked?: PluginContextExpression;
  submenu?: ContributionMenuItem[];
};

const contributionMenuItemSchema: z.ZodType<ContributionMenuItem> = z.lazy(() => z.strictObject({
  command: pluginLocalIdSchema.optional(),
  id: pluginLocalIdSchema.optional(),
  title: z.string().min(1).max(160).optional(),
  group: z.string().min(1).max(64).optional(),
  before: pluginLocalIdSchema.optional(),
  after: pluginLocalIdSchema.optional(),
  first: z.boolean().optional(),
  last: z.boolean().optional(),
  ...contributionConditionFields,
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
  if (item.first === true && item.last === true) {
    context.addIssue({
      code: 'custom',
      path: ['first'],
      message: 'A menu item may not be both first and last.',
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
export const pluginSettingTypeSchema = z.enum(['boolean', 'number', 'string', 'select']);
export const pluginSettingValueSchema = z.union([
  z.boolean(),
  z.number().finite(),
  z.string().max(8_192),
]);
export type PluginSettingValue = z.infer<typeof pluginSettingValueSchema>;

const contributionSettingOptionSchema = z.strictObject({
  value: z.string().min(1).max(128),
  label: z.string().min(1).max(160),
});
const contributionSettingBase = {
  id: pluginLocalIdSchema,
  title: z.string().min(1).max(160),
  description: z.string().min(1).max(2_000).optional(),
};

const contributionSettingSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...contributionSettingBase,
    type: z.literal('boolean'),
    default: z.boolean().optional(),
  }),
  z.strictObject({
    ...contributionSettingBase,
    type: z.literal('number'),
    default: z.number().finite().optional(),
    minimum: z.number().finite().optional(),
    maximum: z.number().finite().optional(),
  }).superRefine((setting, context) => {
    if (setting.minimum !== undefined && setting.maximum !== undefined
      && setting.minimum > setting.maximum) {
      context.addIssue({
        code: 'custom',
        path: ['maximum'],
        message: 'Setting maximum must be greater than or equal to minimum.',
      });
    }
    if (setting.default !== undefined && setting.minimum !== undefined
      && setting.default < setting.minimum) {
      context.addIssue({
        code: 'custom',
        path: ['default'],
        message: 'Setting default must be greater than or equal to minimum.',
      });
    }
    if (setting.default !== undefined && setting.maximum !== undefined
      && setting.default > setting.maximum) {
      context.addIssue({
        code: 'custom',
        path: ['default'],
        message: 'Setting default must be less than or equal to maximum.',
      });
    }
  }),
  z.strictObject({
    ...contributionSettingBase,
    type: z.literal('string'),
    default: z.string().max(8_192).optional(),
  }),
  z.strictObject({
    ...contributionSettingBase,
    type: z.literal('select'),
    default: z.string().max(128).optional(),
    options: z.array(contributionSettingOptionSchema).min(1).max(64),
  }).superRefine((setting, context) => {
    if (new Set(setting.options.map((option) => option.value)).size !== setting.options.length) {
      context.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'Setting option values must be unique.',
      });
    }
    if (setting.default !== undefined
      && !setting.options.some((option) => option.value === setting.default)) {
      context.addIssue({
        code: 'custom',
        path: ['default'],
        message: 'Setting default must be one of the declared options.',
      });
    }
  }),
]);

export type PluginSettingDefinition = z.infer<typeof contributionSettingSchema>;

export function getPluginSettingDefault(setting: PluginSettingDefinition): PluginSettingValue {
  if (setting.default !== undefined) return setting.default;
  switch (setting.type) {
    case 'boolean': return false;
    case 'string': return '';
    case 'select': return setting.options[0]?.value ?? '';
    case 'number': {
      const candidate = setting.minimum ?? 0;
      return setting.maximum !== undefined && candidate > setting.maximum ? setting.maximum : candidate;
    }
  }
}

export type PluginSettingValidationCode = 'invalid-type' | 'out-of-range' | 'invalid-option';

export type PluginSettingValidationFailure = {
  valid: false;
  code: PluginSettingValidationCode;
  message: string;
};

export type PluginSettingValidationResult = { valid: true } | PluginSettingValidationFailure;

export function validatePluginSettingValue(
  setting: PluginSettingDefinition,
  value: unknown,
): PluginSettingValidationResult {
  const expectedType = setting.type === 'boolean'
    ? typeof value === 'boolean'
    : setting.type === 'number'
      ? typeof value === 'number' && Number.isFinite(value)
      : typeof value === 'string';
  if (!expectedType) {
    return {
      valid: false,
      code: 'invalid-type',
      message: `The setting value must be a ${setting.type === 'select' ? 'string' : setting.type}.`,
    };
  }
  if (setting.type === 'number'
    && ((setting.minimum !== undefined && (value as number) < setting.minimum)
      || (setting.maximum !== undefined && (value as number) > setting.maximum))) {
    return {
      valid: false,
      code: 'out-of-range',
      message: 'The setting value is outside the declared range.',
    };
  }
  if (setting.type === 'select'
    && !setting.options.some((option) => option.value === value)) {
    return {
      valid: false,
      code: 'invalid-option',
      message: 'The setting value is not one of the declared options.',
    };
  }
  return { valid: true };
}
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

/**
 * Public semantic references for sandboxed plugin UI. These are intentionally
 * not the implementation names of legacy styles.css variables. Host-rendered
 * UI and plugin iframes can rely on this vocabulary while the internal CSS
 * migration continues.
 */
export const PLUGIN_UI_THEME_REFERENCE_NAMES = [
  'surface.canvas',
  'surface.pane',
  'surface.raised',
  'surface.overlay',
  'content.primary',
  'content.secondary',
  'content.tertiary',
  'border.divider',
  'border.control',
  'border.focus',
  'action.accent',
  'state.info',
  'state.success',
  'state.warning',
  'state.error',
] as const;
export type PluginUiThemeReference = (typeof PLUGIN_UI_THEME_REFERENCE_NAMES)[number];

/** CSS variables sent to plugin views for the public semantic references. */
export const PLUGIN_UI_THEME_REFERENCE_CSS_VARS: Readonly<Record<PluginUiThemeReference, string>> = {
  'surface.canvas': '--ui-surface-canvas',
  'surface.pane': '--ui-surface-pane',
  'surface.raised': '--ui-surface-raised',
  'surface.overlay': '--ui-surface-overlay',
  'content.primary': '--ui-content-primary',
  'content.secondary': '--ui-content-secondary',
  'content.tertiary': '--ui-content-tertiary',
  'border.divider': '--ui-border-divider',
  'border.control': '--ui-border-control',
  'border.focus': '--ui-border-focus',
  'action.accent': '--ui-action-accent',
  'state.info': '--ui-status-info',
  'state.success': '--ui-status-success',
  'state.warning': '--ui-status-warning',
  'state.error': '--ui-status-danger',
};

/** Host CSS variables that sandboxed plugin iframes may read. */
export const PLUGIN_UI_THEME_TOKEN_NAMES = Object.values(PLUGIN_UI_THEME_REFERENCE_CSS_VARS);

const pluginThemeLocalTokenNameSchema = z.string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9.-]*$/u, 'Plugin theme token names must be lowercase local names.');

/** Theme v1 is deliberately color-only; arbitrary CSS is not a theme API. */
const pluginThemeColorValueSchema = z.string()
  .max(128)
  .regex(
    /^(?:#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([^\n()]{1,96}\)|transparent|currentColor)$/iu,
    'Theme values must be bounded color values.',
  );

const pluginThemeReferencesSchema = z.record(
  pluginThemeLocalTokenNameSchema,
  z.enum(PLUGIN_UI_THEME_REFERENCE_NAMES),
).superRefine((references, context) => {
  if (Object.keys(references).length > 32) {
    context.addIssue({
      code: 'custom',
      message: 'Theme references must stay within the bounded token map size.',
    });
  }
});

const pluginThemeOwnedTokensSchema = z.record(
  pluginThemeLocalTokenNameSchema,
  pluginThemeColorValueSchema,
).superRefine((tokens, context) => {
  if (Object.keys(tokens).length > 32) {
    context.addIssue({
      code: 'custom',
      message: 'Plugin-owned theme tokens must stay within the bounded token map size.',
    });
  }
});

const pluginThemeModeSchema = z.strictObject({
  references: pluginThemeReferencesSchema.default({}),
  tokens: pluginThemeOwnedTokensSchema.default({}),
}).superRefine((mode, context) => {
  if (Object.keys(mode.references).length === 0 && Object.keys(mode.tokens).length === 0) {
    context.addIssue({
      code: 'custom',
      message: 'Theme modes must declare at least one reference or owned token.',
    });
  }
});

export const contributionThemeSchema = z.strictObject({
  id: pluginLocalIdSchema,
  version: z.literal(1).default(1),
  light: pluginThemeModeSchema.optional(),
  dark: pluginThemeModeSchema.optional(),
}).superRefine((theme, context) => {
  if (theme.light === undefined && theme.dark === undefined) {
    context.addIssue({
      code: 'custom',
      message: 'Theme packages must declare at least one light or dark mode.',
    });
  }
});
export type PluginContributionTheme = z.infer<typeof contributionThemeSchema>;

export const pluginThemeModePackageSchema = z.strictObject({
  references: pluginThemeReferencesSchema.default({}),
  tokens: pluginThemeOwnedTokensSchema.default({}),
});
export type PluginThemeModePackage = z.infer<typeof pluginThemeModePackageSchema>;

export const pluginThemePackageSchema = z.strictObject({
  version: z.literal(1).default(1),
  light: pluginThemeModePackageSchema.default({ references: {}, tokens: {} }),
  dark: pluginThemeModePackageSchema.default({ references: {}, tokens: {} }),
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

function formatJsonPath(path: readonly (string | number)[]): string {
  return path.reduce<string>((result, segment) => {
    if (typeof segment === 'number') return `${result}[${segment}]`;
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(segment)
      ? `${result}.${segment}`
      : `${result}[${JSON.stringify(segment)}]`;
  }, '$');
}

/** Converts Zod's issue paths into safe, renderer-displayable JSON paths. */
export function formatPluginManifestValidationIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${formatJsonPath(issue.path as Array<string | number>)}: ${issue.message}`)
    .join('; ');
}

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
