import { useEffect, useState } from "react";

import type {
  PluginHostMenuTarget,
  SerpentPluginManagerApi,
} from "../shared/plugin-manager-api";
import {
  evaluatePluginContextExpression,
  type PluginContributionContext,
} from "../plugins/plugin-context";
import type { PluginContextExpression } from "../plugins/plugin-manifest";

export type PluginMenuDescriptor = {
  id: string;
  label: string;
  contributionId: string;
  commandId?: string;
  pluginId: string;
  group?: string;
  before?: string;
  after?: string;
  disabled: boolean;
  checked?: boolean;
  condition?: {
    when?: PluginContextExpression;
    enablement?: PluginContextExpression;
    checked?: PluginContextExpression;
  };
  children: PluginMenuDescriptor[];
};

export function buildPluginMenuDescriptors(
  contributions: readonly {
    kind: 'menu';
    id: string;
    title: string;
    commandId?: string;
    pluginId: string;
    group?: string;
    before?: string;
    after?: string;
    parentId?: string;
    when?: PluginContextExpression;
    enablement?: PluginContextExpression;
    checked?: PluginContextExpression;
  }[],
  context?: PluginContributionContext,
): PluginMenuDescriptor[] {
  const visibleContributions = contributions.filter((contribution) =>
    context === undefined
      || contribution.when === undefined
      || evaluatePluginContextExpression(contribution.when, context));
  const descriptors: PluginMenuDescriptor[] = visibleContributions.map((contribution) => {
    const condition = contribution.when === undefined
      && contribution.enablement === undefined
      && contribution.checked === undefined
      ? undefined
      : {
          ...(contribution.when === undefined ? {} : { when: contribution.when }),
          ...(contribution.enablement === undefined ? {} : { enablement: contribution.enablement }),
          ...(contribution.checked === undefined ? {} : { checked: contribution.checked }),
        };
    return {
      id: contribution.id,
      label: contribution.title,
      contributionId: contribution.id,
      ...(contribution.commandId === undefined ? {} : { commandId: contribution.commandId }),
      pluginId: contribution.pluginId,
      ...(contribution.group === undefined ? {} : { group: contribution.group }),
      ...(contribution.before === undefined ? {} : { before: contribution.before }),
      ...(contribution.after === undefined ? {} : { after: contribution.after }),
      disabled: context !== undefined
        && contribution.enablement !== undefined
        && !evaluatePluginContextExpression(contribution.enablement, context),
      ...(context !== undefined && contribution.checked !== undefined
        ? { checked: evaluatePluginContextExpression(contribution.checked, context) }
        : {}),
      ...(condition === undefined ? {} : { condition }),
      children: [] as PluginMenuDescriptor[],
    };
  });
  const byId = new Map(descriptors.map((descriptor) => [descriptor.id, descriptor]));
  const roots: PluginMenuDescriptor[] = [];
  for (const [index, descriptor] of descriptors.entries()) {
    const contribution = visibleContributions[index];
    const parentId = contribution?.parentId;
    const parent = parentId === undefined ? undefined : byId.get(parentId);
    if (parent === undefined) {
      roots.push(descriptor);
    } else {
      parent.children.push(descriptor);
    }
  }
  const sort = (items: PluginMenuDescriptor[]): void => {
    items.sort((left, right) => left.id.localeCompare(right.id));
    for (const item of items) sort(item.children);
  };
  sort(roots);
  return roots;
}

/** @deprecated Use {@link buildPluginMenuDescriptors} */
export const buildPluginAssetMenuDescriptors = buildPluginMenuDescriptors;

export function usePluginMenuContributions(
  pluginApi: SerpentPluginManagerApi | undefined,
  libraryId: string | undefined,
  target: PluginHostMenuTarget,
  enabled: boolean,
  refreshKey: string | null,
  context?: PluginContributionContext,
): PluginMenuDescriptor[] {
  const [items, setItems] = useState<PluginMenuDescriptor[]>([]);

  useEffect(() => {
    if (!enabled || pluginApi === undefined || libraryId === undefined) {
      queueMicrotask(() => setItems([]));
      return;
    }
    let cancelled = false;
    void pluginApi.listPluginContributions({
      libraryId,
      target,
    }).then((result) => {
      if (cancelled) return;
      if (!("contributions" in result)) {
        setItems([]);
        return;
      }
      const menuContributions = result.contributions.filter(
        (contribution): contribution is Extract<typeof contribution, { kind: 'menu' }> => contribution.kind === 'menu',
      );
      setItems(buildPluginMenuDescriptors(menuContributions, context));
    }).catch((error: unknown) => {
      if (!cancelled) {
        setItems([]);
        console.warn("plugin-menu-contributions-unavailable", target, error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [context, enabled, libraryId, pluginApi, refreshKey, target]);

  return items;
}

export async function runPluginMenuCommand(
  pluginApi: SerpentPluginManagerApi,
  libraryId: string,
  item: Pick<PluginMenuDescriptor, 'contributionId' | 'id'>,
  context: {
    assetIds?: string[];
    folderIds?: string[];
    collectionIds?: string[];
  },
): Promise<void> {
  const result = await pluginApi.runPluginCommand({
    type: "plugin-manager.run-command",
    libraryId,
    contributionId: item.contributionId,
    ...(context.assetIds === undefined ? {} : { assetIds: context.assetIds }),
    ...(context.folderIds === undefined ? {} : { folderIds: context.folderIds }),
    ...(context.collectionIds === undefined ? {} : { collectionIds: context.collectionIds }),
  });
  if (!result.ok) {
    console.warn("plugin-command-failed", item.id, result.code);
  }
}
