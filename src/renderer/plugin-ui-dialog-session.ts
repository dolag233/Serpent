import type { PluginUiDialogRequestPayload } from '../shared/plugin-ui-dialog-bridge';
import type { PluginUiIframeMessage, PluginUiViewScope, PluginUiViewType } from '../shared/plugin-ui-protocol';

export type PluginUiDialogFrameSize = {
  width: number;
  maxHeight: number;
  frameHeight: number;
};

/**
 * Host payload for a dialog iframe. Always carries Manifest `dialogId` so the
 * frame can choose convert vs compress before (or without) Guest `payload.kind`.
 */
export function buildPluginDialogFramePayload(
  request: PluginUiDialogRequestPayload,
): Record<string, unknown> {
  const dialogId = request.dialogId ?? '';
  const base = request.payload;
  if (base !== null && typeof base === 'object' && !Array.isArray(base)) {
    return { ...base, dialogId };
  }
  return {
    dialogId,
    ...(base === undefined ? {} : { wrappedPayload: base }),
  };
}

/** Cancels the previous unfinished dialog so a second open does not hang the first. */
export function takePluginUiDialogRequest(
  previous: PluginUiDialogRequestPayload | null,
  next: PluginUiDialogRequestPayload,
  resolve: (input: { requestId: string; result: null }) => void,
): PluginUiDialogRequestPayload {
  if (previous !== null && previous.requestId !== next.requestId) {
    resolve({ requestId: previous.requestId, result: null });
  }
  return next;
}

/**
 * Dialog chrome uses DialogShell max-height. Manifest `height` is a cap, not a
 * fixed window size; iframe height follows reported content.
 */
export function resolvePluginUiDialogFrameSize(input: {
  declaredWidth?: number;
  declaredHeight?: number;
  contentHeight?: number;
}): PluginUiDialogFrameSize {
  const width = Math.min(Math.max(input.declaredWidth ?? 520, 360), 720);
  const maxHeight = Math.min(input.declaredHeight ?? 720, 720);
  const chrome = 132;
  const available = Math.max(200, maxHeight - chrome);
  const content = input.contentHeight ?? 280;
  return {
    width,
    maxHeight,
    frameHeight: Math.min(available, Math.max(200, content)),
  };
}

export type PluginUiFrameIdentity = {
  id: string;
  pluginInstanceId: string;
  viewType: PluginUiViewType;
  scope: PluginUiViewScope;
};

/**
 * `plugin-ui.ready` may send the Manifest local id (`compress`) or the hosted
 * contribution id (`pluginId.scope.compress`). Custom-scheme pathnames also
 * mis-parse instanceId; callers should prefer the URL query `instanceId`.
 */
export function pluginUiIframeReadyMatches(
  view: PluginUiFrameIdentity,
  message: Extract<PluginUiIframeMessage, { type: 'plugin-ui.ready' }>,
): boolean {
  if (message.instanceId !== view.pluginInstanceId) return false;
  if (message.viewType !== undefined && message.viewType !== view.viewType) return false;
  if (message.scope !== undefined && message.scope !== view.scope) return false;
  if (message.contributionId === view.id) return true;
  const localId = view.id.split('.').at(-1);
  if (localId !== undefined && message.contributionId === localId) return true;
  return view.id.endsWith(`.${message.contributionId}`);
}

/**
 * Classic scripts post `plugin-ui.ready` during parse, before the iframe
 * `load` event. That first load must not kick the host back into `reloading`
 * or the opaque placeholder covers the form forever.
 */
export function shouldIgnoreInitialFrameLoad(input: {
  ready: boolean;
  loadCount: number;
}): boolean {
  return input.ready && input.loadCount === 1;
}
