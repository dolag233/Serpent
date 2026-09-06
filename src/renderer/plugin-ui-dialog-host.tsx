import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  isPluginUiWidgetDialogRequest,
  pluginDialogContributionMatches,
  type PluginUiDialogRequestPayload,
} from '../shared/plugin-ui-dialog-bridge';
import type { PluginWidgetNode, PluginWidgetValue } from '../shared/plugin-widget-ir';
import type {
  PluginManagerDialogContribution,
  SerpentPluginManagerApi,
} from '../shared/plugin-manager-api';
import {
  buildPluginIframeViewDescriptors,
  PluginIframeViewHost,
  type PluginIframeViewDescriptor,
} from './plugin-iframe-view-host';
import {
  buildPluginDialogFramePayload,
  resolvePluginUiDialogFrameSize,
  takePluginUiDialogRequest,
} from './plugin-ui-dialog-session';
import { PluginWidgetRenderer, usePluginWidgetForm } from './plugin-widget-renderer';
import { useT } from './i18n';
import { DialogShell } from './ui/patterns';

/**
 * Host for plugin modal dialogs (Serpent-a3de58).
 *
 * Widget sessions (`openDialog({ title, render })`) map IR onto Host
 * primitives. The Manifest `entry` iframe path remains an escape hatch.
 *
 * Must stay mounted at the window overlay layer. Hiding it behind
 * `previewAsset` (or any browse-only branch) drops the IPC with no panel.
 */

export type ActivePluginUiDialog = {
  request: PluginUiDialogRequestPayload;
  descriptor: PluginIframeViewDescriptor;
  width?: number;
  height?: number;
};

function buildDialogDescriptor(
  contribution: PluginManagerDialogContribution,
): PluginIframeViewDescriptor {
  const [descriptor] = buildPluginIframeViewDescriptors(
    [contribution],
    'dialog',
    'library',
  );
  if (descriptor === undefined) throw new Error('Dialog descriptor missing URL.');
  return descriptor;
}

/** Subscribes to Main's open-dialog requests and tracks the active one. */
export function usePluginUiDialogRequest(
  pluginApi: SerpentPluginManagerApi | undefined,
): {
  request: PluginUiDialogRequestPayload | null;
  clearRequest(): void;
} {
  const [request, setRequest] = useState<PluginUiDialogRequestPayload | null>(null);
  const requestRef = useRef<PluginUiDialogRequestPayload | null>(null);
  const clearRequest = useCallback(() => {
    requestRef.current = null;
    setRequest(null);
  }, []);
  useEffect(() => {
    if (pluginApi?.onPluginUiDialogRequest === undefined) return;
    return pluginApi.onPluginUiDialogRequest((input) => {
      const previous = requestRef.current;
      if (pluginApi.resolvePluginUiDialog !== undefined) {
        takePluginUiDialogRequest(previous, input, pluginApi.resolvePluginUiDialog);
      }
      requestRef.current = input;
      setRequest(input);
    });
  }, [pluginApi]);
  useEffect(() => {
    if (pluginApi?.onPluginUiDialogPatch === undefined) return;
    return pluginApi.onPluginUiDialogPatch((patch) => {
      setRequest((current) => {
        if (current === null || current.requestId !== patch.requestId) return current;
        return { ...current, tree: patch.tree };
      });
    });
  }, [pluginApi]);
  return {
    request,
    clearRequest,
  };
}

function PluginDialogOverlay({
  children,
  onCancel,
}: {
  readonly children: ReactNode;
  readonly onCancel: () => void;
}): ReactNode {
  return (
    <>
      <div aria-hidden="true" className="dialog-backdrop" />
      <div className="plugin-ui-dialog-stage" onClick={onCancel} role="presentation">
        {children}
      </div>
    </>
  );
}

async function loadDialogDescriptor(
  pluginApi: SerpentPluginManagerApi,
  request: PluginUiDialogRequestPayload,
): Promise<PluginIframeViewDescriptor & { width?: number; height?: number } | null> {
  if (request.dialogId === undefined) return null;
  const dialogId = request.dialogId;
  const result = await pluginApi.listPluginContributions({
    libraryId: request.libraryId,
    target: 'dialogs',
  });
  if (!('contributions' in result)) return null;
  const match = result.contributions.find(
    (contribution): contribution is PluginManagerDialogContribution =>
      contribution.kind === 'dialog'
      && contribution.target === 'dialogs'
      && contribution.pluginId === request.pluginId
      && contribution.pluginInstanceId === request.pluginInstanceId
      && pluginDialogContributionMatches(contribution, {
        dialogId,
        pluginId: request.pluginId,
        pluginInstanceId: request.pluginInstanceId,
      }),
  );
  if (match === undefined) return null;
  return {
    ...buildDialogDescriptor(match),
    ...(match.width === undefined ? {} : { width: match.width }),
    ...(match.height === undefined ? {} : { height: match.height }),
  };
}

function PluginWidgetDialogBody({
  pluginApi,
  request,
  onComplete,
}: {
  pluginApi: SerpentPluginManagerApi | undefined;
  request: PluginUiDialogRequestPayload & {
    sessionId: string;
    title: string;
    tree: PluginWidgetNode;
  };
  onComplete: (result: unknown | null) => void;
}): ReactNode {
  const t = useT();
  const form = usePluginWidgetForm(request.tree);
  const onCancel = () => onComplete(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onComplete(null);
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onComplete]);

  function change(nodeId: string, value: PluginWidgetValue) {
    form.change(nodeId, value);
    pluginApi?.sendPluginUiWidgetEvent?.({
      sessionId: request.sessionId,
      type: 'change',
      nodeId,
      value,
    });
  }

  return (
    <PluginDialogOverlay onCancel={onCancel}>
      <DialogShell
        aria-label={request.title}
        className="create-dialog plugin-ui-dialog plugin-ui-dialog--widget"
        dialogId={`plugin-ui-dialog-${request.requestId}`}
        footer={(
          <div className="dialog-actions plugin-ui-dialog-actions">
            <button className="secondary-button" onClick={onCancel} type="button">
              {t('common.cancel')}
            </button>
            <button
              className="primary-button"
              onClick={() => onComplete(form.snapshot())}
              type="button"
            >
              {request.submitLabel ?? t('plugin.dialogSubmit')}
            </button>
          </div>
        )}
        onClick={(event) => event.stopPropagation()}
        onRequestClose={onCancel}
        title={request.title}
      >
        <PluginWidgetRenderer onChange={change} tree={request.tree} values={form.values} />
      </DialogShell>
    </PluginDialogOverlay>
  );
}

function PluginIframeDialogBody({
  pluginApi,
  request,
  onComplete,
}: {
  pluginApi: SerpentPluginManagerApi | undefined;
  request: PluginUiDialogRequestPayload;
  onComplete: (result: unknown | null) => void;
}): ReactNode {
  const t = useT();
  const [descriptor, setDescriptor] = useState<
    (PluginIframeViewDescriptor & { width?: number; height?: number }) | null
  >(null);
  const [contentHeight, setContentHeight] = useState<number | undefined>(undefined);
  const [submitNonce, setSubmitNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (pluginApi === undefined) {
      onComplete(null);
      return;
    }
    void loadDialogDescriptor(pluginApi, request).then((next) => {
      if (cancelled) return;
      if (next === null) {
        onComplete(null);
        return;
      }
      setDescriptor(next);
    }).catch(() => {
      if (!cancelled) onComplete(null);
    });
    return () => {
      cancelled = true;
    };
  }, [pluginApi, request, onComplete]);

  useEffect(() => {
    if (descriptor === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onComplete(null);
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [descriptor, onComplete]);

  if (descriptor === null) return null;

  const size = resolvePluginUiDialogFrameSize({
    declaredWidth: descriptor.width,
    declaredHeight: descriptor.height,
    ...(contentHeight === undefined ? {} : { contentHeight }),
  });
  const onCancel = () => onComplete(null);
  const framePayload = buildPluginDialogFramePayload(request);

  return (
    <PluginDialogOverlay onCancel={onCancel}>
      <DialogShell
        aria-label={descriptor.title}
        className="create-dialog plugin-ui-dialog"
        contentClassName="ui-dialog-shell__content--flush"
        dialogId={`plugin-ui-dialog-${request.requestId}`}
        footer={(
          <div className="dialog-actions plugin-ui-dialog-actions">
            <button className="secondary-button" onClick={onCancel} type="button">
              {t('common.cancel')}
            </button>
            <button
              className="primary-button"
              onClick={() => setSubmitNonce((value) => value + 1)}
              type="button"
            >
              {t('plugin.dialogSubmit')}
            </button>
          </div>
        )}
        onClick={(event) => event.stopPropagation()}
        onRequestClose={onCancel}
        style={{
          width: `${size.width}px`,
          maxHeight: `${size.maxHeight}px`,
          ['--plugin-ui-dialog-frame-height' as string]: `${size.frameHeight}px`,
        }}
        title={descriptor.title}
      >
        <PluginIframeViewHost
          className="plugin-ui-dialog-frame"
          dialogSubmitNonce={submitNonce}
          initialPayload={framePayload}
          libraryId={request.libraryId}
          onDialogComplete={onComplete}
          onDialogContentSize={(next) => setContentHeight(next.height)}
          pluginApi={pluginApi}
          view={descriptor}
        />
      </DialogShell>
    </PluginDialogOverlay>
  );
}

export function PluginUiDialogHost({
  pluginApi,
  onOpenChange,
}: {
  pluginApi: SerpentPluginManagerApi | undefined;
  onOpenChange?: (open: boolean) => void;
}): ReactNode {
  const { request, clearRequest } = usePluginUiDialogRequest(pluginApi);
  const requestRef = useRef(request);

  const handleComplete = useCallback((result: unknown | null) => {
    const active = requestRef.current;
    if (active !== null) {
      pluginApi?.resolvePluginUiDialog?.({ requestId: active.requestId, result });
    }
    clearRequest();
  }, [pluginApi, clearRequest]);

  useEffect(() => {
    requestRef.current = request;
  }, [request]);

  useEffect(() => {
    onOpenChange?.(request !== null);
  }, [onOpenChange, request]);
  useEffect(() => {
    return () => {
      onOpenChange?.(false);
    };
  }, [onOpenChange]);

  if (request === null) return null;
  if (isPluginUiWidgetDialogRequest(request)) {
    return (
      <PluginWidgetDialogBody
        key={request.requestId}
        onComplete={handleComplete}
        pluginApi={pluginApi}
        request={request}
      />
    );
  }
  return (
    <PluginIframeDialogBody
      key={request.requestId}
      onComplete={handleComplete}
      pluginApi={pluginApi}
      request={request}
    />
  );
}
