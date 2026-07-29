import { z } from 'zod';

import { pluginIdSchema, pluginLocalIdSchema } from './plugin-manifest';

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
