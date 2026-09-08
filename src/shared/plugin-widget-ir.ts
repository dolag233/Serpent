import { z } from 'zod';

/**
 * Bounded widget IR for plugin-authored dialogs and pages.
 *
 * The plugin process builds this tree with `serpent.ui` helpers. Renderer maps
 * nodes onto Host primitives (`Field`, `Select`, `Switch`, `Slider`,
 * `TextField`). Closures never cross IPC; only this JSON travels.
 */

export const PLUGIN_WIDGET_MAX_DEPTH = 8;
export const PLUGIN_WIDGET_MAX_NODES = 128;
export const PLUGIN_WIDGET_MAX_CHILDREN = 32;
export const PLUGIN_WIDGET_MAX_LIST_ROWS = 2_000;
export const PLUGIN_WIDGET_MAX_LIST_COLUMNS = 8;

export const pluginWidgetValueSchema = z.union([
  z.string().max(8_192),
  z.number().finite(),
  z.boolean(),
]);
export type PluginWidgetValue = z.infer<typeof pluginWidgetValueSchema>;

export const pluginWidgetOptionSchema = z.strictObject({
  value: z.string().min(1).max(128),
  label: z.string().min(1).max(160),
});
export type PluginWidgetOption = z.infer<typeof pluginWidgetOptionSchema>;

const pluginWidgetListRowSchema = z.array(z.string().max(8_192)).max(PLUGIN_WIDGET_MAX_LIST_COLUMNS);
const pluginWidgetListSchema = z.strictObject({
  type: z.literal('list'),
  columns: z.array(z.string().min(1).max(160)).min(1).max(PLUGIN_WIDGET_MAX_LIST_COLUMNS),
  rows: z.array(pluginWidgetListRowSchema).max(PLUGIN_WIDGET_MAX_LIST_ROWS),
  emptyText: z.string().min(1).max(160).optional(),
}).superRefine((list, context) => {
  list.rows.forEach((row, index) => {
    if (row.length > list.columns.length) {
      context.addIssue({
        code: 'custom',
        path: ['rows', index],
        message: 'List rows cannot contain more cells than the declared columns.',
      });
    }
  });
});
export type PluginWidgetList = z.infer<typeof pluginWidgetListSchema>;

export const pluginWidgetFieldIdSchema = z.string().min(1).max(64)
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/u, 'Widget field ids must be identifiers.');

const pluginWidgetFieldBase = {
  id: pluginWidgetFieldIdSchema,
  label: z.string().min(1).max(160),
  description: z.string().min(1).max(2_000).optional(),
};

export type PluginWidgetNode =
  | { readonly type: 'column'; readonly children: readonly PluginWidgetNode[] }
  | { readonly type: 'row'; readonly children: readonly PluginWidgetNode[] }
  | { readonly type: 'note'; readonly text: string }
  | { readonly type: 'heading'; readonly text: string }
  | { readonly type: 'separator' }
  | PluginWidgetList
  | {
    readonly type: 'text';
    readonly id: string;
    readonly label: string;
    readonly value: string;
    readonly description?: string;
  }
  | {
    readonly type: 'number';
    readonly id: string;
    readonly label: string;
    readonly value: number;
    readonly min?: number;
    readonly max?: number;
    readonly step?: number;
    readonly description?: string;
  }
  | {
    readonly type: 'select';
    readonly id: string;
    readonly label: string;
    readonly value: string;
    readonly options: readonly PluginWidgetOption[];
    readonly description?: string;
  }
  | {
    readonly type: 'switch';
    readonly id: string;
    readonly label: string;
    readonly value: boolean;
    readonly description?: string;
  }
  | {
    readonly type: 'slider';
    readonly id: string;
    readonly label: string;
    readonly value: number;
    readonly min?: number;
    readonly max?: number;
    readonly step?: number;
    readonly description?: string;
  };

export const pluginWidgetNodeSchema: z.ZodType<PluginWidgetNode> = z.lazy(() => z.union([
  z.strictObject({
    type: z.enum(['column', 'row']),
    children: z.array(pluginWidgetNodeSchema).max(PLUGIN_WIDGET_MAX_CHILDREN),
  }),
  z.strictObject({
    type: z.literal('note'),
    text: z.string().min(1).max(2_000),
  }),
  z.strictObject({
    type: z.literal('heading'),
    text: z.string().min(1).max(160),
  }),
  z.strictObject({
    type: z.literal('separator'),
  }),
  pluginWidgetListSchema,
  z.strictObject({
    ...pluginWidgetFieldBase,
    type: z.literal('text'),
    value: z.string().max(8_192),
  }),
  z.strictObject({
    ...pluginWidgetFieldBase,
    type: z.literal('number'),
    value: z.number().finite(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    step: z.number().finite().positive().optional(),
  }),
  z.strictObject({
    ...pluginWidgetFieldBase,
    type: z.literal('select'),
    value: z.string().max(128),
    options: z.array(pluginWidgetOptionSchema).min(1).max(64),
  }),
  z.strictObject({
    ...pluginWidgetFieldBase,
    type: z.literal('switch'),
    value: z.boolean(),
  }),
  z.strictObject({
    ...pluginWidgetFieldBase,
    type: z.literal('slider'),
    value: z.number().finite(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    step: z.number().finite().positive().optional(),
  }),
]));

export const pluginWidgetEventSchema = z.strictObject({
  type: z.literal('change'),
  nodeId: pluginWidgetFieldIdSchema,
  value: pluginWidgetValueSchema,
});
export type PluginWidgetEvent = z.infer<typeof pluginWidgetEventSchema>;

function walkPluginWidgetNodes(
  node: PluginWidgetNode,
  visit: (current: PluginWidgetNode, depth: number) => void,
  depth = 1,
): void {
  visit(node, depth);
  if (node.type === 'column' || node.type === 'row') {
    for (const child of node.children) walkPluginWidgetNodes(child, visit, depth + 1);
  }
}

export function countPluginWidgetNodes(node: PluginWidgetNode): number {
  let count = 0;
  walkPluginWidgetNodes(node, () => {
    count += 1;
  });
  return count;
}

export function pluginWidgetTreeDepth(node: PluginWidgetNode): number {
  let depth = 1;
  walkPluginWidgetNodes(node, (_current, currentDepth) => {
    if (currentDepth > depth) depth = currentDepth;
  });
  return depth;
}

export function collectPluginWidgetFieldIds(node: PluginWidgetNode): string[] {
  const ids: string[] = [];
  walkPluginWidgetNodes(node, (current) => {
    if (current.type === 'text' || current.type === 'number' || current.type === 'select'
      || current.type === 'switch' || current.type === 'slider') {
      ids.push(current.id);
    }
  });
  return ids;
}

export function collectPluginWidgetValues(
  node: PluginWidgetNode,
): Record<string, PluginWidgetValue> {
  const values: Record<string, PluginWidgetValue> = {};
  walkPluginWidgetNodes(node, (current) => {
    if (current.type === 'text' || current.type === 'number' || current.type === 'select'
      || current.type === 'switch' || current.type === 'slider') {
      values[current.id] = current.value;
    }
  });
  return values;
}

export function parsePluginWidgetTree(input: unknown): PluginWidgetNode {
  const tree = pluginWidgetNodeSchema.parse(input);
  const nodeCount = countPluginWidgetNodes(tree);
  if (nodeCount > PLUGIN_WIDGET_MAX_NODES) {
    throw new Error(`Widget trees may contain at most ${PLUGIN_WIDGET_MAX_NODES} nodes.`);
  }
  if (pluginWidgetTreeDepth(tree) > PLUGIN_WIDGET_MAX_DEPTH) {
    throw new Error(`Widget trees may nest at most ${PLUGIN_WIDGET_MAX_DEPTH} levels.`);
  }
  const ids = collectPluginWidgetFieldIds(tree);
  if (new Set(ids).size !== ids.length) {
    throw new Error('Widget field identifiers must be unique within a tree.');
  }
  return tree;
}
