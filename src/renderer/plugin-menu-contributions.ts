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
import {
  formatElectronAcceleratorLabel,
  type CommandPlatform,
} from "../shared/plugin-accelerator";

const pluginMenuPlatform: CommandPlatform = typeof navigator !== "undefined"
  && /Mac/u.test(navigator.userAgent)
  ? "mac"
  : "windows";

export type PluginMenuDescriptor = {
  id: string;
  label: string;
  contributionId: string;
  commandId?: string;
  pluginId: string;
  group?: string;
  before?: string;
  after?: string;
  first?: boolean;
  last?: boolean;
  shortcut?: string;
  disabled: boolean;
  checked?: boolean;
  condition?: {
    when?: PluginContextExpression;
    enablement?: PluginContextExpression;
    checked?: PluginContextExpression;
  };
  children: PluginMenuDescriptor[];
};

type MenuContributionNode = {
  descriptor: PluginMenuDescriptor;
  sourceIndex: number;
  parentId?: string;
};

function compareGroup(
  left: MenuContributionNode,
  right: MenuContributionNode,
): number {
  const leftGroup = left.descriptor.group;
  const rightGroup = right.descriptor.group;
  if (leftGroup === undefined && rightGroup !== undefined) return -1;
  if (leftGroup !== undefined && rightGroup === undefined) return 1;
  if (leftGroup !== undefined && rightGroup !== undefined) {
    const groupOrder = leftGroup.localeCompare(rightGroup);
    if (groupOrder !== 0) return groupOrder;
  }
  return left.sourceIndex - right.sourceIndex;
}

function compareCycleFallback(
  left: MenuContributionNode,
  right: MenuContributionNode,
): number {
  const idOrder = left.descriptor.id.localeCompare(right.descriptor.id);
  return idOrder === 0 ? left.sourceIndex - right.sourceIndex : idOrder;
}

/**
 * Orders one menu level without mutating the contribution input. Explicit
 * before/after edges win over the default group order; groups determine the
 * stable choice whenever no edge makes one item ready first. If an edge cycle
 * remains, choosing the smallest id breaks it deterministically.
 */
function sortMenuLevel(nodes: readonly MenuContributionNode[]): MenuContributionNode[] {
  const byId = new Map(nodes.map((node) => [node.descriptor.id, node]));
  const outgoing = new Map<string, Set<string>>();
  const indegree = new Map<string, number>();
  for (const node of nodes) {
    outgoing.set(node.descriptor.id, new Set());
    indegree.set(node.descriptor.id, 0);
  }

  const addEdge = (from: string, to: string): void => {
    if (from === to || !byId.has(from) || !byId.has(to)) return;
    const edges = outgoing.get(from);
    if (edges === undefined || edges.has(to)) return;
    edges.add(to);
    indegree.set(to, (indegree.get(to) ?? 0) + 1);
  };

  for (const node of nodes) {
    const { id, before, after } = node.descriptor;
    if (before !== undefined) addEdge(id, before);
    if (after !== undefined) addEdge(after, id);
    if (node.descriptor.first === true) {
      for (const other of nodes) addEdge(id, other.descriptor.id);
    }
    if (node.descriptor.last === true) {
      for (const other of nodes) addEdge(other.descriptor.id, id);
    }
  }

  const remaining = new Set(nodes.map((node) => node.descriptor.id));
  const result: MenuContributionNode[] = [];
  const choose = (cycle: boolean): MenuContributionNode | undefined => {
    const candidates = nodes.filter((node) => {
      if (!remaining.has(node.descriptor.id)) return false;
      return cycle || indegree.get(node.descriptor.id) === 0;
    });
    candidates.sort(cycle ? compareCycleFallback : compareGroup);
    return candidates[0];
  };

  while (remaining.size > 0) {
    // A cycle has no zero-indegree node. Break only one edge endpoint at a
    // time, then continue normal topological ordering for the remainder.
    const node = choose(false) ?? choose(true);
    if (node === undefined) break;
    remaining.delete(node.descriptor.id);
    result.push(node);
    for (const target of outgoing.get(node.descriptor.id) ?? []) {
      if (remaining.has(target)) {
        indegree.set(target, Math.max(0, (indegree.get(target) ?? 0) - 1));
      }
    }
  }
  return result;
}

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
    first?: boolean;
    last?: boolean;
    shortcut?: string;
    parentId?: string;
    when?: PluginContextExpression;
    enablement?: PluginContextExpression;
    checked?: PluginContextExpression;
  }[],
  context?: PluginContributionContext,
): PluginMenuDescriptor[] {
  const contributionById = new Map(
    contributions.map((contribution) => [contribution.id, contribution]),
  );
  const visibilityById = new Map<string, boolean>();
  const visiting = new Set<string>();
  const isVisible = (contribution: (typeof contributions)[number]): boolean => {
    const cached = visibilityById.get(contribution.id);
    if (cached !== undefined) return cached;

    const ownVisibility = context === undefined
      || contribution.when === undefined
      || evaluatePluginContextExpression(contribution.when, context);
    if (!ownVisibility) {
      visibilityById.set(contribution.id, false);
      return false;
    }

    const parentId = contribution.parentId;
    const parent = parentId === undefined ? undefined : contributionById.get(parentId);
    if (parentId === undefined || parent === undefined || parent === contribution) {
      visibilityById.set(contribution.id, true);
      return true;
    }

    // A placement cycle is handled by the existing tree builder. Do not let
    // the visibility walk recurse forever while preserving its old behavior.
    if (visiting.has(contribution.id)) return true;
    visiting.add(contribution.id);
    const visible = isVisible(parent);
    visiting.delete(contribution.id);
    visibilityById.set(contribution.id, visible);
    return visible;
  };
  const visibleContributions = contributions.filter(isVisible);
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
      ...(contribution.first === undefined ? {} : { first: contribution.first }),
      ...(contribution.last === undefined ? {} : { last: contribution.last }),
      ...(contribution.shortcut === undefined
        ? {}
        : { shortcut: formatElectronAcceleratorLabel(contribution.shortcut, pluginMenuPlatform) }),
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
  const nodes: MenuContributionNode[] = descriptors.map((descriptor, sourceIndex) => ({
    descriptor,
    sourceIndex,
    parentId: visibleContributions[sourceIndex]?.parentId,
  }));
  const byId = new Map(nodes.map((node) => [node.descriptor.id, node]));
  const childrenByParent = new Map<string, MenuContributionNode[]>();
  const roots: MenuContributionNode[] = [];
  for (const node of nodes) {
    const parentId = node.parentId;
    const parent = parentId === undefined ? undefined : byId.get(parentId);
    if (parent === undefined || parent === node) {
      roots.push(node);
    } else {
      const siblings = childrenByParent.get(parent.descriptor.id) ?? [];
      siblings.push(node);
      childrenByParent.set(parent.descriptor.id, siblings);
    }
  }

  const materialize = (node: MenuContributionNode): PluginMenuDescriptor => {
    const children = childrenByParent.get(node.descriptor.id) ?? [];
    node.descriptor.children.push(
      ...sortMenuLevel(children).map((child) => materialize(child)),
    );
    return node.descriptor;
  };
  return sortMenuLevel(roots).map((root) => materialize(root));
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
