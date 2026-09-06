import { describe, expect, it } from 'vitest';

import { createPluginUiUrl, rewritePluginUiHtmlAssetUrls } from '../../src/main/plugin-ui-assets';
import {
  parsePluginUiHostMessage,
  parsePluginUiIframeMessage,
} from '../../src/shared/plugin-ui-protocol';
import {
  buildPluginDialogFramePayload,
  pluginUiIframeReadyMatches,
  resolvePluginUiDialogFrameSize,
  shouldIgnoreInitialFrameLoad,
  takePluginUiDialogRequest,
} from '../../src/renderer/plugin-ui-dialog-session';

describe('plugin dialog host session', () => {
  const view = {
    id: 'com.dolag.serpent.media-converter.aa983299-25dc-4a1e-86d3-ac2c8a9eb5e7.compress',
    pluginInstanceId: 'aa983299-25dc-4a1e-86d3-ac2c8a9eb5e7',
    viewType: 'dialog' as const,
    scope: 'library' as const,
  };

  it('puts instanceId on the iframe URL so the frame does not parse pathname', () => {
    const url = createPluginUiUrl({
      pluginId: 'com.dolag.serpent.media-converter',
      instanceId: view.pluginInstanceId,
      contributionId: view.id,
      libraryId: 'library-a',
      entryPath: 'entry/ui/panel.html',
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('instanceId')).toBe(view.pluginInstanceId);
    expect(parsed.searchParams.get('contributionId')).toBe(view.id);
  });

  it('accepts ready with a Manifest local id or the hosted contribution id', () => {
    const local = parsePluginUiIframeMessage({
      type: 'plugin-ui.ready',
      contributionId: 'compress',
      instanceId: view.pluginInstanceId,
      viewType: 'dialog',
      scope: 'library',
    });
    const hosted = parsePluginUiIframeMessage({
      type: 'plugin-ui.ready',
      contributionId: view.id,
      instanceId: view.pluginInstanceId,
      viewType: 'dialog',
      scope: 'library',
    });
    if (local.type !== 'plugin-ui.ready' || hosted.type !== 'plugin-ui.ready') {
      throw new Error('Expected ready messages.');
    }
    expect(pluginUiIframeReadyMatches(view, local)).toBe(true);
    expect(pluginUiIframeReadyMatches(view, hosted)).toBe(true);
  });

  it('rejects ready from another dialog or instance', () => {
    const other = parsePluginUiIframeMessage({
      type: 'plugin-ui.ready',
      contributionId: 'convert',
      instanceId: view.pluginInstanceId,
      viewType: 'dialog',
      scope: 'library',
    });
    if (other.type !== 'plugin-ui.ready') throw new Error('Expected ready.');
    expect(pluginUiIframeReadyMatches(view, other)).toBe(false);
  });

  it('does not cover the form when load fires after plugin-ui.ready', () => {
    expect(shouldIgnoreInitialFrameLoad({ ready: true, loadCount: 1 })).toBe(true);
    expect(shouldIgnoreInitialFrameLoad({ ready: false, loadCount: 1 })).toBe(false);
    expect(shouldIgnoreInitialFrameLoad({ ready: true, loadCount: 2 })).toBe(false);
  });

  it('always stamps dialogId onto the iframe payload', () => {
    expect(buildPluginDialogFramePayload({
      requestId: 'plugin-ui-dialog-1',
      pluginId: 'com.dolag.serpent.media-converter',
      pluginInstanceId: view.pluginInstanceId,
      dialogId: 'compress',
      libraryId: 'library-a',
      payload: { kind: 'compress', assetCount: 3 },
    })).toEqual({
      kind: 'compress',
      assetCount: 3,
      dialogId: 'compress',
    });
  });

  it('sizes the iframe from content instead of a fixed Manifest height', () => {
    const size = resolvePluginUiDialogFrameSize({
      declaredWidth: 520,
      declaredHeight: 680,
      contentHeight: 360,
    });
    expect(size.width).toBe(520);
    expect(size.maxHeight).toBe(680);
    expect(size.frameHeight).toBeLessThan(680);
    expect(size.frameHeight).toBe(360);
  });

  it('parses cancel and content-size iframe messages used by host chrome', () => {
    expect(parsePluginUiIframeMessage({ type: 'plugin-ui.dialog-cancelled' }).type)
      .toBe('plugin-ui.dialog-cancelled');
    expect(parsePluginUiIframeMessage({
      type: 'plugin-ui.dialog-content-size',
      width: 520,
      height: 360,
    })).toMatchObject({ height: 360 });
  });

  it('parses host footer submit and dialog payload with Manifest dialogId', () => {
    expect(parsePluginUiHostMessage({
      type: 'plugin-ui.dialog-request-submit',
      contributionId: view.id,
      instanceId: view.pluginInstanceId,
    }).type).toBe('plugin-ui.dialog-request-submit');
    expect(parsePluginUiHostMessage({
      type: 'plugin-ui.dialog-payload',
      contributionId: view.id,
      instanceId: view.pluginInstanceId,
      payload: { dialogId: 'compress', kind: 'compress', assetCount: 3 },
    })).toMatchObject({
      type: 'plugin-ui.dialog-payload',
      payload: { dialogId: 'compress', assetCount: 3 },
    });
  });

  it('rewrites same-folder dialog scripts and leaves traversal src untouched', () => {
    const documentUrl = createPluginUiUrl({
      pluginId: 'com.dolag.serpent.media-converter',
      instanceId: view.pluginInstanceId,
      contributionId: view.id,
      libraryId: 'library-a',
      entryPath: 'entry/ui/panel.html',
    });
    const rewritten = rewritePluginUiHtmlAssetUrls(
      '<script src="./panel-host-contract.js"></script><script src="./panel.js"></script>',
      documentUrl,
    );
    expect(rewritten).toContain(`src="./panel-host-contract.js${new URL(documentUrl).search}"`);
    expect(rewritten).toContain(`src="./panel.js${new URL(documentUrl).search}"`);
    expect(rewritePluginUiHtmlAssetUrls(
      '<script src="../../src/panel-host-contract.js"></script>',
      documentUrl,
    )).toBe('<script src="../../src/panel-host-contract.js"></script>');
  });

  it('cancels the previous unfinished dialog when a new request arrives', () => {
    const resolved: Array<{ requestId: string; result: null }> = [];
    const first = {
      requestId: 'dialog-1',
      pluginId: 'com.example.plugin',
      pluginInstanceId: 'instance-1',
      libraryId: 'library-1',
      dialogId: 'compress',
    };
    const second = {
      ...first,
      requestId: 'dialog-2',
    };
    expect(takePluginUiDialogRequest(first, second, (input) => resolved.push(input))).toBe(second);
    expect(resolved).toEqual([{ requestId: 'dialog-1', result: null }]);
    expect(takePluginUiDialogRequest(null, second, (input) => resolved.push(input))).toBe(second);
    expect(resolved).toHaveLength(1);
  });
});
