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

export type PluginContributionConditions = {
  when?: PluginContextExpression;
  enablement?: PluginContextExpression;
  checked?: PluginContextExpression;
};

export function resolvePluginContributionConditions(
  contribution: PluginContributionConditions,
  context?: PluginContributionContext,
): { visible: boolean; disabled: boolean; checked?: boolean } {
  if (context === undefined) return { visible: true, disabled: false };
  const visible = contribution.when === undefined
    || evaluatePluginContextExpression(contribution.when, context);
  const disabled = contribution.enablement !== undefined
    && !evaluatePluginContextExpression(contribution.enablement, context);
  return {
    visible,
    disabled,
    ...(contribution.checked === undefined
      ? {}
      : { checked: evaluatePluginContextExpression(contribution.checked, context) }),
  };
}

export type MenuContributionNode = {
  descriptor: PluginMenuDescriptor;
  sourceIndex: number;
  parentId?: string;
  pluginId: string;
  pluginInstanceId?: string;
};

export type PluginMenuPlacementDiagnostic = {
  code: "missing-anchor" | "cycle-broken" | "orphan-parent" | "max-depth";
  itemId: string;
  anchorId?: string;
};

export type PluginMenuPlacementResult = {
  nodes: MenuContributionNode[];
  diagnostics: PluginMenuPlacementDiagnostic[];
};

export type BuildPluginMenuDescriptorsOptions = {
  onPlacementDiagnostic?: (diagnostic: PluginMenuPlacementDiagnostic) => void;
};

/** Host command ids that may be used as placement anchors by a plugin. */
const KNOWN_HOST_MENU_ANCHORS = new Set([
  "asset.view",
  "asset.open-with",
  "host.asset.open-with",
  "asset.open-external",
  "asset.reveal-in-folder",
  "folder.open-in-file-manager",
  "asset.remove-from-current-collection",
  "asset.relink",
  "asset.move-to-folder",
  "asset.copy",
  "asset.paste",
  "asset.copy-file-path",
  "asset.rename",
  "folder.create-subfolder",
  "folder.rename",
  "folder.linked-rules",
  "folder.copy",
  "folder.paste",
  "folder.clone",
  "folder.copy-path",
  "asset.ai-analyze",
  "asset.clear-ai-content",
  "asset.move-to-trash",
  "asset.delete-from-disk",
  "asset.delete-linked",
  "asset.delete-permanent",
  "folder.move-to-trash",
  "folder.delete-from-disk",
  "folder.remove-from-library",
]);

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
  return (
    left.pluginId.localeCompare(right.pluginId) ||
    (left.pluginInstanceId ?? "").localeCompare(
      right.pluginInstanceId ?? "",
    ) ||
    left.descriptor.id.localeCompare(right.descriptor.id) ||
    left.sourceIndex - right.sourceIndex
  );
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
 * remains, the weakest conflicting edge is removed and reported so the rest
 * of the menu can still be resolved.
 */
function sortMenuLevel(
  nodes: readonly MenuContributionNode[],
  onDiagnostic?: (diagnostic: PluginMenuPlacementDiagnostic) => void,
): MenuContributionNode[] {
  const byId = new Map(nodes.map((node) => [node.descriptor.id, node]));
  const report = (diagnostic: PluginMenuPlacementDiagnostic): void => {
    onDiagnostic?.(diagnostic);
  };
  type PlacementEdge = {
    from: string;
    to: string;
    kind: "anchor" | "first" | "last";
  };
  const edges: PlacementEdge[] = [];
  const outgoing = new Map<string, Set<string>>();
  const indegree = new Map<string, number>();
  for (const node of nodes) {
    outgoing.set(node.descriptor.id, new Set());
    indegree.set(node.descriptor.id, 0);
  }

  const addEdge = (
    from: string,
    to: string,
    kind: PlacementEdge["kind"],
  ): void => {
    if (from === to || !byId.has(from) || !byId.has(to)) return;
    const outgoingTargets = outgoing.get(from);
    if (outgoingTargets === undefined || outgoingTargets.has(to)) return;
    outgoingTargets.add(to);
    indegree.set(to, (indegree.get(to) ?? 0) + 1);
    edges.push({ from, to, kind });
  };

  for (const node of nodes) {
    const { id, before, after } = node.descriptor;
    if (before !== undefined) {
      if (byId.has(before)) addEdge(id, before, "anchor");
      else if (!KNOWN_HOST_MENU_ANCHORS.has(before)) {
        report({ code: "missing-anchor", itemId: id, anchorId: before });
      }
    }
    if (after !== undefined) {
      if (byId.has(after)) addEdge(after, id, "anchor");
      else if (!KNOWN_HOST_MENU_ANCHORS.has(after)) {
        report({ code: "missing-anchor", itemId: id, anchorId: after });
      }
    }
    if (node.descriptor.first === true) {
      for (const other of nodes) addEdge(id, other.descriptor.id, "first");
    }
    if (node.descriptor.last === true) {
      for (const other of nodes) addEdge(other.descriptor.id, id, "last");
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
    let node = choose(false);
    if (node === undefined) {
      // A cycle has no zero-indegree node. Remove one weakest explicit edge,
      // report it, then continue normal topological ordering. This rejects
      // only the conflicting placement relation instead of dropping a menu
      // branch or making the entire surface disappear.
      const cycleEdge = edges
        .filter((edge) => remaining.has(edge.from) && remaining.has(edge.to))
        .sort((left, right) =>
          (left.kind === "anchor" ? 1 : 0) - (right.kind === "anchor" ? 1 : 0) ||
          left.from.localeCompare(right.from) ||
          left.to.localeCompare(right.to),
        )[0];
      if (cycleEdge === undefined) break;
      const cycleEdgeIndex = edges.indexOf(cycleEdge);
      if (cycleEdgeIndex >= 0) edges.splice(cycleEdgeIndex, 1);
      outgoing.get(cycleEdge.from)?.delete(cycleEdge.to);
      indegree.set(
        cycleEdge.to,
        Math.max(0, (indegree.get(cycleEdge.to) ?? 0) - 1),
      );
      report({
        code: "cycle-broken",
        itemId: cycleEdge.from,
        anchorId: cycleEdge.to,
      });
      node = choose(false) ?? choose(true);
    }
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

/**
 * Solves one sibling level. Kept as a named export so non-React contract tests
 * and future toolbar/Inspector/Viewer surfaces can share the exact ordering
 * semantics instead of reimplementing menu placement.
 */
export function solvePluginMenuPlacement(
  nodes: readonly MenuContributionNode[],
): PluginMenuPlacementResult {
  const diagnostics: PluginMenuPlacementDiagnostic[] = [];
  return {
    nodes: sortMenuLevel(nodes, (diagnostic) => diagnostics.push(diagnostic)),
    diagnostics,
  };
}

export function buildPluginMenuDescriptors(
  contributions: readonly {
    kind: 'menu';
    id: string;
    title: string;
    commandId?: string;
    pluginId: string;
    pluginInstanceId?: string;
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
  options?: BuildPluginMenuDescriptorsOptions,
): PluginMenuDescriptor[] {
  const contributionById = new Map(
    contributions.map((contribution) => [contribution.id, contribution]),
  );
  const visibilityById = new Map<string, boolean>();
  const visiting = new Set<string>();
  const isVisible = (contribution: (typeof contributions)[number]): boolean => {
    const cached = visibilityById.get(contribution.id);
    if (cached !== undefined) return cached;

    const ownVisibility = resolvePluginContributionConditions(contribution, context).visible;
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
  for (const contribution of visibleContributions) {
    if (
      contribution.parentId !== undefined &&
      !contributionById.has(contribution.parentId)
    ) {
      options?.onPlacementDiagnostic?.({
        code: "orphan-parent",
        itemId: contribution.id,
        anchorId: contribution.parentId,
      });
    }
  }
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
      disabled: resolvePluginContributionConditions(contribution, context).disabled,
      ...(resolvePluginContributionConditions(contribution, context).checked === undefined
        ? {}
        : { checked: resolvePluginContributionConditions(contribution, context).checked }),
      ...(condition === undefined ? {} : { condition }),
      children: [] as PluginMenuDescriptor[],
    };
  });
  const nodes: MenuContributionNode[] = descriptors.map((descriptor, sourceIndex) => {
    const contribution = visibleContributions[sourceIndex];
    return {
      descriptor,
      sourceIndex,
      parentId: contribution?.parentId,
      pluginId: contribution?.pluginId ?? descriptor.pluginId,
      ...(contribution?.pluginInstanceId === undefined
        ? {}
        : { pluginInstanceId: contribution.pluginInstanceId }),
    };
  });
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

  const materialize = (
    node: MenuContributionNode,
    depth = 1,
  ): PluginMenuDescriptor => {
    const children = childrenByParent.get(node.descriptor.id) ?? [];
    if (depth >= 3) {
      for (const child of children) {
        options?.onPlacementDiagnostic?.({
          code: "max-depth",
          itemId: child.descriptor.id,
        });
      }
      return node.descriptor;
    }
    node.descriptor.children.push(
      ...sortMenuLevel(children, options?.onPlacementDiagnostic).map((child) =>
        materialize(child, depth + 1),
      ),
    );
    return node.descriptor;
  };
  return sortMenuLevel(roots, options?.onPlacementDiagnostic).map((root) => materialize(root));
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
      setItems(buildPluginMenuDescriptors(menuContributions, context, {
        onPlacementDiagnostic: (diagnostic) => {
          console.warn("plugin-menu-placement-diagnostic", {
            target,
            ...diagnostic,
          });
        },
      }));
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
