import {
  collectPluginWidgetValues,
  parsePluginWidgetTree,
  type PluginWidgetEvent,
  type PluginWidgetNode,
  type PluginWidgetOption,
  type PluginWidgetListCell,
  type PluginWidgetValue,
} from '../shared/plugin-widget-ir';

export type PluginWidgetChild = PluginWidgetNode | null | undefined | false;

export type PluginWidgetState<T> = {
  get(): T;
  set(value: T): void;
};

type FieldSpec<T extends PluginWidgetValue> = {
  readonly id: string;
  readonly label: string;
  readonly value: T;
  readonly description?: string;
  readonly onChange?: (value: T) => void;
};

export type PluginWidgetToolkit = {
  state<T>(initial: T): PluginWidgetState<T>;
  column(...children: PluginWidgetChild[]): PluginWidgetNode;
  row(...children: PluginWidgetChild[]): PluginWidgetNode;
  note(text: string): PluginWidgetNode;
  heading(text: string): PluginWidgetNode;
  separator(): PluginWidgetNode;
  list(spec: {
    readonly columns: readonly string[];
    readonly rows: readonly (readonly PluginWidgetListCell[])[];
    readonly emptyText?: string;
  }): PluginWidgetNode;
  text(spec: FieldSpec<string>): PluginWidgetNode;
  number(spec: FieldSpec<number> & {
    readonly min?: number;
    readonly max?: number;
    readonly step?: number;
  }): PluginWidgetNode;
  select(spec: FieldSpec<string> & {
    readonly options: readonly PluginWidgetOption[];
  }): PluginWidgetNode;
  switch(spec: FieldSpec<boolean>): PluginWidgetNode;
  toggle(spec: FieldSpec<boolean>): PluginWidgetNode;
  slider(spec: FieldSpec<number> & {
    readonly min?: number;
    readonly max?: number;
    readonly step?: number;
  }): PluginWidgetNode;
  applyChange(nodeId: string, value: PluginWidgetValue): boolean;
  snapshotValues(): Record<string, PluginWidgetValue>;
  build(render: (ui: PluginWidgetToolkit) => PluginWidgetChild): PluginWidgetNode;
};

function compactChildren(children: readonly PluginWidgetChild[]): PluginWidgetNode[] {
  const next: PluginWidgetNode[] = [];
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    next.push(child);
  }
  return next;
}

function optionalDescription(description: string | undefined): { description: string } | Record<string, never> {
  return typeof description === 'string' && description.length > 0 ? { description } : {};
}

export function createPluginWidgetToolkit(): PluginWidgetToolkit {
  const values = new Map<string, PluginWidgetValue>();
  const listeners = new Map<string, (value: PluginWidgetValue) => void>();
  const states: Array<{ current: unknown }> = [];
  let stateCursor = 0;
  let lastTree: PluginWidgetNode | undefined;

  const resolveValue = <T extends PluginWidgetValue>(id: string, fallback: T): T => {
    if (values.has(id)) return values.get(id) as T;
    return fallback;
  };

  const rememberField = <T extends PluginWidgetValue>(
    spec: FieldSpec<T>,
  ): T => {
    const value = resolveValue(spec.id, spec.value);
    values.set(spec.id, value);
    if (spec.onChange === undefined) listeners.delete(spec.id);
    else listeners.set(spec.id, spec.onChange as (value: PluginWidgetValue) => void);
    return value;
  };

  const toolkit: PluginWidgetToolkit = {
    state<T>(initial: T): PluginWidgetState<T> {
      const index = stateCursor;
      stateCursor += 1;
      const existing = states[index];
      if (existing === undefined) {
        states[index] = { current: initial };
      }
      const slot = states[index] as { current: T };
      return {
        get() {
          return slot.current;
        },
        set(value: T) {
          slot.current = value;
        },
      };
    },
    column(...children) {
      return { type: 'column', children: compactChildren(children) };
    },
    row(...children) {
      return { type: 'row', children: compactChildren(children) };
    },
    note(text) {
      return { type: 'note', text: String(text) };
    },
    heading(text) {
      return { type: 'heading', text: String(text) };
    },
    separator() {
      return { type: 'separator' };
    },
    list(spec) {
      return {
        type: 'list',
        columns: spec.columns.map((column) => String(column)),
        rows: spec.rows.map((row) => row.map((cell) => (
          typeof cell === 'string'
            ? cell
            : { segments: cell.segments.map((segment) => ({
              text: String(segment.text),
              ...(segment.tone === undefined ? {} : { tone: segment.tone }),
            })) }
        ))),
        ...(spec.emptyText === undefined ? {} : { emptyText: String(spec.emptyText) }),
      };
    },
    text(spec) {
      const value = rememberField(spec);
      return {
        type: 'text',
        id: spec.id,
        label: spec.label,
        value,
        ...optionalDescription(spec.description),
      };
    },
    number(spec) {
      const value = rememberField(spec);
      return {
        type: 'number',
        id: spec.id,
        label: spec.label,
        value,
        ...(spec.min === undefined ? {} : { min: spec.min }),
        ...(spec.max === undefined ? {} : { max: spec.max }),
        ...(spec.step === undefined ? {} : { step: spec.step }),
        ...optionalDescription(spec.description),
      };
    },
    select(spec) {
      let value = rememberField(spec);
      const allowed = spec.options.map((option) => option.value);
      if (allowed.length > 0 && !allowed.includes(String(value))) {
        const fallback = allowed.includes(spec.value) ? spec.value : allowed[0]!;
        values.set(spec.id, fallback);
        value = fallback;
      }
      return {
        type: 'select',
        id: spec.id,
        label: spec.label,
        value,
        options: spec.options.map((option) => ({ value: option.value, label: option.label })),
        ...optionalDescription(spec.description),
      };
    },
    switch(spec) {
      const value = rememberField(spec);
      return {
        type: 'switch',
        id: spec.id,
        label: spec.label,
        value,
        ...optionalDescription(spec.description),
      };
    },
    toggle(spec) {
      const value = rememberField(spec);
      return {
        type: 'toggle',
        id: spec.id,
        label: spec.label,
        value,
        ...optionalDescription(spec.description),
      };
    },
    slider(spec) {
      const value = rememberField(spec);
      return {
        type: 'slider',
        id: spec.id,
        label: spec.label,
        value,
        ...(spec.min === undefined ? {} : { min: spec.min }),
        ...(spec.max === undefined ? {} : { max: spec.max }),
        ...(spec.step === undefined ? {} : { step: spec.step }),
        ...optionalDescription(spec.description),
      };
    },
    applyChange(nodeId, value) {
      values.set(nodeId, value);
      const listener = listeners.get(nodeId);
      if (listener === undefined) return false;
      listener(value);
      return true;
    },
    snapshotValues() {
      if (lastTree === undefined) {
        return Object.fromEntries(values);
      }
      return {
        ...collectPluginWidgetValues(lastTree),
        ...Object.fromEntries(values),
      };
    },
    build(render) {
      listeners.clear();
      stateCursor = 0;
      const rendered = render(toolkit);
      if (rendered === null || rendered === undefined || rendered === false) {
        throw new Error('Widget render() must return a tree.');
      }
      lastTree = parsePluginWidgetTree(rendered);
      return lastTree;
    },
  };
  return toolkit;
}

export function isPluginWidgetDialogInput(input: unknown): input is PluginWidgetDialogInput {
  if (input === null || typeof input !== 'object') return false;
  const candidate = input as { title?: unknown; render?: unknown };
  return typeof candidate.title === 'string' && typeof candidate.render === 'function';
}

export type PluginWidgetDialogInput = {
  readonly title: string;
  readonly submitLabel?: string;
  readonly render: (ui: PluginWidgetToolkit) => PluginWidgetChild;
};

export type PluginWidgetDialogAdapters = {
  createSessionId(): string;
  open(input: {
    sessionId: string;
    title: string;
    submitLabel?: string;
    tree: PluginWidgetNode;
  }): Promise<unknown>;
  patch(input: { sessionId: string; tree: PluginWidgetNode }): Promise<void>;
  nextEvent(sessionId: string): Promise<PluginWidgetEvent | null>;
  close(sessionId: string): void;
};

function unwrapDialogResult(value: unknown): unknown {
  if (value && typeof value === 'object' && 'result' in value) {
    return (value as { result: unknown }).result;
  }
  return value;
}

export async function runPluginWidgetDialog(
  adapters: PluginWidgetDialogAdapters,
  input: PluginWidgetDialogInput,
): Promise<Record<string, PluginWidgetValue> | null> {
  const sessionId = adapters.createSessionId();
  const toolkit = createPluginWidgetToolkit();
  const tree = toolkit.build(input.render);
  let closed = false;
  const loop = (async () => {
    while (!closed) {
      const event = await adapters.nextEvent(sessionId);
      if (event === null) return;
      if (event.type !== 'change') continue;
      toolkit.applyChange(event.nodeId, event.value);
      const nextTree = toolkit.build(input.render);
      await adapters.patch({ sessionId, tree: nextTree });
    }
  })();
  try {
    const raw = await adapters.open({
      sessionId,
      title: input.title,
      ...(typeof input.submitLabel === 'string' && input.submitLabel.length > 0
        ? { submitLabel: input.submitLabel }
        : {}),
      tree,
    });
    const result = unwrapDialogResult(raw);
    if (result === null || result === undefined) return null;
    if (typeof result !== 'object') return null;
    return result as Record<string, PluginWidgetValue>;
  } finally {
    closed = true;
    adapters.close(sessionId);
    await loop.catch(() => undefined);
  }
}

export type PluginWidgetEventQueue = {
  push(value: PluginWidgetEvent): void;
  end(): void;
  next(): Promise<PluginWidgetEvent | null>;
};

export function createPluginWidgetEventQueue(): PluginWidgetEventQueue {
  const values: PluginWidgetEvent[] = [];
  const waiters: Array<(value: PluginWidgetEvent | null) => void> = [];
  let closed = false;
  return {
    push(value) {
      const waiter = waiters.shift();
      if (waiter !== undefined) waiter(value);
      else if (!closed) values.push(value);
    },
    end() {
      if (closed) return;
      closed = true;
      for (const waiter of waiters.splice(0)) waiter(null);
    },
    next() {
      const value = values.shift();
      if (value !== undefined) return Promise.resolve(value);
      if (closed) return Promise.resolve(null);
      return new Promise((resolve) => waiters.push(resolve));
    },
  };
}
