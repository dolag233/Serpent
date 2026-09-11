// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PluginUninstallDialog } from '../../src/renderer/PluginUninstallDialog';
import { PluginSettingsPage } from '../../src/renderer/PluginSettingsPage';
import { LocaleProvider } from '../../src/renderer/i18n';
import type {
  PluginManagerPackageSummary,
  PluginManagerRequest,
  PluginManagerResponse,
  SerpentPluginManagerApi,
} from '../../src/shared/plugin-manager-api';

const packageSummary = {
  pluginId: 'batch-renamer',
  version: '1.2.3',
  name: '批量重命名',
  description: '批量重命名资产。',
  packageHash: 'a'.repeat(64),
  runtimeMode: 'restricted',
  permissions: [],
  source: { kind: 'local-directory' },
  sourceFingerprint: 'local-directory:batch-renamer',
  scope: 'user',
  status: 'valid',
  trust: 'trusted',
  hasSettingsUi: false,
} satisfies PluginManagerPackageSummary;

function pluginListResponse(): PluginManagerResponse {
  return {
    ok: true,
    packages: [packageSummary],
    resolutions: [],
    safeMode: false,
  };
}

describe('PluginUninstallDialog', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    root?.unmount();
    root = undefined;
    container?.remove();
    container = undefined;
  });

  async function renderDialog(onCancel = vi.fn(), onConfirm = vi.fn()) {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(
        LocaleProvider,
        {
          initialPreference: 'zh-CN',
          children: createElement(PluginUninstallDialog, {
            onCancel,
            onConfirm,
            pluginName: '批量重命名',
            scopeLabel: '全局',
            version: '1.2.3',
          }),
        },
      ));
    });
    return { onCancel, onConfirm };
  }

  async function renderSettingsPage(request: ReturnType<typeof vi.fn>) {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const api = { request } as unknown as SerpentPluginManagerApi;
    await act(async () => {
      root?.render(createElement(
        LocaleProvider,
        {
          initialPreference: 'zh-CN',
          children: createElement(PluginSettingsPage, {
            api,
            libraryId: 'library-current',
            refreshKey: null,
          }),
        },
      ));
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await act(async () => undefined);
  }

  it('requires explicit confirmation and identifies plugin and scope', async () => {
    const { onCancel, onConfirm } = await renderDialog();
    expect(container?.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container?.textContent).toContain('批量重命名');
    expect(container?.textContent).toContain('全局');
    expect(container?.textContent).toContain('1.2.3');
    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('keeps cancellation separate from confirmation', async () => {
    const { onCancel, onConfirm } = await renderDialog();
    const buttons = Array.from(container?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    const cancel = buttons.find((button) => button.textContent?.includes('取消'));
    const confirm = buttons.find((button) => button.textContent?.includes('卸载'));
    await act(async () => {
      cancel?.click();
    });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
    await act(async () => {
      confirm?.click();
    });
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('does not dispatch uninstall until the settings confirmation is accepted', async () => {
    const request = vi.fn(async (input: PluginManagerRequest): Promise<PluginManagerResponse> => {
      if (input.type === 'plugin-manager.list') return pluginListResponse();
      if (input.type === 'plugin-manager.uninstall') return { ok: true, executed: true };
      return { ok: false, code: 'operation-failed' };
    });
    await renderSettingsPage(request);

    const uninstallButton = () => container?.querySelector<HTMLButtonElement>(
      '[aria-label="卸载"]',
    );
    expect(uninstallButton()).not.toBeNull();
    await act(async () => uninstallButton()?.click());
    expect(container?.querySelector('[data-dialog-id="plugin-uninstall-dialog"]')).not.toBeNull();
    expect(request.mock.calls.some(([input]) => input.type === 'plugin-manager.uninstall')).toBe(false);

    const cancel = Array.from(container?.querySelectorAll<HTMLButtonElement>('button') ?? [])
      .find((button) => button.textContent?.includes('取消'));
    await act(async () => cancel?.click());
    expect(container?.querySelector('[data-dialog-id="plugin-uninstall-dialog"]')).toBeNull();
    expect(request.mock.calls.some(([input]) => input.type === 'plugin-manager.uninstall')).toBe(false);

    await act(async () => uninstallButton()?.click());
    const confirm = Array.from(container?.querySelectorAll<HTMLButtonElement>('button') ?? [])
      .find((button) => button.textContent?.includes('卸载'));
    await act(async () => confirm?.click());
    const uninstallCall = request.mock.calls.find(([input]) => input.type === 'plugin-manager.uninstall');
    expect(uninstallCall?.[0]).toEqual({
      type: 'plugin-manager.uninstall',
      scope: 'user',
      pluginId: 'batch-renamer',
      version: '1.2.3',
    });
  });
});
