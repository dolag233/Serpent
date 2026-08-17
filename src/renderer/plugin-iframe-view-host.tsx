import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  buildPluginUiThemeHostMessage,
  PLUGIN_UI_THEME_TOKEN_NAMES,
  type PluginThemePackage,
} from '../plugins/plugin-themes';
import type { SerpentPluginManagerApi } from '../shared/plugin-manager-api';
import {
  isTrustedPluginUiMessage,
  parsePluginUiIframeMessage,
  PLUGIN_UI_VIEW_SCOPES,
  PLUGIN_UI_VIEW_TYPES,
  type PluginUiViewScope,
  type PluginUiViewType,
} from '../shared/plugin-ui-protocol';
import { useT } from './i18n';
import { useTheme } from './theme';

/* ------------------------------------------------------------------ *
 * Lifecycle state machine (pure, unit-tested)
 * ------------------------------------------------------------------ */

export type PluginViewLifecycleState =
  | 'loading'   // initial document load, awaiting plugin-ui.ready
  | 'ready'     // plugin confirmed the view; theme/state flow without reload
  | 'reloading' // ready document reloaded (user refresh/navigation)
  | 'crashed'   // iframe failed to load; retry re-enters loading
  | 'disposed'; // host unmounted the view

export type PluginViewLifecycleEvent =
  | { readonly type: 'frame-load' }
  | { readonly type: 'frame-error' }
  | { readonly type: 'plugin-ready' }
  | { readonly type: 'dispose' };

/**
 * Deterministic lifecycle transitions for a host-managed plugin view.
 * `plugin-ready` is only accepted while loading/reloading — a ready message
 * arriving after a crash is ignored (it can only come from a stale document).
 */
export function nextPluginViewState(
  prev: PluginViewLifecycleState,
  event: PluginViewLifecycleEvent,
): PluginViewLifecycleState {
  if (prev === 'disposed') return 'disposed';
  switch (event.type) {
    case 'frame-load':
      return prev === 'ready' || prev === 'reloading' ? 'reloading' : 'loading';
    case 'frame-error':
      return 'crashed';
    case 'plugin-ready':
      return prev === 'loading' || prev === 'reloading' ? 'ready' : prev;
    case 'dispose':
      return 'disposed';
  }
}

/* ------------------------------------------------------------------ *
 * Descriptors
 * ------------------------------------------------------------------ */

export type PluginIframeViewDescriptor = {
  id: string;
  pluginId: string;
  pluginInstanceId: string;
  title: string;
  url: string;
  themePackage?: PluginThemePackage;
  /** View contract metadata: which surface hosts this frame, at which scope. */
  viewType: PluginUiViewType;
  scope: PluginUiViewScope;
};

export function buildPluginIframeViewDescriptors<
  T extends {
    id: string;
    pluginId: string;
    pluginInstanceId: string;
    title: string;
    url?: string;
    themePackage?: PluginThemePackage;
  },
>(
  contributions: readonly T[],
  viewType: PluginUiViewType,
  scope: PluginUiViewScope,
): Array<T & { url: string; viewType: PluginUiViewType; scope: PluginUiViewScope }> {
  return contributions
    .filter((contribution): contribution is T & { url: string } => contribution.url !== undefined)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((contribution) => ({ ...contribution, viewType, scope }));
}

/* ------------------------------------------------------------------ *
 * Host
 * ------------------------------------------------------------------ */

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

/**
 * Host-managed plugin view frame (Serpent-ex46.7).
 *
 * Lifecycle contract: the Host announces mount on document load, the plugin
 * confirms with `plugin-ui.ready` (with optional viewType/scope check), and
 * light/dark changes flow over `theme-changed` without reloading. Frames are
 * keyed by (contribution, scope, library) so global and library instances are
 * isolated — switching libraries rebuilds the frame. Loading/reloading show
 * a placeholder overlay so the surface never blinks blank; crashes surface a
 * retry affordance and dispose cleans up listeners and notifies the plugin.
 */
export function PluginIframeViewHost({
  view,
  pluginApi,
  libraryId,
  className,
  title,
  state,
}: {
  view: PluginIframeViewDescriptor;
  pluginApi: SerpentPluginManagerApi | undefined;
  libraryId: string | undefined;
  className?: string;
  title?: string;
  /** Host-side view context (selection, filters, …) announced on mount and pushed on change. */
  state?: unknown;
}): ReactNode {
  const t = useT();
  const { resolved, themeRevision } = useTheme();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const readyRef = useRef(false);
  const mountedRef = useRef(false);
  const lifecycleRef = useRef<PluginViewLifecycleState>('loading');
  const [lifecycle, setLifecycleState] = useState<PluginViewLifecycleState>('loading');

  function transition(event: PluginViewLifecycleEvent) {
    lifecycleRef.current = nextPluginViewState(lifecycleRef.current, event);
    setLifecycleState(lifecycleRef.current);
  }

  // Scope isolation: a view instance belongs to (contribution, scope, library).
  // Changing the key rebuilds the frame document; the message-effect cleanup
  // resets the handshake, and the fresh document's load event re-enters
  // 'loading' naturally (no state reset in an effect here).
  const instanceKey = `${view.id}:${view.scope}:${view.scope === 'library' ? (libraryId ?? 'none') : 'global'}`;

  // Announce mount once the document loaded, unless the plugin already
  // confirmed ready (then the mount is announced immediately).
  const announceMounted = useCallback(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    postToPluginIframe(frameRef.current, {
      type: 'plugin-ui.view-mounted',
      contributionId: view.id,
      instanceId: view.pluginInstanceId,
      viewType: view.viewType,
      scope: view.scope,
      ...(view.scope === 'library' && libraryId !== undefined ? { libraryId } : {}),
      ...(state !== undefined ? { state } : {}),
    });
  }, [libraryId, state, view]);

  // Theme changes propagate over the wire without reloading the document.
  useEffect(() => {
    if (!readyRef.current) return;
    postPluginThemeToIframe(frameRef.current, { view, resolvedTheme: resolved, revision: themeRevision });
  }, [resolved, themeRevision, view]);

  // Host view context changes push state without a reload.
  useEffect(() => {
    if (!readyRef.current || !mountedRef.current) return;
    postToPluginIframe(frameRef.current, {
      type: 'plugin-ui.view-state-changed',
      contributionId: view.id,
      instanceId: view.pluginInstanceId,
      state,
    });
  }, [state, view]);

  // Debounced resize notifications via requestAnimationFrame.
  useEffect(() => {
    const container = containerRef.current;
    if (container === null || typeof ResizeObserver === 'undefined') return;
    let raf = 0;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (!readyRef.current || !mountedRef.current) return;
        const rect = entry.contentRect;
        postToPluginIframe(frameRef.current, {
          type: 'plugin-ui.view-resized',
          contributionId: view.id,
          instanceId: view.pluginInstanceId,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      });
    });
    observer.observe(container);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [view]);

  useEffect(() => {
    const pluginOrigin = `serpent-plugin://${view.pluginId}`;
    // Captured at effect time: the cleanup notifies the exact frame this
    // effect served, even if the ref has moved on by then.
    const servedFrame = frameRef.current;
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
        if (message.viewType !== undefined && message.viewType !== view.viewType) return;
        if (message.scope !== undefined && message.scope !== view.scope) return;
        readyRef.current = true;
        transition({ type: 'plugin-ready' });
        announceMounted();
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
      // Deterministic disposal: notify the plugin and reset the handshake.
      if (readyRef.current || mountedRef.current) {
        postToPluginIframe(servedFrame, {
          type: 'plugin-ui.view-unmounted',
          contributionId: view.id,
          instanceId: view.pluginInstanceId,
        });
      }
      readyRef.current = false;
      mountedRef.current = false;
      transition({ type: 'dispose' });
    };
  }, [announceMounted, libraryId, pluginApi, resolved, themeRevision, view]);

  const showPlaceholder = lifecycle === 'loading' || lifecycle === 'reloading';
  const crashed = lifecycle === 'crashed';

  return (
    <div className="plugin-view-host" ref={containerRef}>
      <iframe
        className={className}
        key={instanceKey}
        onError={() => transition({ type: 'frame-error' })}
        onLoad={() => {
          transition({ type: 'frame-load' });
          // A fresh document (initial load or user reload) needs its own mount
          // announcement; the guard only suppresses re-announcing the same
          // document when ready arrived before the load event.
          mountedRef.current = false;
          announceMounted();
        }}
        ref={frameRef}
        sandbox="allow-scripts"
        src={view.url}
        title={title ?? view.title}
      />
      {showPlaceholder ? (
        <div aria-hidden="true" className="plugin-view-host-placeholder">
          <span className="plugin-view-host-spinner" />
          <span>{t('common.loading')}</span>
        </div>
      ) : null}
      {crashed ? (
        <div className="plugin-view-host-crashed">
          <span>{t('plugin.viewLoadFailed')}</span>
          <button
            onClick={() => {
              const frame = frameRef.current;
              if (frame === null) return;
              // Bump the URL so the sandboxed document reloads (self-assigning
              // src is a no-op and is flagged by the linter).
              const separator = frame.src.includes('?') ? '&' : '?';
              frame.src = `${frame.src}${separator}retry=${Date.now()}`;
            }}
            type="button"
          >
            {t('common.retry')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Guard so the enum values stay in sync with the schema. */
export function isPluginUiViewType(value: string): value is PluginUiViewType {
  return (PLUGIN_UI_VIEW_TYPES as readonly string[]).includes(value);
}

export function isPluginUiViewScope(value: string): value is PluginUiViewScope {
  return (PLUGIN_UI_VIEW_SCOPES as readonly string[]).includes(value);
}
