import type { HTMLAttributes, ReactNode } from "react";

export type MenuNodeKind = "item" | "submenu" | "separator";

/**
 * These booleans are already-evaluated results. A MenuSurface must receive a
 * snapshot, not callbacks or live Context access, so opening a menu cannot
 * change its topology halfway through rendering.
 */
export interface MenuNodeState {
  readonly when?: boolean;
  readonly enablement?: boolean;
  readonly checked?: boolean;
  /** Explicit hiding is useful when a caller combines several predicates. */
  readonly hidden?: boolean;
}

export interface MenuNodeBase extends MenuNodeState {
  readonly id: string;
  readonly label: string;
  readonly kind: MenuNodeKind;
}

export interface MenuItemNode extends MenuNodeBase {
  readonly kind: "item";
  readonly command: string;
}

export interface MenuSubmenuNode extends MenuNodeBase {
  readonly kind: "submenu";
  readonly children: readonly MenuNode[];
}

export interface MenuSeparatorNode extends Omit<MenuNodeBase, "label"> {
  readonly kind: "separator";
  readonly label?: string;
}

export type MenuNode = MenuItemNode | MenuSubmenuNode | MenuSeparatorNode;

export interface ResolvedMenuNodeBase {
  readonly id: string;
  readonly label: string;
  readonly kind: MenuNodeKind;
  readonly enabled: boolean;
  readonly checked?: boolean;
}

export interface ResolvedMenuItemNode extends ResolvedMenuNodeBase {
  readonly kind: "item";
  readonly command: string;
}

export interface ResolvedMenuSubmenuNode extends ResolvedMenuNodeBase {
  readonly kind: "submenu";
  readonly children: readonly ResolvedMenuNode[];
}

export interface ResolvedMenuSeparatorNode
  extends Omit<ResolvedMenuNodeBase, "label"> {
  readonly kind: "separator";
  readonly label?: string;
}

export type ResolvedMenuNode =
  | ResolvedMenuItemNode
  | ResolvedMenuSubmenuNode
  | ResolvedMenuSeparatorNode;

function freeze<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

/**
 * Resolves one immutable menu snapshot.
 *
 * Hidden parents hide their entire subtree. A submenu with no visible
 * descendants is omitted, preventing empty submenu shells from leaking into
 * the host menu. The returned nodes and children are frozen so `when`,
 * `enablement`, and `checked` cannot drift after the menu was opened.
 */
export function resolveMenuNodes(
  nodes: readonly MenuNode[],
): readonly ResolvedMenuNode[] {
  const resolved: ResolvedMenuNode[] = [];

  for (const node of nodes) {
    if (node.hidden === true || node.when === false) {
      continue;
    }

    const enabled = node.enablement !== false;
    const checked = node.checked === undefined ? undefined : node.checked;

    if (node.kind === "submenu") {
      const children = resolveMenuNodes(node.children);
      if (children.length === 0) {
        continue;
      }

      resolved.push(
        freeze({
          id: node.id,
          label: node.label,
          kind: node.kind,
          enabled,
          ...(checked === undefined ? {} : { checked }),
          children: freeze([...children]),
        }),
      );
      continue;
    }

    if (node.kind === "item") {
      resolved.push(
        freeze({
          id: node.id,
          label: node.label,
          kind: "item" as const,
          enabled,
          ...(checked === undefined ? {} : { checked }),
          command: node.command,
        }),
      );
    } else {
      resolved.push(
        freeze({
          id: node.id,
          ...(node.label === undefined ? {} : { label: node.label }),
          kind: "separator" as const,
          enabled,
          ...(checked === undefined ? {} : { checked }),
        }),
      );
    }
  }

  return freeze(resolved);
}

/** Alias for callers that name the operation as a tree resolution. */
export const resolveMenuTree = resolveMenuNodes;

export interface MenuSurfaceProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "children" | "role"> {
  /** A resolved, immutable snapshot returned by resolveMenuNodes. */
  readonly nodes: readonly ResolvedMenuNode[];
  /** The host owns row rendering, portals, keyboard navigation, and selection. */
  readonly renderNode: (node: ResolvedMenuNode, depth: number) => ReactNode;
}

/**
 * Semantic menu surface. It intentionally does not own portals, pointer
 * positioning, keyboard roving, or submenu open state; those remain in the
 * existing host menu controller and can consume the same resolved snapshot.
 */
export function MenuSurface({
  nodes,
  renderNode,
  className,
  ...rest
}: MenuSurfaceProps) {
  if (nodes.length === 0) {
    return null;
  }

  return (
    <div
      {...rest}
      className={className ? `ui-menu-surface ${className}` : "ui-menu-surface"}
      data-ui-pattern="menu-surface"
      role="menu"
    >
      {nodes.map((node) => renderNode(node, 0))}
    </div>
  );
}
