import { z } from 'zod';

/** Versioned, JSON-only contract for Host-rendered plugin UI. */
export const PLUGIN_UI_DESCRIPTOR_VERSION = 1 as const;

const localIdSchema = z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9._-]{0,63}$/u);
const labelSchema = z.string().min(1).max(160);
const descriptionSchema = z.string().min(1).max(2_000);
const conditionSchema = z.string().min(1).max(4_096);
const toneSchema = z.enum(['info', 'success', 'warning', 'error']);

export const pluginUiSettingsGroupItemSchema = z.strictObject({
  /** References the existing contributes.settings declaration. */
  settingId: localIdSchema,
});
export type PluginUiSettingsGroupItem = z.infer<typeof pluginUiSettingsGroupItemSchema>;

export const pluginUiSettingsGroupSchema = z.strictObject({
  id: localIdSchema,
  title: labelSchema,
  description: descriptionSchema.optional(),
  items: z.array(pluginUiSettingsGroupItemSchema).min(1).max(64),
});
export type PluginUiSettingsGroup = z.infer<typeof pluginUiSettingsGroupSchema>;
const pluginUiSettingsGroupHeaderSchema = pluginUiSettingsGroupSchema.omit({ items: true });

export type PluginUiMenuItem = {
  command?: string;
  id?: string;
  title?: string;
  group?: string;
  before?: string;
  after?: string;
  first?: boolean;
  last?: boolean;
  shortcut?: string;
  when?: string;
  enablement?: string;
  checked?: string;
  submenu?: PluginUiMenuItem[];
};

export const pluginUiMenuItemSchema: z.ZodType<PluginUiMenuItem> = z.lazy(() => z.strictObject({
  command: localIdSchema.optional(),
  id: localIdSchema.optional(),
  title: labelSchema.optional(),
  group: z.string().min(1).max(64).optional(),
  before: z.string().min(1).max(255).optional(),
  after: z.string().min(1).max(255).optional(),
  first: z.boolean().optional(),
  last: z.boolean().optional(),
  shortcut: z.string().min(1).max(64).optional(),
  when: conditionSchema.optional(),
  enablement: conditionSchema.optional(),
  checked: conditionSchema.optional(),
  submenu: z.array(pluginUiMenuItemSchema).max(64).optional(),
}).superRefine((item, context) => {
  const hasCommand = item.command !== undefined;
  const hasSubmenu = item.submenu !== undefined;
  if (hasCommand === hasSubmenu) {
    context.addIssue({ code: 'custom', message: 'A menu item must declare either command or submenu.' });
  }
  if (hasSubmenu && (item.id === undefined || item.title === undefined)) {
    context.addIssue({ code: 'custom', path: ['id'], message: 'A submenu must declare id and title.' });
  }
  if (hasCommand && item.id !== undefined) {
    context.addIssue({ code: 'custom', path: ['id'], message: 'A command item must not declare id.' });
  }
  if (item.before !== undefined && item.after !== undefined) {
    context.addIssue({ code: 'custom', path: ['before'], message: 'A menu item may declare before or after, not both.' });
  }
  if (item.first === true && item.last === true) {
    context.addIssue({ code: 'custom', path: ['first'], message: 'A menu item may not be both first and last.' });
  }
}));

export const pluginUiMenuSurfaceSchema = z.object({
  asset: z.array(pluginUiMenuItemSchema).max(256).optional(),
  folder: z.array(pluginUiMenuItemSchema).max(256).optional(),
  collection: z.array(pluginUiMenuItemSchema).max(256).optional(),
  workspace: z.array(pluginUiMenuItemSchema).max(256).optional(),
}).strict();
export type PluginUiMenuSurface = z.infer<typeof pluginUiMenuSurfaceSchema>;

const feedbackBase = {
  id: localIdSchema,
  title: labelSchema.optional(),
  message: z.string().min(1).max(4_096),
  tone: toneSchema.optional(),
};

export const pluginUiNoticeSchema = z.strictObject({
  ...feedbackBase,
  dismissible: z.boolean().optional(),
  action: z.strictObject({
    label: labelSchema,
    command: localIdSchema,
  }).optional(),
});
export type PluginUiNotice = z.infer<typeof pluginUiNoticeSchema>;

export const pluginUiActivitySchema = z.strictObject({
  ...feedbackBase,
  progress: z.strictObject({
    value: z.number().finite().nonnegative(),
    max: z.number().finite().positive(),
  }).optional(),
  indeterminate: z.boolean().optional(),
  dismissible: z.boolean().optional(),
  action: z.strictObject({
    label: labelSchema,
    command: localIdSchema,
  }).optional(),
});
export type PluginUiActivity = z.infer<typeof pluginUiActivitySchema>;

export const pluginUiJobSchema = z.strictObject({
  id: localIdSchema,
  title: labelSchema,
  message: z.string().min(1).max(4_096).optional(),
  dismissible: z.boolean().optional(),
});
export type PluginUiJob = z.infer<typeof pluginUiJobSchema>;

export const pluginUiDescriptorSchema = z.strictObject({
  version: z.literal(PLUGIN_UI_DESCRIPTOR_VERSION),
  settings: z.strictObject({
    groups: z.array(pluginUiSettingsGroupSchema).max(64),
  }).optional(),
  menus: pluginUiMenuSurfaceSchema.optional(),
  notices: z.array(pluginUiNoticeSchema).max(64).optional(),
  activities: z.array(pluginUiActivitySchema).max(64).optional(),
  jobs: z.array(pluginUiJobSchema).max(64).optional(),
});
export type PluginUiDescriptor = z.infer<typeof pluginUiDescriptorSchema>;

export type PluginUiDescriptorDiagnostic = {
  path: string;
  code: 'invalid-root' | 'unsupported-version' | 'unknown-field' | 'invalid-field';
  message: string;
};

export type PluginUiDescriptorParseResult = {
  descriptor?: PluginUiDescriptor;
  diagnostics: PluginUiDescriptorDiagnostic[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function diagnostic(
  diagnostics: PluginUiDescriptorDiagnostic[],
  path: string,
  code: PluginUiDescriptorDiagnostic['code'],
  message: string,
): void {
  diagnostics.push({ path, code, message });
}

function parseArrayField<T>(
  value: unknown,
  path: string,
  schema: z.ZodType<T>,
  diagnostics: PluginUiDescriptorDiagnostic[],
  max: number,
): T[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    diagnostic(diagnostics, path, 'invalid-field', 'Expected an array.');
    return undefined;
  }
  const parsed: T[] = [];
  for (const [index, item] of value.entries()) {
    const result = schema.safeParse(item);
    if (!result.success) {
      diagnostic(diagnostics, `${path}[${index}]`, 'invalid-field', result.error.issues[0]?.message ?? 'Invalid field.');
      continue;
    }
    parsed.push(result.data);
  }
  if (value.length > max) {
    diagnostic(diagnostics, path, 'invalid-field', `At most ${max} entries are supported.`);
  }
  return parsed.slice(0, max);
}

function parseSettingsGroups(
  value: unknown,
  diagnostics: PluginUiDescriptorDiagnostic[],
): PluginUiSettingsGroup[] | undefined {
  if (!Array.isArray(value)) {
    diagnostic(diagnostics, 'settings.groups', 'invalid-field', 'Expected an array.');
    return undefined;
  }
  const groups: PluginUiSettingsGroup[] = [];
  for (const [index, rawGroup] of value.entries()) {
    if (!isRecord(rawGroup)) {
      diagnostic(diagnostics, `settings.groups[${index}]`, 'invalid-field', 'Expected an object.');
      continue;
    }
    const { items: rawItems, ...rawHeader } = rawGroup;
    const header = pluginUiSettingsGroupHeaderSchema.safeParse(rawHeader);
    if (!header.success) {
      diagnostic(diagnostics, `settings.groups[${index}]`, 'invalid-field', header.error.issues[0]?.message ?? 'Invalid settings group.');
      continue;
    }
    const items = parseArrayField(
      rawItems,
      `settings.groups[${index}].items`,
      pluginUiSettingsGroupItemSchema,
      diagnostics,
      64,
    );
    if (items === undefined || items.length === 0) {
      diagnostic(diagnostics, `settings.groups[${index}].items`, 'invalid-field', 'A settings group needs at least one valid item.');
      continue;
    }
    groups.push({ ...header.data, items });
  }
  if (value.length > 64) diagnostic(diagnostics, 'settings.groups', 'invalid-field', 'At most 64 groups are supported.');
  return groups.slice(0, 64);
}

function parseMenuSurface(
  value: unknown,
  diagnostics: PluginUiDescriptorDiagnostic[],
): PluginUiMenuSurface | undefined {
  if (!isRecord(value)) {
    diagnostic(diagnostics, 'menus', 'invalid-field', 'Expected an object.');
    return undefined;
  }
  const surfaces: PluginUiMenuSurface = {};
  for (const key of Object.keys(value)) {
    if (!['asset', 'folder', 'collection', 'workspace'].includes(key)) {
      diagnostic(diagnostics, `menus.${key}`, 'unknown-field', 'Unknown menu surface.');
    }
  }
  for (const surface of ['asset', 'folder', 'collection', 'workspace'] as const) {
    const items = parseArrayField(value[surface], `menus.${surface}`, pluginUiMenuItemSchema, diagnostics, 256);
    if (items !== undefined) surfaces[surface] = items;
  }
  return surfaces;
}

/**
 * Parses untrusted manifest JSON without allowing one malformed UI field to
 * remove all other contributions. Functions, HTML, CSS, and unknown fields
 * are rejected by the strict schemas.
 */
export function parsePluginUiDescriptor(input: unknown): PluginUiDescriptorParseResult {
  const diagnostics: PluginUiDescriptorDiagnostic[] = [];
  if (!isRecord(input)) {
    diagnostic(diagnostics, '', 'invalid-root', 'The UI descriptor must be a JSON object.');
    return { diagnostics };
  }

  const knownFields = new Set(['version', 'settings', 'menus', 'notices', 'activities', 'jobs']);
  for (const key of Object.keys(input)) {
    if (!knownFields.has(key)) diagnostic(diagnostics, key, 'unknown-field', 'Unknown UI descriptor field.');
  }

  if (input.version !== PLUGIN_UI_DESCRIPTOR_VERSION) {
    diagnostic(diagnostics, 'version', 'unsupported-version', `Only UI descriptor version ${PLUGIN_UI_DESCRIPTOR_VERSION} is supported.`);
    return { diagnostics };
  }

  const descriptor: PluginUiDescriptor = { version: PLUGIN_UI_DESCRIPTOR_VERSION };
  const settingsValue = input.settings;
  if (settingsValue !== undefined) {
    if (!isRecord(settingsValue)) {
      diagnostic(diagnostics, 'settings', 'invalid-field', 'Expected an object.');
    } else {
      for (const key of Object.keys(settingsValue)) {
        if (key !== 'groups') diagnostic(diagnostics, `settings.${key}`, 'unknown-field', 'Unknown settings descriptor field.');
      }
      const groups = parseSettingsGroups(settingsValue.groups, diagnostics);
      if (groups !== undefined) descriptor.settings = { groups };
    }
  }

  if (input.menus !== undefined) {
    const menus = parseMenuSurface(input.menus, diagnostics);
    if (menus !== undefined) descriptor.menus = menus;
  }

  const notices = parseArrayField(input.notices, 'notices', pluginUiNoticeSchema, diagnostics, 64);
  const activities = parseArrayField(input.activities, 'activities', pluginUiActivitySchema, diagnostics, 64);
  const jobs = parseArrayField(input.jobs, 'jobs', pluginUiJobSchema, diagnostics, 64);
  if (notices !== undefined) descriptor.notices = notices;
  if (activities !== undefined) descriptor.activities = activities;
  if (jobs !== undefined) descriptor.jobs = jobs;
  return { descriptor, diagnostics };
}

export function isPluginUiDescriptor(value: unknown): value is PluginUiDescriptor {
  return pluginUiDescriptorSchema.safeParse(value).success;
}
