import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  validatePluginManifestCompatibility,
  type PluginCompatibilityTarget,
  type PluginPermission,
} from '../plugins/plugin-manifest';
import {
  registerManifestContributions,
  type PluginContributionRegistry,
} from '../plugins/plugin-contributions';
import {
  PLUGIN_HOOK_DEFAULT_TIMEOUT_MS,
  PluginHookBlockedError,
  aggregatePluginHookDecisions,
  pluginHookEventSchema,
  type AggregatedPluginHookResult,
  type PluginHookContext,
  type PluginHookDecisionEntry,
  type PluginHookEvent,
} from '../plugins/plugin-hooks';
import type { PluginPackageManager } from './plugin-package-manager';
import type { PluginRuntimeSupervisor } from './plugin-runtime-supervisor';
import type { PluginTrustedRuntimeSupervisor } from './plugin-trusted-runtime-supervisor';
import type { InstalledPluginPackage } from './plugin-package-manager-types';
import type { PluginRuntimeDeactivateReason } from '../shared/plugin-runtime-utility-protocol';

export interface PluginActivationCoordinatorLogger {
  info(scope: string, message: string, context?: Record<string, unknown>): void;
  error(scope: string, error: unknown, context?: Record<string, unknown>): void;
}

export interface PluginActivationCoordinatorOptions {
  packageManager: PluginPackageManager;
  supervisor: PluginRuntimeSupervisor;
  trustedSupervisor?: PluginTrustedRuntimeSupervisor;
  /** Descriptor-only Contribution store; revoked whenever a Host instance ends. */
  contributions?: PluginContributionRegistry;
  /** Re-check engines / native OS·arch·ABI at activate time (Electron ABI may change after install). */
  compatibility?: PluginCompatibilityTarget;
  readEntryFile?: (absolutePath: string) => Promise<string>;
  logger?: PluginActivationCoordinatorLogger;
  hookTimeoutMs?: number;
}

type ActiveHookContribution = {
  event: string;
  blocking: boolean;
  localId: string;
};

type ActiveRecord = {
  instanceId: string;
  mode: 'standard' | 'trusted';
  pluginId: string;
  permissions: readonly PluginPermission[];
  hooks: readonly ActiveHookContribution[];
};

/**
 * Enumerates resolved plugins for an open library and activates them on the
 * matching Host. Standard plugins receive entry bytes; trusted plugins receive
 * a verified package directory for Node loading. Main never evaluates plugin code.
 */
export class PluginActivationCoordinator {
  #activeByLibrary = new Map<string, Map<string, ActiveRecord>>();
  #openLibraries = new Map<string, string>();

  constructor(private readonly options: PluginActivationCoordinatorOptions) {}

  async refreshLibrary(input: {
    libraryId: string;
    libraryDirectory: string;
  }): Promise<void> {
    const safeMode = await this.options.packageManager.getSafeMode();
    if (safeMode) {
      this.#deactivateLibraryHosts(input.libraryId, 'safe-mode');
      this.#activeByLibrary.delete(input.libraryId);
      return;
    }

    const [userInstalled, libraryInstalled] = await Promise.all([
      this.options.packageManager.listInstalled({ scope: 'user' }),
      this.options.packageManager.listInstalled({
        scope: 'library',
        libraryDirectory: input.libraryDirectory,
      }),
    ]);
    const pluginIds = new Set<string>();
    for (const entry of [...userInstalled, ...libraryInstalled]) {
      if (entry.status === 'valid') pluginIds.add(entry.package.lock.pluginId);
    }

    const desired = new Map<string, {
      pluginPackage: InstalledPluginPackage;
      mode: 'standard' | 'trusted';
      entryJavaScript?: string;
    }>();
    for (const pluginId of pluginIds) {
      const resolution = await this.options.packageManager.resolve({
        libraryId: input.libraryId,
        libraryDirectory: input.libraryDirectory,
        pluginId,
      });
      if (resolution.status !== 'resolved') continue;
      const mode = resolution.package.manifest.runtime.mode;
      if (mode !== 'standard' && mode !== 'trusted') continue;
      if (mode === 'trusted' && this.options.trustedSupervisor === undefined) continue;

      if (this.options.compatibility !== undefined) {
        const compatibility = validatePluginManifestCompatibility(
          resolution.package.manifest,
          this.options.compatibility,
        );
        if (!compatibility.ok) {
          this.options.logger?.error(
            'plugin.activation.compatibility',
            new Error(compatibility.message),
            { pluginId, code: compatibility.code, mode },
          );
          continue;
        }
      }

      const entryRelative = resolution.package.manifest.runtime.entry;
      const entryAbsolute = path.join(resolution.package.packageDirectory, entryRelative);
      const relative = path.relative(resolution.package.packageDirectory, entryAbsolute);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        this.options.logger?.error(
          'plugin.activation.entry',
          new Error('Plugin entry path escaped its package directory.'),
          { pluginId, entryRelative },
        );
        continue;
      }

      if (mode === 'standard') {
        try {
          const readEntry = this.options.readEntryFile ?? ((absolutePath: string) => readFile(absolutePath, 'utf8'));
          const entryJavaScript = await readEntry(entryAbsolute);
          desired.set(pluginId, { pluginPackage: resolution.package, mode, entryJavaScript });
        } catch (error) {
          this.options.logger?.error('plugin.activation.read-entry', error, { pluginId, entryAbsolute });
        }
        continue;
      }

      desired.set(pluginId, { pluginPackage: resolution.package, mode: 'trusted' });
    }

    const previous = this.#activeByLibrary.get(input.libraryId) ?? new Map<string, ActiveRecord>();
    for (const [pluginId, record] of previous) {
      const next = desired.get(pluginId);
      if (next === undefined || next.mode !== record.mode) {
        this.#deactivateInstance(record, 'resolution-changed');
        previous.delete(pluginId);
      }
    }

    for (const [pluginId, candidate] of desired) {
      if (previous.has(pluginId)) continue;
      const instanceId = randomUUID();
      previous.set(pluginId, {
        instanceId,
        mode: candidate.mode,
        pluginId,
        permissions: candidate.pluginPackage.manifest.permissions,
        hooks: (candidate.pluginPackage.manifest.contributes?.hooks ?? []).map((hook) => ({
          event: hook.event,
          blocking: hook.blocking,
          localId: hook.id,
        })),
      });
      try {
        if (candidate.mode === 'standard') {
          await this.options.supervisor.activate({
            instanceId,
            libraryId: input.libraryId,
            libraryDirectory: input.libraryDirectory,
            pluginId,
            version: candidate.pluginPackage.lock.version,
            packageHash: candidate.pluginPackage.lock.packageHash,
            entryJavaScript: candidate.entryJavaScript ?? '',
            permissions: candidate.pluginPackage.manifest.permissions,
          });
        } else {
          await this.options.trustedSupervisor!.activate({
            instanceId,
            libraryId: input.libraryId,
            libraryDirectory: input.libraryDirectory,
            pluginId,
            version: candidate.pluginPackage.lock.version,
            packageHash: candidate.pluginPackage.lock.packageHash,
            packageDirectory: candidate.pluginPackage.packageDirectory,
            entryRelativePath: candidate.pluginPackage.manifest.runtime.entry,
            permissions: candidate.pluginPackage.manifest.permissions,
          });
        }
        this.#registerContributions(instanceId, pluginId, candidate.pluginPackage);
      } catch (error) {
        this.#revokeContributions(instanceId);
        if (candidate.mode === 'standard') {
          this.options.supervisor.deactivate(instanceId, 'resolution-changed');
        } else {
          this.options.trustedSupervisor?.deactivate(instanceId, 'resolution-changed');
        }
        previous.delete(pluginId);
        this.options.logger?.error('plugin.activation.activate', error, {
          pluginId,
          libraryId: input.libraryId,
          mode: candidate.mode,
        });
      }
    }

    if (previous.size === 0) this.#activeByLibrary.delete(input.libraryId);
    else this.#activeByLibrary.set(input.libraryId, previous);
  }

  async onLibraryOpened(input: {
    libraryId: string;
    libraryDirectory: string;
  }): Promise<void> {
    this.#openLibraries.set(input.libraryId, input.libraryDirectory);
    await this.refreshLibrary(input);
  }

  onLibraryClosed(libraryId: string): void {
    this.#deactivateLibraryHosts(libraryId, 'library-closed');
    this.#activeByLibrary.delete(libraryId);
    this.#openLibraries.delete(libraryId);
  }

  async refreshOpenLibraries(): Promise<void> {
    for (const [libraryId, libraryDirectory] of this.#openLibraries) {
      await this.refreshLibrary({ libraryId, libraryDirectory });
    }
  }

  /**
   * Deliver a committed domain event to every active Host instance for the library.
   */
  fanOutDomainEvent(
    event: import('../plugins/plugin-domain-events').PluginDomainEvent,
  ): void {
    if (!this.#openLibraries.has(event.libraryId)) return;
    this.options.supervisor.deliverDomainEvent(event.libraryId, event);
    this.options.trustedSupervisor?.deliverDomainEvent(event.libraryId, event);
  }

  /**
   * Run onWill hooks for a plan-gated command before user confirmation / write.
   * Fail-open on timeout. Throws PluginHookBlockedError when an authorized
   * blocking hook returns block.
   */
  async runWillHooks(input: {
    event: PluginHookEvent;
    libraryId: string;
    summary: Record<string, unknown>;
    causeChain?: readonly string[];
  }): Promise<AggregatedPluginHookResult> {
    const parsedEvent = pluginHookEventSchema.safeParse(input.event);
    if (!parsedEvent.success) {
      return { outcome: 'allow', warnings: [] };
    }
    const active = this.#activeByLibrary.get(input.libraryId);
    if (active === undefined || active.size === 0) {
      return { outcome: 'allow', warnings: [] };
    }

    const context: PluginHookContext = {
      event: parsedEvent.data,
      libraryId: input.libraryId,
      summary: input.summary,
      causeChain: [...(input.causeChain ?? [])],
    };
    const timeoutMs = this.options.hookTimeoutMs ?? PLUGIN_HOOK_DEFAULT_TIMEOUT_MS;
    const targets = [...active.values()]
      .filter((record) => record.hooks.some((hook) => hook.event === parsedEvent.data))
      .sort((left, right) => left.pluginId.localeCompare(right.pluginId));

    const entries: PluginHookDecisionEntry[] = [];
    for (const record of targets) {
      const declared = record.hooks.find((hook) => hook.event === parsedEvent.data);
      if (declared === undefined) continue;
      const invokeId = randomUUID();
      const invoked = record.mode === 'standard'
        ? await this.options.supervisor.invokeHook({
          instanceId: record.instanceId,
          invoke: { invokeId, event: parsedEvent.data, context },
          timeoutMs,
        })
        : await this.options.trustedSupervisor!.invokeHook({
          instanceId: record.instanceId,
          invoke: { invokeId, event: parsedEvent.data, context },
          timeoutMs,
        });
      if (invoked.timedOut) {
        this.options.logger?.info('plugin.hook.timeout', 'Hook timed out; failing open.', {
          pluginId: record.pluginId,
          event: parsedEvent.data,
        });
      }
      entries.push({
        pluginId: record.pluginId,
        blockingDeclared: declared.blocking,
        hasBlockingPermission: record.permissions.includes('hook.blocking'),
        decision: invoked.decision,
        timedOut: invoked.timedOut,
      });
    }

    const aggregated = aggregatePluginHookDecisions(entries);
    if (aggregated.outcome === 'block') {
      throw new PluginHookBlockedError({
        pluginId: aggregated.block.pluginId,
        hookCode: aggregated.block.code,
        message: aggregated.block.message,
      });
    }
    return aggregated;
  }

  #registerContributions(
    instanceId: string,
    pluginId: string,
    pluginPackage: InstalledPluginPackage,
  ): void {
    const registry = this.options.contributions;
    if (registry === undefined) return;
    try {
      registerManifestContributions(registry, {
        pluginInstanceId: instanceId,
        pluginId,
        contributes: pluginPackage.manifest.contributes,
      });
    } catch (error) {
      this.options.logger?.error('plugin.activation.contributions', error, { pluginId, instanceId });
      this.#revokeContributions(instanceId);
      throw error;
    }
  }

  #revokeContributions(instanceId: string): void {
    this.options.contributions?.revokePluginInstance(instanceId);
  }

  #deactivateInstance(record: ActiveRecord, reason: PluginRuntimeDeactivateReason): void {
    this.#revokeContributions(record.instanceId);
    if (record.mode === 'standard') {
      this.options.supervisor.deactivate(record.instanceId, reason);
      return;
    }
    this.options.trustedSupervisor?.deactivate(record.instanceId, reason);
  }

  #deactivateLibraryHosts(libraryId: string, reason: PluginRuntimeDeactivateReason): void {
    const active = this.#activeByLibrary.get(libraryId);
    if (active !== undefined) {
      for (const record of active.values()) {
        this.#revokeContributions(record.instanceId);
      }
    }
    this.options.supervisor.deactivateLibrary(libraryId, reason);
    this.options.trustedSupervisor?.deactivateLibrary(libraryId, reason);
  }
}
