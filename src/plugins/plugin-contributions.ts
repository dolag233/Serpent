import { z } from 'zod';

import { findReservedAcceleratorConflict } from '../shared/plugin-accelerator';
import {
  pluginIdSchema,
  pluginLocalIdSchema,
  pluginContextExpressionSchema,
  pluginSettingTypeSchema,
  pluginSettingValueSchema,
  type PluginManifest,
} from './plugin-manifest';

export const pluginContributionKindSchema = z.enum([
  'command',
  'menu',
  'toolbar',
  'inspector-section',
  'viewer-action',
  'settings-section',
  'view',
  'shortcut',
  'hook',
  'job',
  'provider',
]);
export type PluginContributionKind = z.infer<typeof pluginContributionKindSchema>;

export const pluginContributionTargetSchema = z.enum([
  'commands',
  'menus.asset',
  'menus.folder',
  'menus.collection',
  'menus.workspace',
  'toolbar',
  'inspector.sections',
  'viewer.actions',
  'settings.sections',
  'sidebar.entries',
  'workspace.views',
  'inspector.views',
  'viewer.overlays',
  'settings.pages',
  'shortcuts',
  'hooks',
  'jobs',
  'providers',
]);
export type PluginContributionTarget = z.infer<typeof pluginContributionTargetSchema>;

const pluginContributionLibraryIdSchema = z.string().min(1).max(64);

const pluginContributionRegistrationSchema = z.strictObject({
  pluginInstanceId: z.string().min(1).max(255),
  pluginId: pluginIdSchema,
  libraryId: pluginContributionLibraryIdSchema,
  localId: pluginLocalIdSchema,
  kind: pluginContributionKindSchema,
  target: pluginContributionTargetSchema,
  title: z.string().min(1).max(160),
  mcpExported: z.boolean().optional(),
  commandId: pluginLocalIdSchema.optional(),
  commandTitle: z.string().min(1).max(160).optional(),
  group: z.string().min(1).max(64).optional(),
  parentId: z.string().min(1).max(255).optional(),
  before: z.string().min(1).max(255).optional(),
  after: z.string().min(1).max(255).optional(),
  first: z.boolean().optional(),
  last: z.boolean().optional(),
  when: pluginContextExpressionSchema.optional(),
  enablement: pluginContextExpressionSchema.optional(),
  checked: pluginContextExpressionSchema.optional(),
  shortcut: z.string().min(1).max(64).optional(),
  settingType: pluginSettingTypeSchema.optional(),
  settingDescription: z.string().min(1).max(2_000).optional(),
  settingOptions: z.array(z.strictObject({
    value: z.string().min(1).max(128),
    label: z.string().min(1).max(160),
  })).max(64).optional(),
  settingDefault: pluginSettingValueSchema.optional(),
  settingMinimum: z.number().finite().optional(),
  settingMaximum: z.number().finite().optional(),
  settingStep: z.number().finite().positive().optional(),
  uiEntryPath: z.string().min(1).max(1_024).optional(),
  accelerator: z.string().min(1).max(64).optional(),
});
export type PluginContributionRegistration = z.infer<typeof pluginContributionRegistrationSchema>;

export interface RegisteredPluginContribution extends PluginContributionRegistration {
  id: string;
}

/**
 * Contribution IDs are scoped by library so the same plugin can activate in
 * multiple open libraries without colliding on the process-wide registry.
 */
export function createPluginContributionId(
  pluginId: string,
  localId: string,
  libraryId: string,
): string {
  return [
    pluginIdSchema.parse(pluginId),
    pluginContributionLibraryIdSchema.parse(libraryId),
    pluginLocalIdSchema.parse(localId),
  ].join('.');
}

export interface PluginContributionRegistry {
  register(value: PluginContributionRegistration): RegisteredPluginContribution;
  list(): readonly RegisteredPluginContribution[];
  revokePluginInstance(pluginInstanceId: string): number;
}

export const pluginHostMenuTargetSchema = z.enum([
  'menus.asset',
  'menus.folder',
  'menus.collection',
  'menus.workspace',
]);
export type PluginHostMenuTarget = z.infer<typeof pluginHostMenuTargetSchema>;

export type PluginMenuContribution = {
  id: string;
  pluginId: string;
  pluginInstanceId: string;
  commandId?: string;
  title: string;
  target: PluginHostMenuTarget;
  group?: string;
  parentId?: string;
  before?: string;
  after?: string;
  first?: boolean;
  last?: boolean;
  when?: string;
  enablement?: string;
  checked?: string;
  shortcut?: string;
};

/** @deprecated Use {@link PluginMenuContribution} */
export type PluginAssetMenuContribution = PluginMenuContribution & {
  target: 'menus.asset';
};

const MENU_TARGET_BY_NAME: Record<string, PluginContributionTarget> = {
  asset: 'menus.asset',
  folder: 'menus.folder',
  collection: 'menus.collection',
  workspace: 'menus.workspace',
};

const VIEW_TARGET_BY_LOCATION: Record<string, PluginContributionTarget> = {
  sidebar: 'sidebar.entries',
  workspace: 'workspace.views',
  inspector: 'inspector.views',
  viewer: 'viewer.overlays',
  settings: 'settings.pages',
};

/**
 * Registers descriptor-only Contributions from a verified manifest. UI/Hook
 * routing arrives in later phases; Host lifecycle only needs stable IDs that
 * can be revoked when the plugin instance ends.
 */
export function registerManifestContributions(
  registry: PluginContributionRegistry,
  input: {
    pluginInstanceId: string;
    pluginId: string;
    libraryId: string;
    contributes: PluginManifest['contributes'] | undefined;
    mcpExportedCommandIds?: ReadonlySet<string>;
    uiEntryPath?: string;
  },
): number {
  const contributes = input.contributes ?? {
    commands: [],
    menus: {},
    toolbar: [],
    inspector: [],
    viewerActions: [],
    shortcuts: [],
    views: [],
    settings: [],
    hooks: [],
    jobs: [],
    providers: [],
    themes: [],
  };
  let registered = 0;
  // A menu item references a command, while shortcuts are declared in a
  // separate manifest section. Keep the first effective shortcut per command
  // so the renderer can present the same accelerator beside the menu item.
  const shortcutByCommand = new Map<string, string>();
  for (const shortcut of contributes.shortcuts ?? []) {
    if (findReservedAcceleratorConflict(shortcut.accelerator) !== null) continue;
    if (!shortcutByCommand.has(shortcut.command)) {
      shortcutByCommand.set(shortcut.command, shortcut.accelerator);
    }
  }
  for (const command of contributes.commands) {
    registry.register({
      pluginInstanceId: input.pluginInstanceId,
      pluginId: input.pluginId,
      libraryId: input.libraryId,
      localId: command.id,
      kind: 'command',
      target: 'commands',
      title: command.title,
      ...(command.when === undefined ? {} : { when: command.when }),
      ...(command.enablement === undefined ? {} : { enablement: command.enablement }),
      ...(command.checked === undefined ? {} : { checked: command.checked }),
      ...(input.mcpExportedCommandIds?.has(command.id) === true ? { mcpExported: true } : {}),
    });
    registered += 1;
  }
  const registerMenuItems = (
    menuName: string,
    items: NonNullable<PluginManifest['contributes']['menus'][string]>,
    target: PluginHostMenuTarget,
    parentId?: string,
    parentPath: string[] = [],
  ): void => {
    const siblingContributionIds = new Map<string, string>();
    const ambiguousSiblingAnchors = new Set<string>();
    const rememberSiblingAnchor = (anchor: string, contributionId: string): void => {
      const previous = siblingContributionIds.get(anchor);
      if (previous !== undefined && previous !== contributionId) {
        ambiguousSiblingAnchors.add(anchor);
        siblingContributionIds.delete(anchor);
        return;
      }
      if (!ambiguousSiblingAnchors.has(anchor)) {
        siblingContributionIds.set(anchor, contributionId);
      }
    };
    const entries = items.map((item, index) => {
      const segment = item.id ?? item.command ?? `item-${index + 1}`;
      const localId = `menu.${menuName}.${[...parentPath, segment].join('.')}`;
      const contributionId = createPluginContributionId(input.pluginId, localId, input.libraryId);
      rememberSiblingAnchor(segment, contributionId);
      rememberSiblingAnchor(localId, contributionId);
      if (item.command !== undefined) rememberSiblingAnchor(item.command, contributionId);
      return { item, segment, localId };
    });
    const resolveSiblingAnchor = (anchor: string | undefined): string | undefined => {
      if (anchor === undefined || ambiguousSiblingAnchors.has(anchor)) return anchor;
      return siblingContributionIds.get(anchor) ?? anchor;
    };
    for (const { item, segment, localId } of entries) {
      const title = item.title
        ?? (item.command === undefined
          ? item.id ?? segment
          : contributes.commands.find((command) => command.id === item.command)?.title ?? item.command);
      const registeredItem = registry.register({
        pluginInstanceId: input.pluginInstanceId,
        pluginId: input.pluginId,
        libraryId: input.libraryId,
        localId,
        kind: 'menu',
        target,
        title,
        ...(item.command === undefined ? {} : { commandId: item.command }),
        ...(item.group === undefined ? {} : { group: item.group }),
        ...(item.before === undefined ? {} : { before: resolveSiblingAnchor(item.before) }),
        ...(item.after === undefined ? {} : { after: resolveSiblingAnchor(item.after) }),
        ...(item.first === undefined ? {} : { first: item.first }),
        ...(item.last === undefined ? {} : { last: item.last }),
        ...(item.when === undefined ? {} : { when: item.when }),
        ...(item.enablement === undefined ? {} : { enablement: item.enablement }),
        ...(item.checked === undefined ? {} : { checked: item.checked }),
        ...(item.command === undefined || shortcutByCommand.get(item.command) === undefined
          ? {}
          : { shortcut: shortcutByCommand.get(item.command) }),
        ...(parentId === undefined ? {} : { parentId }),
      });
      registered += 1;
      if (item.submenu !== undefined) {
        registerMenuItems(menuName, item.submenu, target, registeredItem.id, [...parentPath, segment]);
      }
    }
  };
  for (const [menuName, items] of Object.entries(contributes.menus)) {
    const target = MENU_TARGET_BY_NAME[menuName] as PluginHostMenuTarget | undefined;
    if (target === undefined) continue;
    registerMenuItems(menuName, items, target);
  }
  for (const item of contributes.toolbar ?? []) {
    registry.register({
      pluginInstanceId: input.pluginInstanceId,
      pluginId: input.pluginId,
      libraryId: input.libraryId,
      localId: `toolbar.${item.id}`,
      kind: 'toolbar',
      target: 'toolbar',
      title: item.title
        ?? contributes.commands.find((command) => command.id === item.command)?.title
        ?? item.command,
      commandId: item.command,
    });
    registered += 1;
  }
  for (const item of contributes.inspector ?? []) {
    const commandTitle = contributes.commands.find((command) => command.id === item.command)?.title
      ?? item.command;
    registry.register({
      pluginInstanceId: input.pluginInstanceId,
      pluginId: input.pluginId,
      libraryId: input.libraryId,
      localId: `inspector.${item.id}`,
      kind: 'inspector-section',
      target: 'inspector.sections',
      title: item.title ?? commandTitle,
      commandId: item.command,
      commandTitle,
    });
    registered += 1;
  }
  for (const item of contributes.viewerActions ?? []) {
    registry.register({
      pluginInstanceId: input.pluginInstanceId,
      pluginId: input.pluginId,
      libraryId: input.libraryId,
      localId: `viewer-action.${item.id}`,
      kind: 'viewer-action',
      target: 'viewer.actions',
      title: item.title
        ?? contributes.commands.find((command) => command.id === item.command)?.title
        ?? item.command,
      commandId: item.command,
    });
    registered += 1;
  }
  for (const item of contributes.shortcuts ?? []) {
    const conflict = findReservedAcceleratorConflict(item.accelerator);
    if (conflict !== null) {
      continue;
    }
    registry.register({
      pluginInstanceId: input.pluginInstanceId,
      pluginId: input.pluginId,
      libraryId: input.libraryId,
      localId: `shortcut.${item.id}`,
      kind: 'shortcut',
      target: 'shortcuts',
      title: contributes.commands.find((command) => command.id === item.command)?.title ?? item.command,
      commandId: item.command,
      accelerator: item.accelerator,
    });
    registered += 1;
  }
  for (const view of contributes.views) {
    const target = VIEW_TARGET_BY_LOCATION[view.location];
    if (target === undefined) continue;
    registry.register({
      pluginInstanceId: input.pluginInstanceId,
      pluginId: input.pluginId,
      libraryId: input.libraryId,
      localId: view.id,
      kind: 'view',
      target,
      title: view.title,
      ...(view.entry ?? input.uiEntryPath
        ? { uiEntryPath: view.entry ?? input.uiEntryPath }
        : {}),
    });
    registered += 1;
  }
  for (const setting of contributes.settings) {
    registry.register({
      pluginInstanceId: input.pluginInstanceId,
      pluginId: input.pluginId,
      libraryId: input.libraryId,
      localId: setting.id,
      kind: 'settings-section',
      target: 'settings.sections',
      title: setting.title,
      settingType: setting.type,
      ...(setting.description === undefined ? {} : { settingDescription: setting.description }),
      ...(setting.type === 'select' ? { settingOptions: setting.options } : {}),
      ...(setting.default === undefined ? {} : { settingDefault: setting.default }),
      ...((setting.type === 'number' || setting.type === 'slider') && setting.minimum !== undefined
        ? { settingMinimum: setting.minimum }
        : {}),
      ...((setting.type === 'number' || setting.type === 'slider') && setting.maximum !== undefined
        ? { settingMaximum: setting.maximum }
        : {}),
      ...((setting.type === 'number' || setting.type === 'slider') && setting.step !== undefined
        ? { settingStep: setting.step }
        : {}),
    });
    registered += 1;
  }
  for (const hook of contributes.hooks) {
    registry.register({
      pluginInstanceId: input.pluginInstanceId,
      pluginId: input.pluginId,
      libraryId: input.libraryId,
      localId: hook.id,
      kind: 'hook',
      target: 'hooks',
      title: hook.event,
    });
    registered += 1;
  }
  for (const job of contributes.jobs ?? []) {
    registry.register({
      pluginInstanceId: input.pluginInstanceId,
      pluginId: input.pluginId,
      libraryId: input.libraryId,
      localId: job.id,
      kind: 'job',
      target: 'jobs',
      title: job.title,
    });
    registered += 1;
  }
  for (const provider of contributes.providers) {
    registry.register({
      pluginInstanceId: input.pluginInstanceId,
      pluginId: input.pluginId,
      libraryId: input.libraryId,
      localId: provider.id,
      kind: 'provider',
      target: 'providers',
      title: provider.kind,
    });
    registered += 1;
  }
  return registered;
}

/**
 * This registry intentionally owns only descriptors. Rendering, event routing
 * and lifecycle supervision live in later Plugin Host phases, so a failed or
 * untrusted plugin has no route to inject arbitrary React into the host.
 */
export function createContributionRegistry(): PluginContributionRegistry {
  const contributions = new Map<string, RegisteredPluginContribution>();

  return {
    register(value: PluginContributionRegistration): RegisteredPluginContribution {
      const parsed = pluginContributionRegistrationSchema.parse(value);
      const id = createPluginContributionId(parsed.pluginId, parsed.localId, parsed.libraryId);
      if (contributions.has(id)) {
        throw new Error(`Plugin contribution ${id} is already registered.`);
      }
      const registered = { ...parsed, id };
      contributions.set(id, registered);
      return registered;
    },
    list(): readonly RegisteredPluginContribution[] {
      return [...contributions.values()].sort((left, right) => left.id.localeCompare(right.id));
    },
    revokePluginInstance(pluginInstanceId: string): number {
      let revokedCount = 0;
      for (const [id, contribution] of contributions) {
        if (contribution.pluginInstanceId !== pluginInstanceId) continue;
        contributions.delete(id);
        revokedCount += 1;
      }
      return revokedCount;
    },
  };
}

export type PluginToolbarContribution = {
  id: string;
  pluginId: string;
  pluginInstanceId: string;
  commandId: string;
  title: string;
  when?: string;
  enablement?: string;
  checked?: string;
};

function commandForContribution(
  registry: PluginContributionRegistry,
  contribution: RegisteredPluginContribution,
): RegisteredPluginContribution | undefined {
  if (contribution.commandId === undefined) return undefined;
  return registry.list().find((candidate) => candidate.kind === 'command'
    && candidate.pluginInstanceId === contribution.pluginInstanceId
    && candidate.localId === contribution.commandId);
}

function effectiveCondition(
  registry: PluginContributionRegistry,
  contribution: RegisteredPluginContribution,
  key: 'when' | 'enablement' | 'checked',
): string | undefined {
  return contribution[key] ?? commandForContribution(registry, contribution)?.[key];
}

export function listToolbarContributions(
  registry: PluginContributionRegistry,
): PluginToolbarContribution[] {
  return registry.list()
    .filter((contribution): contribution is RegisteredPluginContribution & {
      commandId: string;
      target: 'toolbar';
    } => contribution.target === 'toolbar' && contribution.commandId !== undefined)
    .map((contribution) => ({
      id: contribution.id,
      pluginId: contribution.pluginId,
      pluginInstanceId: contribution.pluginInstanceId,
      commandId: contribution.commandId,
      title: contribution.title,
      ...(effectiveCondition(registry, contribution, 'when') === undefined
        ? {} : { when: effectiveCondition(registry, contribution, 'when') }),
      ...(effectiveCondition(registry, contribution, 'enablement') === undefined
        ? {} : { enablement: effectiveCondition(registry, contribution, 'enablement') }),
      ...(effectiveCondition(registry, contribution, 'checked') === undefined
        ? {} : { checked: effectiveCondition(registry, contribution, 'checked') }),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export type PluginCommandContribution = {
  id: string;
  pluginId: string;
  pluginInstanceId: string;
  commandId: string;
  title: string;
  when?: string;
  enablement?: string;
  checked?: string;
  mcpExported?: true;
};

export function listCommandContributions(
  registry: PluginContributionRegistry,
): PluginCommandContribution[] {
  return registry.list()
    .filter((contribution) => contribution.target === 'commands' && contribution.kind === 'command')
    .map((contribution) => ({
      id: contribution.id,
      pluginId: contribution.pluginId,
      pluginInstanceId: contribution.pluginInstanceId,
      commandId: contribution.localId,
      title: contribution.title,
      ...(contribution.when === undefined ? {} : { when: contribution.when }),
      ...(contribution.enablement === undefined ? {} : { enablement: contribution.enablement }),
      ...(contribution.checked === undefined ? {} : { checked: contribution.checked }),
      ...(contribution.mcpExported === true ? { mcpExported: true as const } : {}),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function listMcpCommandContributions(
  registry: PluginContributionRegistry,
): Array<PluginCommandContribution & { mcpExported: true }> {
  return registry.list()
    .filter((contribution): contribution is RegisteredPluginContribution & {
      kind: 'command';
      target: 'commands';
      mcpExported: true;
    } => contribution.target === 'commands'
      && contribution.kind === 'command'
      && contribution.mcpExported === true)
    .map((contribution) => ({
      id: contribution.id,
      pluginId: contribution.pluginId,
      pluginInstanceId: contribution.pluginInstanceId,
      commandId: contribution.localId,
      title: contribution.title,
      ...(contribution.when === undefined ? {} : { when: contribution.when }),
      ...(contribution.enablement === undefined ? {} : { enablement: contribution.enablement }),
      ...(contribution.checked === undefined ? {} : { checked: contribution.checked }),
      mcpExported: true as const,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export type PluginInspectorSectionContribution = {
  id: string;
  pluginId: string;
  pluginInstanceId: string;
  commandId: string;
  title: string;
  commandTitle: string;
  when?: string;
  enablement?: string;
  checked?: string;
};

export function listInspectorSectionContributions(
  registry: PluginContributionRegistry,
): PluginInspectorSectionContribution[] {
  return registry.list()
    .filter((contribution): contribution is RegisteredPluginContribution & {
      commandId: string;
      commandTitle: string;
      target: 'inspector.sections';
    } => contribution.target === 'inspector.sections'
      && contribution.commandId !== undefined
      && contribution.commandTitle !== undefined)
    .map((contribution) => ({
      id: contribution.id,
      pluginId: contribution.pluginId,
      pluginInstanceId: contribution.pluginInstanceId,
      commandId: contribution.commandId,
      title: contribution.title,
      commandTitle: contribution.commandTitle,
      ...(effectiveCondition(registry, contribution, 'when') === undefined
        ? {} : { when: effectiveCondition(registry, contribution, 'when') }),
      ...(effectiveCondition(registry, contribution, 'enablement') === undefined
        ? {} : { enablement: effectiveCondition(registry, contribution, 'enablement') }),
      ...(effectiveCondition(registry, contribution, 'checked') === undefined
        ? {} : { checked: effectiveCondition(registry, contribution, 'checked') }),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export type PluginViewerActionContribution = {
  id: string;
  pluginId: string;
  pluginInstanceId: string;
  commandId: string;
  title: string;
  when?: string;
  enablement?: string;
  checked?: string;
};

export function listViewerActionContributions(
  registry: PluginContributionRegistry,
): PluginViewerActionContribution[] {
  return registry.list()
    .filter((contribution): contribution is RegisteredPluginContribution & {
      commandId: string;
      target: 'viewer.actions';
    } => contribution.target === 'viewer.actions' && contribution.commandId !== undefined)
    .map((contribution) => ({
      id: contribution.id,
      pluginId: contribution.pluginId,
      pluginInstanceId: contribution.pluginInstanceId,
      commandId: contribution.commandId,
      title: contribution.title,
      ...(effectiveCondition(registry, contribution, 'when') === undefined
        ? {} : { when: effectiveCondition(registry, contribution, 'when') }),
      ...(effectiveCondition(registry, contribution, 'enablement') === undefined
        ? {} : { enablement: effectiveCondition(registry, contribution, 'enablement') }),
      ...(effectiveCondition(registry, contribution, 'checked') === undefined
        ? {} : { checked: effectiveCondition(registry, contribution, 'checked') }),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export type PluginShortcutContribution = {
  id: string;
  pluginId: string;
  pluginInstanceId: string;
  commandId: string;
  title: string;
  accelerator: string;
  when?: string;
  enablement?: string;
  checked?: string;
};

export function listShortcutContributions(
  registry: PluginContributionRegistry,
): PluginShortcutContribution[] {
  return registry.list()
    .filter((contribution): contribution is RegisteredPluginContribution & {
      commandId: string;
      accelerator: string;
      target: 'shortcuts';
    } => contribution.target === 'shortcuts'
      && contribution.commandId !== undefined
      && contribution.accelerator !== undefined)
    .map((contribution) => ({
      id: contribution.id,
      pluginId: contribution.pluginId,
      pluginInstanceId: contribution.pluginInstanceId,
      commandId: contribution.commandId,
      title: contribution.title,
      accelerator: contribution.accelerator,
      ...(effectiveCondition(registry, contribution, 'when') === undefined
        ? {} : { when: effectiveCondition(registry, contribution, 'when') }),
      ...(effectiveCondition(registry, contribution, 'enablement') === undefined
        ? {} : { enablement: effectiveCondition(registry, contribution, 'enablement') }),
      ...(effectiveCondition(registry, contribution, 'checked') === undefined
        ? {} : { checked: effectiveCondition(registry, contribution, 'checked') }),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function listMenuContributions(
  registry: PluginContributionRegistry,
  target: PluginHostMenuTarget,
): PluginMenuContribution[] {
  return registry.list()
    .filter((contribution): contribution is RegisteredPluginContribution & {
      target: PluginHostMenuTarget;
    } => contribution.target === target && contribution.kind === 'menu')
    .map((contribution) => ({
      id: contribution.id,
      pluginId: contribution.pluginId,
      pluginInstanceId: contribution.pluginInstanceId,
      ...(contribution.commandId === undefined ? {} : { commandId: contribution.commandId }),
      title: contribution.title,
      target: contribution.target,
      ...(contribution.group === undefined ? {} : { group: contribution.group }),
      ...(contribution.parentId === undefined ? {} : { parentId: contribution.parentId }),
      ...(contribution.before === undefined ? {} : { before: contribution.before }),
      ...(contribution.after === undefined ? {} : { after: contribution.after }),
      ...(contribution.first === undefined ? {} : { first: contribution.first }),
      ...(contribution.last === undefined ? {} : { last: contribution.last }),
      ...(effectiveCondition(registry, contribution, 'when') === undefined
        ? {} : { when: effectiveCondition(registry, contribution, 'when') }),
      ...(effectiveCondition(registry, contribution, 'enablement') === undefined
        ? {} : { enablement: effectiveCondition(registry, contribution, 'enablement') }),
      ...(effectiveCondition(registry, contribution, 'checked') === undefined
        ? {} : { checked: effectiveCondition(registry, contribution, 'checked') }),
      ...(contribution.shortcut === undefined ? {} : { shortcut: contribution.shortcut }),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function listAssetMenuContributions(
  registry: PluginContributionRegistry,
): PluginMenuContribution[] {
  return listMenuContributions(registry, 'menus.asset');
}

export type PluginSettingsContribution = {
  id: string;
  pluginId: string;
  pluginInstanceId: string;
  settingId: string;
  title: string;
  type: z.infer<typeof pluginSettingTypeSchema>;
  description?: string;
  options?: Array<{ value: string; label: string }>;
  default?: z.infer<typeof pluginSettingValueSchema>;
  minimum?: number;
  maximum?: number;
  step?: number;
};

export function listSettingsContributions(
  registry: PluginContributionRegistry,
): PluginSettingsContribution[] {
  return registry.list()
    .filter((contribution): contribution is RegisteredPluginContribution & {
      settingType: z.infer<typeof pluginSettingTypeSchema>;
    } => contribution.target === 'settings.sections' && contribution.settingType !== undefined)
    .map((contribution) => ({
      id: contribution.id,
      pluginId: contribution.pluginId,
      pluginInstanceId: contribution.pluginInstanceId,
      settingId: contribution.localId,
      title: contribution.title,
      type: contribution.settingType,
      ...(contribution.settingDescription === undefined
        ? {}
        : { description: contribution.settingDescription }),
      ...(contribution.settingOptions === undefined
        ? {}
        : { options: contribution.settingOptions }),
      ...(contribution.settingDefault === undefined
        ? {}
        : { default: contribution.settingDefault }),
      ...(contribution.settingMinimum === undefined
        ? {}
        : { minimum: contribution.settingMinimum }),
      ...(contribution.settingMaximum === undefined
        ? {}
        : { maximum: contribution.settingMaximum }),
      ...(contribution.settingStep === undefined
        ? {}
        : { step: contribution.settingStep }),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export type PluginViewContribution = {
  id: string;
  pluginId: string;
  pluginInstanceId: string;
  title: string;
  entryPath?: string;
};

/** @deprecated Use {@link PluginViewContribution} */
export type PluginWorkspaceViewContribution = PluginViewContribution;

/** @deprecated Use {@link PluginViewContribution} */
export type PluginSidebarViewContribution = PluginViewContribution;

/** @deprecated Use {@link PluginViewContribution} */
export type PluginInspectorViewContribution = PluginViewContribution;

/** @deprecated Use {@link PluginViewContribution} */
export type PluginViewerOverlayContribution = PluginViewContribution;

/** @deprecated Use {@link PluginViewContribution} */
export type PluginSettingsPageContribution = PluginViewContribution;

type PluginViewContributionTarget =
  | 'workspace.views'
  | 'sidebar.entries'
  | 'inspector.views'
  | 'viewer.overlays'
  | 'settings.pages';

function listViewContributions(
  registry: PluginContributionRegistry,
  target: PluginViewContributionTarget,
): PluginViewContribution[] {
  return registry.list()
    .filter((contribution): contribution is RegisteredPluginContribution & {
      target: typeof target;
    } => contribution.target === target)
    .map((contribution) => ({
      id: contribution.id,
      pluginId: contribution.pluginId,
      pluginInstanceId: contribution.pluginInstanceId,
      title: contribution.title,
      ...(contribution.uiEntryPath === undefined ? {} : { entryPath: contribution.uiEntryPath }),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function listWorkspaceViewContributions(
  registry: PluginContributionRegistry,
): PluginViewContribution[] {
  return listViewContributions(registry, 'workspace.views');
}

export function listSidebarViewContributions(
  registry: PluginContributionRegistry,
): PluginViewContribution[] {
  return listViewContributions(registry, 'sidebar.entries');
}

export function listInspectorViewContributions(
  registry: PluginContributionRegistry,
): PluginViewContribution[] {
  return listViewContributions(registry, 'inspector.views');
}

export function listViewerOverlayContributions(
  registry: PluginContributionRegistry,
): PluginViewContribution[] {
  return listViewContributions(registry, 'viewer.overlays');
}

export function listSettingsPageContributions(
  registry: PluginContributionRegistry,
): PluginViewContribution[] {
  return listViewContributions(registry, 'settings.pages');
}
