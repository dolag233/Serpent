import { z } from 'zod';

import { pluginIdSchema, pluginLocalIdSchema, type PluginManifest } from './plugin-manifest';

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
  'providers',
]);
export type PluginContributionTarget = z.infer<typeof pluginContributionTargetSchema>;

const pluginContributionRegistrationSchema = z.strictObject({
  pluginInstanceId: z.string().min(1).max(255),
  pluginId: pluginIdSchema,
  localId: pluginLocalIdSchema,
  kind: pluginContributionKindSchema,
  target: pluginContributionTargetSchema,
  title: z.string().min(1).max(160),
});
export type PluginContributionRegistration = z.infer<typeof pluginContributionRegistrationSchema>;

export interface RegisteredPluginContribution extends PluginContributionRegistration {
  id: string;
}

export function createPluginContributionId(pluginId: string, localId: string): string {
  return `${pluginIdSchema.parse(pluginId)}.${pluginLocalIdSchema.parse(localId)}`;
}

export interface PluginContributionRegistry {
  register(value: PluginContributionRegistration): RegisteredPluginContribution;
  list(): readonly RegisteredPluginContribution[];
  revokePluginInstance(pluginInstanceId: string): number;
}

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
    contributes: PluginManifest['contributes'] | undefined;
  },
): number {
  const contributes = input.contributes ?? {
    commands: [],
    menus: {},
    views: [],
    settings: [],
    hooks: [],
    providers: [],
  };
  let registered = 0;
  for (const command of contributes.commands) {
    registry.register({
      pluginInstanceId: input.pluginInstanceId,
      pluginId: input.pluginId,
      localId: command.id,
      kind: 'command',
      target: 'commands',
      title: command.title,
    });
    registered += 1;
  }
  for (const [menuName, items] of Object.entries(contributes.menus)) {
    const target = MENU_TARGET_BY_NAME[menuName];
    if (target === undefined) continue;
    for (const item of items) {
      registry.register({
        pluginInstanceId: input.pluginInstanceId,
        pluginId: input.pluginId,
        localId: `menu.${menuName}.${item.command}`,
        kind: 'menu',
        target,
        title: item.command,
      });
      registered += 1;
    }
  }
  for (const view of contributes.views) {
    const target = VIEW_TARGET_BY_LOCATION[view.location];
    if (target === undefined) continue;
    registry.register({
      pluginInstanceId: input.pluginInstanceId,
      pluginId: input.pluginId,
      localId: view.id,
      kind: 'view',
      target,
      title: view.title,
    });
    registered += 1;
  }
  for (const setting of contributes.settings) {
    registry.register({
      pluginInstanceId: input.pluginInstanceId,
      pluginId: input.pluginId,
      localId: setting.id,
      kind: 'settings-section',
      target: 'settings.sections',
      title: setting.title,
    });
    registered += 1;
  }
  for (const hook of contributes.hooks) {
    registry.register({
      pluginInstanceId: input.pluginInstanceId,
      pluginId: input.pluginId,
      localId: hook.id,
      kind: 'hook',
      target: 'hooks',
      title: hook.event,
    });
    registered += 1;
  }
  for (const provider of contributes.providers) {
    registry.register({
      pluginInstanceId: input.pluginInstanceId,
      pluginId: input.pluginId,
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
      const id = createPluginContributionId(parsed.pluginId, parsed.localId);
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
