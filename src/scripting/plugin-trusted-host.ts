import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import {
  pluginTrustedParentMessageSchema,
  type PluginTrustedChildMessage,
  type PluginTrustedParentMessage,
} from '../shared/plugin-trusted-runtime-protocol';
import type { PluginRuntimeDeactivateReason } from '../shared/plugin-runtime-utility-protocol';
import type { AutomationScriptCommandId } from '../shared/automation-script-api';

type PendingHostRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
};

type TrustedExports = {
  activate?: (serpent: unknown) => unknown;
  deactivate?: () => unknown;
};

type ActiveInstance = {
  instanceId: string;
  pluginId: string;
  packageHash: string;
  pendingHostRequests: Map<string, PendingHostRequest>;
  deactivateReason: PluginRuntimeDeactivateReason | undefined;
  resolvePark(): void;
  parkPromise: Promise<void>;
  activated: boolean;
  exports: TrustedExports | undefined;
};

export type PluginTrustedHostHandler = {
  handle(message: unknown): void;
  dispose(): void;
};

function resolveEntryAbsolute(packageDirectory: string, entryRelativePath: string): string | undefined {
  const root = path.resolve(packageDirectory);
  const absolute = path.resolve(root, entryRelativePath);
  const relative = path.relative(root, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
  return absolute;
}

function nodeRequire(): NodeRequire {
  // UtilityProcess Forge output is CJS; unit tests may run as ESM.
  const href = import.meta.url;
  return createRequire(href.startsWith('file:') ? fileURLToPath(href) : href);
}

async function loadTrustedEntry(absoluteEntry: string): Promise<TrustedExports> {
  try {
    const imported = await import(pathToFileURL(absoluteEntry).href) as TrustedExports;
    if (typeof imported.activate === 'function') return imported;
  } catch {
    // Fall through to CJS require for CommonJS packages.
  }
  const loaded = nodeRequire()(absoluteEntry) as TrustedExports | { default?: TrustedExports };
  if (typeof (loaded as TrustedExports).activate === 'function') {
    return loaded as TrustedExports;
  }
  const nested = (loaded as { default?: TrustedExports }).default;
  if (nested !== undefined && typeof nested.activate === 'function') return nested;
  throw new Error('Trusted plugin entry must export activate().');
}

function createSerpentBridge(
  instance: ActiveInstance,
  postMessage: (message: PluginTrustedChildMessage) => void,
): Record<string, unknown> {
  const callHost = (commandId: AutomationScriptCommandId, input: unknown): Promise<unknown> => (
    new Promise((resolve, reject) => {
      const requestId = globalThis.crypto.randomUUID();
      instance.pendingHostRequests.set(requestId, { resolve, reject });
      postMessage({
        type: 'plugin-trusted.host-command',
        instanceId: instance.instanceId,
        requestId,
        commandId,
        input,
      });
    })
  );

  return {
    assets: {
      search: (input: unknown) => callHost('asset.search', input ?? {}),
      list: (input: unknown) => callHost('asset.list', input ?? {}),
      getMetadata: (assetId: unknown) => callHost('asset.metadata.get', { assetId }),
    },
    library: {
      inspect: () => callHost('library.inspect', {}),
    },
    console: {
      log: (...args: unknown[]) => {
        postMessage({
          type: 'plugin-trusted.console',
          instanceId: instance.instanceId,
          level: 'log',
          message: args.map((value) => String(value)).join(' ').slice(0, 4_096),
        });
      },
    },
  };
}

/**
 * Trusted plugins run with full Node in this UtilityProcess. Permissions are
 * advisory for Gateway RPC only — they do not sandbox Node itself.
 */
export function createPluginTrustedHostHandler(options: {
  postMessage(message: PluginTrustedChildMessage): void;
}): PluginTrustedHostHandler {
  const instances = new Map<string, ActiveInstance>();

  const finish = (instanceId: string): void => {
    const current = instances.get(instanceId);
    if (current === undefined) return;
    instances.delete(instanceId);
    for (const pending of current.pendingHostRequests.values()) {
      pending.reject(new Error('The trusted plugin instance ended.'));
    }
    current.pendingHostRequests.clear();
    current.resolvePark();
  };

  const activate = async (
    request: Extract<PluginTrustedParentMessage, { type: 'plugin-trusted.activate' }>,
  ): Promise<void> => {
    if (instances.has(request.instanceId)) {
      options.postMessage({
        type: 'plugin-trusted.activation-failed',
        instanceId: request.instanceId,
        code: 'ACTIVATE_REJECTED',
        message: 'A trusted plugin instance with this id is already active.',
      });
      return;
    }

    let resolvePark = (): void => undefined;
    const parkPromise = new Promise<void>((resolve) => {
      resolvePark = resolve;
    });
    const active: ActiveInstance = {
      instanceId: request.instanceId,
      pluginId: request.pluginId,
      packageHash: request.packageHash,
      pendingHostRequests: new Map(),
      deactivateReason: undefined,
      resolvePark,
      parkPromise,
      activated: false,
      exports: undefined,
    };
    instances.set(request.instanceId, active);

    try {
      const absoluteEntry = resolveEntryAbsolute(request.packageDirectory, request.entryRelativePath);
      if (absoluteEntry === undefined) {
        options.postMessage({
          type: 'plugin-trusted.activation-failed',
          instanceId: request.instanceId,
          code: 'ENTRY_INVALID',
          message: 'Trusted plugin entry path escaped its package directory.',
        });
        finish(request.instanceId);
        return;
      }

      const exported = await loadTrustedEntry(absoluteEntry);
      active.exports = exported;
      const serpent = createSerpentBridge(active, options.postMessage);
      await exported.activate?.(serpent);
      active.activated = true;
      options.postMessage({
        type: 'plugin-trusted.activated',
        instanceId: request.instanceId,
        pluginId: request.pluginId,
        packageHash: request.packageHash,
      });
      await active.parkPromise;
      try {
        await exported.deactivate?.();
      } catch {
        // Best-effort deactivate after Main requested shutdown.
      }
      options.postMessage({
        type: 'plugin-trusted.deactivated',
        instanceId: request.instanceId,
        reason: active.deactivateReason ?? 'supervisor-shutdown',
      });
    } catch (error) {
      if (!active.activated) {
        options.postMessage({
          type: 'plugin-trusted.activation-failed',
          instanceId: request.instanceId,
          code: 'ACTIVATE_REJECTED',
          message: error instanceof Error ? error.message : 'Trusted plugin activation failed.',
        });
      }
    } finally {
      finish(request.instanceId);
    }
  };

  const deactivate = (
    request: Extract<PluginTrustedParentMessage, { type: 'plugin-trusted.deactivate' }>,
  ): void => {
    const current = instances.get(request.instanceId);
    if (current === undefined) return;
    current.deactivateReason = request.reason;
    for (const pending of current.pendingHostRequests.values()) {
      pending.reject(new Error('The trusted plugin instance was deactivated.'));
    }
    current.pendingHostRequests.clear();
    current.resolvePark();
  };

  return {
    handle(input: unknown): void {
      const parsed = pluginTrustedParentMessageSchema.safeParse(input);
      if (!parsed.success) return;
      const message = parsed.data;
      if (message.type === 'plugin-trusted.activate') {
        void activate(message);
        return;
      }
      if (message.type === 'plugin-trusted.shutdown') {
        for (const instanceId of [...instances.keys()]) {
          deactivate({
            type: 'plugin-trusted.deactivate',
            instanceId,
            reason: 'supervisor-shutdown',
          });
        }
        return;
      }
      if (message.type === 'plugin-trusted.deactivate') {
        deactivate(message);
        return;
      }
      const current = instances.get(message.instanceId);
      if (current === undefined) return;
      const pending = current.pendingHostRequests.get(message.requestId);
      if (pending === undefined) return;
      current.pendingHostRequests.delete(message.requestId);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(new Error(message.error?.message ?? 'The host request failed.'));
    },
    dispose(): void {
      for (const instanceId of [...instances.keys()]) {
        deactivate({
          type: 'plugin-trusted.deactivate',
          instanceId,
          reason: 'supervisor-shutdown',
        });
      }
    },
  };
}
