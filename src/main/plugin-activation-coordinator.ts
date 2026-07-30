import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  validatePluginManifestCompatibility,
  type PluginCompatibilityTarget,
} from '../plugins/plugin-manifest';
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
  /** Re-check engines / native OS·arch·ABI at activate time (Electron ABI may change after install). */
  compatibility?: PluginCompatibilityTarget;
  readEntryFile?: (absolutePath: string) => Promise<string>;
  logger?: PluginActivationCoordinatorLogger;
}

type ActiveRecord = {
  instanceId: string;
  mode: 'standard' | 'trusted';
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
      previous.set(pluginId, { instanceId, mode: candidate.mode });
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
      } catch (error) {
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

  #deactivateInstance(record: ActiveRecord, reason: PluginRuntimeDeactivateReason): void {
    if (record.mode === 'standard') {
      this.options.supervisor.deactivate(record.instanceId, reason);
      return;
    }
    this.options.trustedSupervisor?.deactivate(record.instanceId, reason);
  }

  #deactivateLibraryHosts(libraryId: string, reason: PluginRuntimeDeactivateReason): void {
    this.options.supervisor.deactivateLibrary(libraryId, reason);
    this.options.trustedSupervisor?.deactivateLibrary(libraryId, reason);
  }
}
