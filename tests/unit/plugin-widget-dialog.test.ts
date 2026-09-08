import { describe, expect, it, vi } from 'vitest';

import {
  collectPluginWidgetValues,
  parsePluginWidgetTree,
} from '../../src/shared/plugin-widget-ir';
import {
  createPluginWidgetToolkit,
  isPluginWidgetDialogInput,
  runPluginWidgetDialog,
} from '../../src/plugins/plugin-widget-toolkit';
import { pluginUiDialogRequestPayloadSchema } from '../../src/shared/plugin-ui-dialog-bridge';
import { createSerpentGuestApi } from '../../src/scripting/serpent-guest-api';
import { PLUGIN_WIDGET_OPEN_DIALOG_WRAP_SOURCE } from '../../src/scripting/plugin-widget-guest-source';

describe('plugin widget IR', () => {
  it('rejects oversized or duplicate-id trees', () => {
    expect(() => parsePluginWidgetTree({
      type: 'column',
      children: [
        { type: 'text', id: 'name', label: 'Name', value: 'a' },
        { type: 'text', id: 'name', label: 'Also name', value: 'b' },
      ],
    })).toThrow(/unique/u);
  });

  it('collects field values from nested rows', () => {
    const tree = parsePluginWidgetTree({
      type: 'column',
      children: [
        { type: 'note', text: 'Hello' },
        {
          type: 'row',
          children: [
            { type: 'number', id: 'sizeValue', label: 'Size', value: 20 },
            {
              type: 'select',
              id: 'sizeUnit',
              label: 'Unit',
              value: 'mb',
              options: [{ value: 'mb', label: 'MB' }],
            },
          ],
        },
      ],
    });
    expect(collectPluginWidgetValues(tree)).toEqual({
      sizeValue: 20,
      sizeUnit: 'mb',
    });
    expect(parsePluginWidgetTree({
      type: 'heading',
      text: '图像设置',
    })).toEqual({ type: 'heading', text: '图像设置' });
  });

  it('accepts bounded standard lists for comparison previews', () => {
    const tree = parsePluginWidgetTree({
      type: 'list',
      columns: ['原文件名', '新文件名'],
      rows: [['before.png', 'after.png']],
      emptyText: '没有可预览的项目',
    });
    expect(tree.type).toBe('list');
    expect((tree as Extract<typeof tree, { type: 'list' }>).rows).toEqual([['before.png', 'after.png']]);
    expect(() => parsePluginWidgetTree({
      type: 'list',
      columns: ['名称'],
      rows: [['one', 'unexpected']],
    })).toThrow(/more cells/u);
  });
});

describe('plugin widget toolkit', () => {
  it('rebuilds visibility from persisted state after a change', () => {
    const ui = createPluginWidgetToolkit();
    const render = (toolkit: ReturnType<typeof createPluginWidgetToolkit>) => {
      const mode = toolkit.state('percent');
      return toolkit.column(
        toolkit.select({
          id: 'targetMode',
          label: 'Mode',
          value: mode.get(),
          onChange: mode.set,
          options: [
            { value: 'percent', label: 'Percent' },
            { value: 'size', label: 'Size' },
          ],
        }),
        mode.get() === 'percent'
          ? toolkit.number({ id: 'percent', label: 'Percent', value: 50 })
          : toolkit.number({ id: 'sizeValue', label: 'Size', value: 20 }),
      );
    };

    const first = ui.build(render);
    expect(collectPluginWidgetValues(first)).toMatchObject({ targetMode: 'percent', percent: 50 });
    expect(ui.applyChange('targetMode', 'size')).toBe(true);
    const second = ui.build(render);
    expect(collectPluginWidgetValues(second)).toMatchObject({ targetMode: 'size', sizeValue: 20 });
    expect(second).not.toEqual(expect.objectContaining({
      children: expect.arrayContaining([expect.objectContaining({ id: 'percent' })]),
    }));
  });

  it('keeps typed field values across rebuilds', () => {
    const ui = createPluginWidgetToolkit();
    const render = (toolkit: ReturnType<typeof createPluginWidgetToolkit>) => (
      toolkit.column(toolkit.number({ id: 'percent', label: 'Percent', value: 50 }))
    );
    ui.build(render);
    ui.applyChange('percent', 35);
    const next = ui.build(render);
    expect(collectPluginWidgetValues(next).percent).toBe(35);
  });

  it('resets a select when the stored value is no longer in the options', () => {
    const ui = createPluginWidgetToolkit();
    const format = { current: 'mp4' };
    const render = (toolkit: ReturnType<typeof createPluginWidgetToolkit>) => (
      toolkit.select({
        id: 'videoCodec',
        label: 'Codec',
        value: format.current === 'webm' ? 'vp9' : 'h264',
        options: format.current === 'webm'
          ? [{ value: 'vp9', label: 'VP9' }, { value: 'av1', label: 'AV1' }]
          : [{ value: 'h264', label: 'H.264' }, { value: 'vp9', label: 'VP9' }],
      })
    );
    expect(collectPluginWidgetValues(ui.build(render)).videoCodec).toBe('h264');
    format.current = 'webm';
    const next = ui.build(render);
    expect(collectPluginWidgetValues(next).videoCodec).toBe('vp9');
  });
});

describe('widget dialog session', () => {
  it('opens a widget tree without sending render() across the host command', async () => {
    const result = await runPluginWidgetDialog({
      createSessionId: () => '11111111-1111-4111-8111-111111111111',
      open: async (input) => {
        expect(input.title).toBe('媒体压缩');
        expect(input.submitLabel).toBe('开始处理');
        expect(input.tree.type).toBe('column');
        expect(collectPluginWidgetValues(input.tree)).toMatchObject({ targetMode: 'percent', percent: 50 });
        return { result: { targetMode: 'percent', percent: 50 } };
      },
      patch: async () => undefined,
      nextEvent: async () => null,
      close: () => undefined,
    }, {
      title: '媒体压缩',
      submitLabel: '开始处理',
      render(ui) {
        const mode = ui.state('percent');
        return ui.column(
          ui.select({
            id: 'targetMode',
            label: 'Mode',
            value: mode.get(),
            onChange: mode.set,
            options: [
              { value: 'percent', label: 'Percent' },
              { value: 'size', label: 'Size' },
            ],
          }),
          mode.get() === 'percent'
            ? ui.number({ id: 'percent', label: 'Percent', value: 50 })
            : ui.number({ id: 'sizeValue', label: 'Size', value: 20 }),
        );
      },
    });
    expect(result).toEqual({ targetMode: 'percent', percent: 50 });
  });

  it('accepts widget dialog request payloads without a Manifest dialogId', () => {
    expect(pluginUiDialogRequestPayloadSchema.parse({
      requestId: 'plugin-ui-dialog-1',
      pluginId: 'com.example.plugin',
      pluginInstanceId: '11111111-1111-4111-8111-111111111111',
      libraryId: 'library-a',
      sessionId: '22222222-2222-4222-8222-222222222222',
      title: '媒体压缩',
      tree: { type: 'note', text: 'Hello' },
    }).title).toBe('媒体压缩');
  });
});

describe('serpent.ui.openDialog widget wrap', () => {
  it('coerces a remembered guest select value to the current options', () => {
    expect(PLUGIN_WIDGET_OPEN_DIALOG_WRAP_SOURCE).toContain(
      'allowed.indexOf(String(value)) === -1',
    );
    expect(PLUGIN_WIDGET_OPEN_DIALOG_WRAP_SOURCE).toContain('type: "list"');
  });

  it('still maps dialogId calls onto ui.dialog', async () => {
    const executeCommand = vi.fn(async () => ({ result: { crf: 23 } }));
    const serpent = createSerpentGuestApi({ executeCommand });
    await expect(serpent.ui!.openDialog!({
      dialogId: 'converter',
      payload: { kind: 'convert' },
    })).resolves.toEqual({ crf: 23 });
  });

  it('runs render() in-process and does not serialize the function', async () => {
    const executeCommand = vi.fn(async (commandId: string, input: unknown) => {
      if (commandId === 'ui.dialog') {
        expect(input).toMatchObject({
          title: 'Demo',
          sessionId: expect.any(String),
        });
        expect(input).not.toHaveProperty('render');
        return { result: { name: 'ok' } };
      }
      return { patched: true };
    });
    const serpent = createSerpentGuestApi({
      executeCommand,
      widgetDialog: {
        nextEvent: async () => null,
        close: () => undefined,
      },
    });
    expect(isPluginWidgetDialogInput({ title: 'Demo', render() { return null; } })).toBe(true);
    await expect(serpent.ui!.openDialog!({
      title: 'Demo',
      render(ui: { note: (text: string) => unknown }) {
        return ui.note('Hello');
      },
    })).resolves.toEqual({ name: 'ok' });
    expect(executeCommand).toHaveBeenCalledWith(
      'ui.dialog',
      expect.objectContaining({ title: 'Demo', tree: { type: 'note', text: 'Hello' } }),
      undefined,
    );
  });
});
