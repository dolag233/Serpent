import { useLayoutEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';

import {
  collectPluginWidgetValues,
  type PluginWidgetListCell,
  type PluginWidgetNode,
  type PluginWidgetValue,
} from '../shared/plugin-widget-ir';
import { PluginWidgetSelect } from './plugin-widget-select';
import {
  Slider,
  Switch,
  TextField,
} from './ui/primitives';
import { SettingsCard } from './ui/patterns';

function listCellText(value: PluginWidgetListCell): string {
  return typeof value === 'string'
    ? value
    : value.segments.map((segment) => segment.text).join('');
}

function renderListCell(value: PluginWidgetListCell): ReactNode {
  if (typeof value === 'string') return value;
  return value.segments.map((segment, index) => (
    <span
      className={segment.tone === undefined ? undefined : `plugin-widget-list__highlight plugin-widget-list__highlight--${segment.tone}`}
      key={`segment-${index}`}
    >
      {segment.text}
    </span>
  ));
}

function fieldValue(
  node: Extract<PluginWidgetNode, { id: string; value: PluginWidgetValue }>,
  values: Map<string, PluginWidgetValue>,
): PluginWidgetValue {
  return values.get(node.id) ?? node.value;
}

function widgetChildKey(child: PluginWidgetNode, index: number): string {
  if ('id' in child && typeof child.id === 'string') return child.id;
  return `${child.type}-${index}`;
}

function collectPendingInputIds(tree: PluginWidgetNode): Set<string> {
  const ids = new Set<string>();
  const visit = (node: PluginWidgetNode) => {
    if (node.type === 'text' || node.type === 'number') {
      ids.add(node.id);
      return;
    }
    if (node.type === 'column' || node.type === 'row' || node.type === 'group') {
      node.children.forEach(visit);
      return;
    }
    if (node.type === 'tabs') {
      node.tabs.forEach((tab) => tab.children.forEach(visit));
    }
  };
  visit(tree);
  return ids;
}

function PluginWidgetTextField({
  description,
  disabled,
  id,
  label,
  onChange,
  value,
}: {
  readonly description?: string;
  readonly disabled?: boolean;
  readonly id: string;
  readonly label: string;
  readonly onChange: (value: string) => void;
  readonly value: string;
}): ReactNode {
  return (
    <TextField
      description={description}
      disabled={disabled}
      id={id}
      label={label}
      onChange={(event) => onChange(event.target.value)}
      value={value}
    />
  );
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
  if (tree.type === 'list') {
    const columnCount = tree.columns.length;
    const gridStyle = {
      ['--plugin-widget-list-columns' as string]: String(columnCount),
    };
    return (
      <div className="plugin-widget-list" role="table">
        <div className="plugin-widget-list__header" role="row" style={gridStyle}>
          {tree.columns.map((column, columnIndex) => (
            <div className="plugin-widget-list__cell" key={`column-${columnIndex}`} role="columnheader">
              {column}
            </div>
          ))}
        </div>
        {tree.rows.length === 0 ? (
          <div className="plugin-widget-list__empty" role="row">
            {tree.emptyText ?? '暂无项目'}
          </div>
        ) : (
          <div className="plugin-widget-list__body" role="rowgroup">
            {tree.rows.map((row, rowIndex) => (
              <div className="plugin-widget-list__row" key={`row-${rowIndex}`} role="row" style={gridStyle}>
                {tree.columns.map((_, columnIndex) => {
                  const value = row[columnIndex] ?? '';
                  return (
                    <div className="plugin-widget-list__cell" key={`cell-${columnIndex}`} role="cell" title={listCellText(value)}>
                      {renderListCell(value)}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }
  if (tree.type === 'group') {
    return (
      <SettingsCard className="plugin-widget-group" title={tree.title}>
        <div className="plugin-widget-group__content">
          {tree.children.map((child, index) => (
            <PluginWidgetRenderer
              key={widgetChildKey(child, index)}
              onChange={onChange}
              tree={child}
              values={values}
            />
          ))}
        </div>
      </SettingsCard>
    );
  }
  if (tree.type === 'tabs') {
    const selected = String(fieldValue(tree, values));
    const activeTab = tree.tabs.find((tab) => tab.id === selected) ?? tree.tabs[0]!;
    return (
      <div className="plugin-widget-tabs">
        <div aria-orientation="horizontal" className="plugin-widget-tabs__list" role="tablist">
          {tree.tabs.map((tab) => {
            const isSelected = tab.id === activeTab.id;
            return (
              <button
                aria-controls={`plugin-widget-panel-${tree.id}`}
                aria-selected={isSelected}
                className={`plugin-widget-tabs__tab${isSelected ? ' is-active' : ''}`}
                id={`plugin-widget-tab-${tree.id}-${tab.id}`}
                key={tab.id}
                role="tab"
                tabIndex={isSelected ? 0 : -1}
                type="button"
                onClick={() => onChange(tree.id, tab.id)}
                onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
                  const currentIndex = tree.tabs.findIndex((candidate) => candidate.id === tab.id);
                  let nextIndex: number | null = null;
                  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                    nextIndex = (currentIndex + 1) % tree.tabs.length;
                  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                    nextIndex = (currentIndex - 1 + tree.tabs.length) % tree.tabs.length;
                  } else if (event.key === 'Home') {
                    nextIndex = 0;
                  } else if (event.key === 'End') {
                    nextIndex = tree.tabs.length - 1;
                  }
                  if (nextIndex === null || nextIndex === currentIndex) return;
                  event.preventDefault();
                  const nextTab = tree.tabs[nextIndex];
                  if (nextTab === undefined) return;
                  document.getElementById(`plugin-widget-tab-${tree.id}-${nextTab.id}`)?.focus();
                  onChange(tree.id, nextTab.id);
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
        <div
          aria-labelledby={`plugin-widget-tab-${tree.id}-${activeTab.id}`}
          className="plugin-widget-tabs__panel"
          id={`plugin-widget-panel-${tree.id}`}
          role="tabpanel"
        >
          {activeTab.children.map((child, index) => (
            <PluginWidgetRenderer
              key={widgetChildKey(child, index)}
              onChange={onChange}
              tree={child}
              values={values}
            />
          ))}
        </div>
      </div>
    );
  }
  if (tree.type === 'text') {
    const value = String(fieldValue(tree, values));
    return (
      <PluginWidgetTextField
        description={tree.description}
        disabled={tree.disabled}
        id={tree.id}
        label={tree.label}
        onChange={(next) => onChange(tree.id, next)}
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
        disabled={tree.disabled}
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
        disabled={tree.disabled}
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
      <label className="app-settings-toggle-row plugin-widget-switch-row">
        <span className="app-settings-row-copy">
          <strong>{tree.label}</strong>
          {tree.description === undefined ? null : <span>{tree.description}</span>}
        </span>
        <Switch
          aria-label={tree.label}
          checked={value}
          disabled={tree.disabled}
          id={tree.id}
          onCheckedChange={(checked) => onChange(tree.id, checked)}
        />
      </label>
    );
  }
  if (tree.type === 'toggle') {
    const value = fieldValue(tree, values) === true;
    return (
      <button
        aria-pressed={value}
        className="plugin-widget-toggle"
        data-hover-tip={tree.description}
        disabled={tree.disabled}
        id={tree.id}
        type="button"
        onClick={() => onChange(tree.id, !value)}
      >
        {tree.label}
      </button>
    );
  }
  const value = Number(fieldValue(tree, values));
  return (
    <Slider
      description={tree.description}
      disabled={tree.disabled}
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
  // Widget patches are complete plugin snapshots, but the round trip is
  // asynchronous. Text and number controls need a short-lived local pending
  // value so fast typing does not flicker back to an older snapshot. Other
  // controls are always rendered from the latest tree, which keeps coupled
  // toggles (for example, case-sensitive and regex) mutually exclusive while
  // a patch is in flight.
  const [overrides, setOverrides] = useState<Map<string, PluginWidgetValue>>(
    () => new Map(),
  );
  const pendingInputIds = useMemo(() => collectPendingInputIds(tree), [tree]);
  const treeValues = useMemo(() => new Map(Object.entries(collectPluginWidgetValues(tree))), [tree]);
  useLayoutEffect(() => {
    // A matching value acknowledges the text edit in the full-snapshot
    // protocol. Remove it before paint so later patches cannot be masked.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reconcile an acknowledged IPC snapshot before it is painted
    setOverrides((current) => {
      let changed = false;
      const next = new Map(current);
      for (const [nodeId, value] of current) {
        if (!pendingInputIds.has(nodeId) || treeValues.get(nodeId) === value) {
          next.delete(nodeId);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [pendingInputIds, treeValues]);
  const values = new Map(treeValues);
  for (const [nodeId, value] of overrides) {
    if (pendingInputIds.has(nodeId) && treeValues.get(nodeId) !== value && values.has(nodeId)) {
      values.set(nodeId, value);
    }
  }
  return {
    values,
    snapshot() {
      return Object.fromEntries(values);
    },
    change(nodeId, value) {
      if (!pendingInputIds.has(nodeId)) return;
      setOverrides((current) => {
        const next = new Map(current);
        next.set(nodeId, value);
        return next;
      });
    },
  };
}
