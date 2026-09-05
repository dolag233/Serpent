import { useEffect, useState, type ReactNode } from 'react';
import type { PluginUiDialogRequestPayload } from '../shared/plugin-ui-dialog-bridge';
import type {
  PluginManagerDialogContribution,
  SerpentPluginManagerApi,
} from '../shared/plugin-manager-api';
import {
  buildPluginIframeViewDescriptors,
  PluginIframeViewHost,
  type PluginIframeViewDescriptor,
} from './plugin-iframe-view-host';

/**
 * Host for plugin modal dialogs (Serpent-a3de58). Main resolves a
 * `serpent.ui.openDialog` call by asking the focused window to mount the
 * plugin's dialog iframe; the iframe completes (or is dismissed) and the
 * result resolves the pending plugin command.
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
): PluginUiDialogRequestPayload | null {
  const [request, setRequest] = useState<PluginUiDialogRequestPayload | null>(null);
  useEffect(() => {
    if (pluginApi?.onPluginUiDialogRequest === undefined) return;
    return pluginApi.onPluginUiDialogRequest((input) => {
      setRequest(input);
    });
  }, [pluginApi]);
  return request;
}

async function loadDialogDescriptor(
  pluginApi: SerpentPluginManagerApi,
  request: PluginUiDialogRequestPayload,
): Promise<PluginIframeViewDescriptor & { width?: number; height?: number } | null> {
  const result = await pluginApi.listPluginContributions({
    libraryId: request.libraryId,
    target: 'dialogs',
  });
  if (!('contributions' in result)) return null;
  const match = result.contributions.find(
    (contribution): contribution is PluginManagerDialogContribution =>
      contribution.kind === 'dialog'
      && contribution.target === 'dialogs'
      && contribution.id === request.dialogId
      && contribution.pluginId === request.pluginId
      && contribution.pluginInstanceId === request.pluginInstanceId,
  );
  if (match === undefined) return null;
  return {
    ...buildDialogDescriptor(match),
    ...(match.width === undefined ? {} : { width: match.width }),
    ...(match.height === undefined ? {} : { height: match.height }),
  };
}

export function PluginUiDialogHost({
  request,
  pluginApi,
  libraryId,
}: {
  request: PluginUiDialogRequestPayload | null;
  pluginApi: SerpentPluginManagerApi | undefined;
  libraryId: string | undefined;
}): ReactNode {
  const [descriptor, setDescriptor] = useState<
    (PluginIframeViewDescriptor & { width?: number; height?: number }) | null
  >(null);

  useEffect(() => {
    if (request === null) {
      setDescriptor(null);
      return;
    }
    let cancelled = false;
    if (pluginApi === undefined) {
      setDescriptor(null);
      return;
    }
    void loadDialogDescriptor(pluginApi, request).then((descriptor) => {
      if (cancelled) return;
      if (descriptor === null) {
        // Unknown dialog: fail the pending openDialog immediately.
        handleComplete(null);
        return;
      }
      setDescriptor(descriptor);
    }).catch(() => {
      if (!cancelled) handleComplete(null);
    });
    return () => {
      cancelled = true;
    };
  }, [pluginApi, request]);

  // Escape dismisses the dialog while it is open (hooks must run unconditionally).
  useEffect(() => {
    if (request === null || descriptor === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleComplete(null);
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [request, descriptor]);

  function handleComplete(result: unknown | null) {
    setDescriptor(null);
    if (request !== null) {
      pluginApi?.resolvePluginUiDialog?.({ requestId: request.requestId, result });
    }
  }

  if (request === null || descriptor === null) return null;

  const width = descriptor.width ?? 560;
  const height = descriptor.height ?? 640;

  const onCancel = () => handleComplete(null);

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onCancel}>
      <div
        aria-label={descriptor.title}
        aria-modal="true"
        className="plugin-ui-dialog"
        role="dialog"
        style={{ width: `${width}px`, height: `${height}px` }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="plugin-ui-dialog-title">{descriptor.title}</div>
        <div className="plugin-ui-dialog-body">
          <PluginIframeViewHost
            className="plugin-ui-dialog-frame"
            initialPayload={request.payload ?? null}
            libraryId={libraryId}
            onDialogComplete={handleComplete}
            pluginApi={pluginApi}
            view={descriptor}
          />
        </div>
      </div>
    </div>
  );
}
