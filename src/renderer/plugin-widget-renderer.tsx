import { useState, type ReactNode } from 'react';

import {
  collectPluginWidgetValues,
  type PluginWidgetNode,
  type PluginWidgetValue,
} from '../shared/plugin-widget-ir';
import { PluginWidgetSelect } from './plugin-widget-select';
import {
  Slider,
  Switch,
  TextField,
} from './ui/primitives';

function fieldValue(
  node: Extract<PluginWidgetNode, { id: string; value: PluginWidgetValue }>,
  values: Map<string, PluginWidgetValue>,
): PluginWidgetValue {
  return values.get(node.id) ?? node.value;
}

function seedValues(tree: PluginWidgetNode): Map<string, PluginWidgetValue> {
  return new Map(Object.entries(collectPluginWidgetValues(tree)));
}

function mergeTreeValues(
  current: Map<string, PluginWidgetValue>,
  tree: PluginWidgetNode,
): Map<string, PluginWidgetValue> {
  const next = new Map(current);
  for (const [id, value] of Object.entries(collectPluginWidgetValues(tree))) {
    if (!next.has(id)) next.set(id, value);
  }
  return next;
}

function widgetChildKey(child: PluginWidgetNode, index: number): string {
  if ('id' in child && typeof child.id === 'string') return child.id;
  return `${child.type}-${index}`;
}

export function PluginWidgetRenderer({
  tree,
  values,
  onChange,
}: {
  readonly tree: PluginWidgetNode;
  readonly values: Map<string, PluginWidgetValue>;
  readonly onChange: (nodeId: string, value: PluginWidgetValue) => void;
}): ReactNode {
  if (tree.type === 'column') {
    return (
      <div className="plugin-widget-form">
        {tree.children.map((child, index) => (
          <PluginWidgetRenderer
            key={widgetChildKey(child, index)}
            onChange={onChange}
            tree={child}
            values={values}
          />
        ))}
      </div>
    );
  }
  if (tree.type === 'row') {
    return (
      <div className="plugin-widget-row">
        {tree.children.map((child, index) => (
          <PluginWidgetRenderer
            key={widgetChildKey(child, index)}
            onChange={onChange}
            tree={child}
            values={values}
          />
        ))}
      </div>
    );
  }
  if (tree.type === 'note') {
    return <p className="plugin-widget-note">{tree.text}</p>;
  }
  if (tree.type === 'heading') {
    return <h3 className="plugin-widget-heading">{tree.text}</h3>;
  }
  if (tree.type === 'separator') {
    return <hr className="plugin-widget-separator" />;
  }
  if (tree.type === 'text') {
    const value = String(fieldValue(tree, values));
    return (
      <TextField
        description={tree.description}
        id={tree.id}
        label={tree.label}
        onChange={(event) => onChange(tree.id, event.target.value)}
        value={value}
      />
    );
  }
  if (tree.type === 'number') {
    const value = Number(fieldValue(tree, values));
    return (
      <TextField
        description={tree.description}
        id={tree.id}
        label={tree.label}
        max={tree.max}
        min={tree.min}
        onChange={(event) => onChange(tree.id, Number(event.target.value))}
        step={tree.step}
        type="number"
        value={Number.isFinite(value) ? value : 0}
      />
    );
  }
  if (tree.type === 'select') {
    const value = String(fieldValue(tree, values));
    return (
      <PluginWidgetSelect
        description={tree.description}
        id={tree.id}
        label={tree.label}
        onValueChange={(next) => onChange(tree.id, next)}
        options={tree.options.map((option) => ({ value: option.value, label: option.label }))}
        value={value}
      />
    );
  }
  if (tree.type === 'switch') {
    const value = fieldValue(tree, values) === true;
    return (
      <Switch
        checked={value}
        description={tree.description}
        id={tree.id}
        label={tree.label}
        onCheckedChange={(checked) => onChange(tree.id, checked)}
      />
    );
  }
  const value = Number(fieldValue(tree, values));
  return (
    <Slider
      description={tree.description}
      id={tree.id}
      label={tree.label}
      max={tree.max}
      min={tree.min}
      onValueChange={(next) => onChange(tree.id, next)}
      showValue
      step={tree.step}
      value={Number.isFinite(value) ? value : 0}
    />
  );
}

export function usePluginWidgetForm(tree: PluginWidgetNode): {
  values: Map<string, PluginWidgetValue>;
  snapshot(): Record<string, PluginWidgetValue>;
  change(nodeId: string, value: PluginWidgetValue): void;
} {
  const [values, setValues] = useState(() => seedValues(tree));
  const [seenTree, setSeenTree] = useState(tree);
  if (tree !== seenTree) {
    setSeenTree(tree);
    setValues((current) => mergeTreeValues(current, tree));
  }
  return {
    values,
    snapshot() {
      return Object.fromEntries(values);
    },
    change(nodeId, value) {
      setValues((current) => {
        const next = new Map(current);
        next.set(nodeId, value);
        return next;
      });
    },
  };
}
