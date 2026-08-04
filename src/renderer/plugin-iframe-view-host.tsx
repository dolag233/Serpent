import { useEffect, useRef } from 'react';

import {
  buildPluginUiThemeHostMessage,
  PLUGIN_UI_THEME_TOKEN_NAMES,
  type PluginThemePackage,
} from '../plugins/plugin-themes';
import type { SerpentPluginManagerApi } from '../shared/plugin-manager-api';
import {
  isTrustedPluginUiMessage,
  parsePluginUiIframeMessage,
} from '../shared/plugin-ui-protocol';
import { useTheme } from './theme';

export type PluginIframeViewDescriptor = {
  id: string;
  pluginId: string;
  pluginInstanceId: string;
  title: string;
  url: string;
  themePackage?: PluginThemePackage;
};

export function buildPluginIframeViewDescriptors<
  T extends { id: string; url?: string; themePackage?: PluginThemePackage },
>(contributions: readonly T[]): Array<T & { url: string }> {
  return contributions
    .filter((contribution): contribution is T & { url: string } => contribution.url !== undefined)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function readThemeTokens(): Record<string, string> {
  if (typeof document === 'undefined') return {};
  const styles = getComputedStyle(document.documentElement);
  return Object.fromEntries(
    PLUGIN_UI_THEME_TOKEN_NAMES
      .map((name) => [name, styles.getPropertyValue(name).trim()] as const)
      .filter(([, value]) => value.length > 0),
  );
}

function postToPluginIframe(
  frame: HTMLIFrameElement | null,
  message: Parameters<Window['postMessage']>[0],
): void {
  frame?.contentWindow?.postMessage(message, '*');
}

function postPluginThemeToIframe(
  frame: HTMLIFrameElement | null,
  input: {
    view: Pick<PluginIframeViewDescriptor, 'id' | 'pluginInstanceId' | 'themePackage'>;
    resolvedTheme: 'light' | 'dark';
    revision: number;
  },
): void {
  postToPluginIframe(frame, buildPluginUiThemeHostMessage({
    contributionId: input.view.id,
    instanceId: input.view.pluginInstanceId,
    resolvedTheme: input.resolvedTheme,
    revision: input.revision,
    hostTokens: readThemeTokens(),
    themePackage: input.view.themePackage,
  }));
}

export function PluginIframeViewHost({
  view,
  pluginApi,
  libraryId,
  className,
  title,
}: {
  view: PluginIframeViewDescriptor;
  pluginApi: SerpentPluginManagerApi | undefined;
  libraryId: string | undefined;
  className?: string;
  title?: string;
}): React.ReactNode {
  const { resolved, themeRevision } = useTheme();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const readyRef = useRef(false);
  // The contribution id is part of the iframe key, so changing a view creates
  // a fresh document. The message effect cleanup resets the ready handshake.

  useEffect(() => {
    if (!readyRef.current) return;
    postPluginThemeToIframe(frameRef.current, { view, resolvedTheme: resolved, revision: themeRevision });
  }, [resolved, themeRevision, view]);

  useEffect(() => {
    const pluginOrigin = `serpent-plugin://${view.pluginId}`;
    const onMessage = (event: MessageEvent<unknown>) => {
      const frame = frameRef.current;
      if (frame === null || event.source !== frame.contentWindow) return;
      if (!isTrustedPluginUiMessage({
        origin: event.origin,
        source: event.source,
        expectedOrigin: 'null',
        expectedPluginOrigin: pluginOrigin,
        expectedSource: frame.contentWindow,
      })) return;
      let message;
      try {
        message = parsePluginUiIframeMessage(event.data);
      } catch {
        return;
      }
      if (message.type === 'plugin-ui.ready') {
        if (message.contributionId !== view.id || message.instanceId !== view.pluginInstanceId) {
          console.warn('plugin-ui.ready-mismatch', {
            expectedContributionId: view.id,
            expectedInstanceId: view.pluginInstanceId,
            receivedContributionId: message.contributionId,
            receivedInstanceId: message.instanceId,
          });
          return;
        }
        readyRef.current = true;
        postPluginThemeToIframe(frame, { view, resolvedTheme: resolved, revision: themeRevision });
        return;
      }
      if (!readyRef.current || pluginApi === undefined || libraryId === undefined) return;
      if (message.type === 'plugin-ui.invoke-command') {
        void pluginApi.runPluginCommand({
          type: 'plugin-manager.run-command',
          libraryId,
          pluginId: view.pluginId,
          commandId: message.commandId,
          ...message.context,
        }).then((result) => {
          postToPluginIframe(frame, {
            type: 'plugin-ui.command-result',
            requestId: message.requestId,
            ok: result.ok,
            ...(result.ok ? {} : { errorCode: result.code }),
          });
        }).catch(() => {
          postToPluginIframe(frame, {
            type: 'plugin-ui.command-result',
            requestId: message.requestId,
            ok: false,
            errorCode: 'operation-failed',
          });
        });
        return;
      }
      if (message.type === 'plugin-ui.storage.get' || message.type === 'plugin-ui.storage.set') {
        const storageRequest = message.type === 'plugin-ui.storage.get'
          ? {
            type: 'plugin-manager.ui-storage-get' as const,
            libraryId,
            pluginId: view.pluginId,
            pluginInstanceId: view.pluginInstanceId,
            key: message.key,
          }
          : {
            type: 'plugin-manager.ui-storage-set' as const,
            libraryId,
            pluginId: view.pluginId,
            pluginInstanceId: view.pluginInstanceId,
            key: message.key,
            value: message.value,
          };
        void pluginApi.request(storageRequest).then((result) => {
          const value = 'value' in result && result.value !== undefined ? result.value : null;
          postToPluginIframe(frame, {
            type: 'plugin-ui.storage.result',
            requestId: message.requestId,
            ok: result.ok,
            ...(result.ok && message.type === 'plugin-ui.storage.get' ? { value } : {}),
            ...(result.ok ? {} : { errorCode: result.code }),
          });
        }).catch(() => {
          postToPluginIframe(frame, {
            type: 'plugin-ui.storage.result',
            requestId: message.requestId,
            ok: false,
            errorCode: 'operation-failed',
          });
        });
      }
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      readyRef.current = false;
    };
  }, [libraryId, pluginApi, resolved, themeRevision, view]);

  return (
    <iframe
      className={className}
      key={view.id}
      ref={frameRef}
      sandbox="allow-scripts"
      src={view.url}
      title={title ?? view.title}
    />
  );
}
