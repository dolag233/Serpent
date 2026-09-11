// @vitest-environment happy-dom
import { act, createElement, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import {
  PluginWidgetRenderer,
  usePluginWidgetForm,
} from '../../src/renderer/plugin-widget-renderer';
import type { PluginWidgetNode, PluginWidgetValue } from '../../src/shared/plugin-widget-ir';

function Harness({
  tree,
  onChange,
  changeRef,
}: {
  readonly tree: PluginWidgetNode;
  readonly onChange?: (nodeId: string, value: PluginWidgetValue) => void;
  readonly changeRef?: { current?: (nodeId: string, value: PluginWidgetValue) => void };
}): ReactNode {
  const form = usePluginWidgetForm(tree);
  useEffect(() => {
    if (changeRef !== undefined) changeRef.current = form.change;
  }, [changeRef, form.change]);
  return createElement(PluginWidgetRenderer, {
    onChange: (nodeId: string, value: PluginWidgetValue) => {
      form.change(nodeId, value);
      onChange?.(nodeId, value);
    },
    tree,
    values: form.values,
  });
}

describe('PluginWidgetRenderer form synchronization', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    root?.unmount();
    root = undefined;
    container?.remove();
    container = undefined;
  });

  it('uses the shared settings card and an inline labelled switch for groups', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const tree: PluginWidgetNode = {
      type: 'group', title: '参数', children: [
        { type: 'switch', id: 'enabled', label: '自动编号', value: false },
      ],
    };
    await act(async () => { root?.render(createElement(Harness, { tree })); });
    expect(container.querySelector('[data-ui-pattern="settings-card"]')).not.toBeNull();
    expect(container.querySelector('fieldset, legend')).toBeNull();
    const row = container.querySelector('.app-settings-toggle-row');
    expect(row?.querySelector('[role="switch"]')).not.toBeNull();
    expect(row?.querySelector('.ui-field')).toBeNull();
  });

  it('adopts coupled field values from a widget patch', async () => {
    const initialTree: PluginWidgetNode = {
      type: 'row',
      children: [
        { type: 'toggle', id: 'caseSensitive', label: 'Aa', value: true },
        { type: 'toggle', id: 'regex', label: '.*', value: false },
      ],
    };
    const patchedTree: PluginWidgetNode = {
      type: 'row',
      children: [
        { type: 'toggle', id: 'caseSensitive', label: 'Aa', value: false },
        { type: 'toggle', id: 'regex', label: '.*', value: true },
      ],
    };
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(createElement(Harness, { tree: initialTree }));
    });
    const regex = container.querySelector<HTMLButtonElement>('#regex');
    expect(regex?.getAttribute('aria-pressed')).toBe('false');
    await act(async () => {
      regex?.click();
    });
    // Controlled toggles remain on the last authoritative tree until the
    // plugin snapshot returns, so the pair never renders two enabled modes.
    expect(container.querySelector<HTMLButtonElement>('#caseSensitive')?.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector<HTMLButtonElement>('#regex')?.getAttribute('aria-pressed')).toBe('false');

    await act(async () => {
      root?.render(createElement(Harness, { tree: patchedTree }));
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    });
    expect(container.querySelector<HTMLButtonElement>('#caseSensitive')?.getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector<HTMLButtonElement>('#regex')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('drops an acknowledged optimistic value before applying a later peer patch', async () => {
    const initialTree: PluginWidgetNode = {
      type: 'row',
      children: [
        { type: 'toggle', id: 'caseSensitive', label: 'Aa', value: true },
        { type: 'toggle', id: 'regex', label: '.*', value: false },
      ],
    };
    const regexTree: PluginWidgetNode = {
      type: 'row',
      children: [
        { type: 'toggle', id: 'caseSensitive', label: 'Aa', value: false },
        { type: 'toggle', id: 'regex', label: '.*', value: true },
      ],
    };
    const caseTree: PluginWidgetNode = {
      type: 'row',
      children: [
        { type: 'toggle', id: 'caseSensitive', label: 'Aa', value: true },
        { type: 'toggle', id: 'regex', label: '.*', value: false },
      ],
    };
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(createElement(Harness, { tree: initialTree }));
    });
    await act(async () => {
      container?.querySelector<HTMLButtonElement>('#regex')?.click();
    });
    await act(async () => {
      root?.render(createElement(Harness, { tree: regexTree }));
    });
    expect(container.querySelector<HTMLButtonElement>('#caseSensitive')?.getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector<HTMLButtonElement>('#regex')?.getAttribute('aria-pressed')).toBe('true');

    // The user turns regex back off after the first patch. The old
    // implementation retained regex=true as a permanent local override and
    // masked this authoritative second patch.
    await act(async () => {
      container?.querySelector<HTMLButtonElement>('#caseSensitive')?.click();
    });
    await act(async () => {
      root?.render(createElement(Harness, { tree: caseTree }));
    });
    expect(container.querySelector<HTMLButtonElement>('#caseSensitive')?.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector<HTMLButtonElement>('#regex')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps the latest local text while older patches arrive', async () => {
    const initialTree: PluginWidgetNode = {
      type: 'text',
      id: 'prefix',
      label: 'Prefix',
      value: '',
    };
    const firstPatch: PluginWidgetNode = {
      type: 'text',
      id: 'prefix',
      label: 'Prefix',
      value: 'a',
    };
    const secondPatch: PluginWidgetNode = {
      type: 'text',
      id: 'prefix',
      label: 'Prefix',
      value: 'ab',
    };
    const changeRef: { current?: (nodeId: string, value: PluginWidgetValue) => void } = {};
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(createElement(Harness, {
        changeRef,
        tree: initialTree,
      }));
    });
    // Drive two edits before either IPC patch returns and assert the actual
    // controlled input value rather than only a pure map merge.
    const input = container.querySelector<HTMLInputElement>('#prefix');
    expect(input).not.toBeNull();
    await act(async () => {
      changeRef.current?.('prefix', 'a');
      changeRef.current?.('prefix', 'ab');
    });
    expect(input?.value).toBe('ab');

    await act(async () => {
      root?.render(createElement(Harness, { tree: firstPatch }));
    });
    expect(container.querySelector<HTMLInputElement>('#prefix')?.value).toBe('ab');
    await act(async () => {
      root?.render(createElement(Harness, { tree: secondPatch }));
    });
    expect(container.querySelector<HTMLInputElement>('#prefix')?.value).toBe('ab');
  });

  it('keeps the latest local number while an older numeric patch arrives', async () => {
    const initialTree: PluginWidgetNode = {
      type: 'number',
      id: 'numberingStart',
      label: 'Start',
      value: 1,
    };
    const firstPatch: PluginWidgetNode = { ...initialTree, value: 12 };
    const secondPatch: PluginWidgetNode = { ...initialTree, value: 123 };
    const changeRef: { current?: (nodeId: string, value: PluginWidgetValue) => void } = {};
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(createElement(Harness, { changeRef, tree: initialTree }));
    });
    await act(async () => {
      changeRef.current?.('numberingStart', 12);
      changeRef.current?.('numberingStart', 123);
    });
    expect(container.querySelector<HTMLInputElement>('#numberingStart')?.value).toBe('123');

    await act(async () => {
      root?.render(createElement(Harness, { tree: firstPatch }));
    });
    expect(container.querySelector<HTMLInputElement>('#numberingStart')?.value).toBe('123');
    await act(async () => {
      root?.render(createElement(Harness, { tree: secondPatch }));
    });
    expect(container.querySelector<HTMLInputElement>('#numberingStart')?.value).toBe('123');
  });
});
