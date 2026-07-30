import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { PluginPackageManager } from './plugin-package-manager';
import type { PluginRuntimeSupervisor } from './plugin-runtime-supervisor';
import type { InstalledPluginPackage } from './plugin-package-manager-types';

export interface PluginActivationCoordinatorLogger {
  info(scope: string, message: string, context?: Record<string, unknown>): void;
  error(scope: string, error: unknown, context?: Record<string, unknown>): void;
}

export interface PluginActivationCoordinatorOptions {
  packageManager: PluginPackageManager;
  supervisor: PluginRuntimeSupervisor;
  readEntryFile?: (absolutePath: string) => Promise<string>;
  logger?: PluginActivationCoordinatorLogger;
}

/**
 * Enumerates resolved standard plugins for an open library, reads entry bytes
 * in Main, and asks the supervisor to activate them in the isolated Host.
 * Main never evaluates plugin JavaScript.
 */
export class PluginActivationCoordinator {
  #activeByLibrary = new Map<string, Map<string, string>>();

  constructor(private readonly options: PluginActivationCoordinatorOptions) {}

  async refreshLibrary(input: {
    libraryId: string;
    libraryDirectory: string;
  }): Promise<void> {
    const safeMode = await this.options.packageManager.getSafeMode();
    if (safeMode) {
      this.options.supervisor.deactivateLibrary(input.libraryId, 'safe-mode');
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

    const desired = new Map<string, { pluginPackage: InstalledPluginPackage; entryJavaScript: string }>();
    for (const pluginId of pluginIds) {
      const resolution = await this.options.packageManager.resolve({
        libraryId: input.libraryId,
        libraryDirectory: input.libraryDirectory,
        pluginId,
      });
      if (resolution.status !== 'resolved') continue;
      if (resolution.package.manifest.runtime.mode !== 'standard') continue;
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
      try {
        const readEntry = this.options.readEntryFile ?? ((absolutePath: string) => readFile(absolutePath, 'utf8'));
        const entryJavaScript = await readEntry(entryAbsolute);
        desired.set(pluginId, { pluginPackage: resolution.package, entryJavaScript });
      } catch (error) {
        this.options.logger?.error('plugin.activation.read-entry', error, { pluginId, entryAbsolute });
      }
    }

    const previous = this.#activeByLibrary.get(input.libraryId) ?? new Map<string, string>();
    for (const [pluginId, instanceId] of previous) {
      if (!desired.has(pluginId)) {
        this.options.supervisor.deactivate(instanceId, 'resolution-changed');
        previous.delete(pluginId);
      }
    }

    for (const [pluginId, candidate] of desired) {
      if (previous.has(pluginId)) continue;
      const instanceId = randomUUID();
      previous.set(pluginId, instanceId);
      try {
        await this.options.supervisor.activate({
          instanceId,
          libraryId: input.libraryId,
          libraryDirectory: input.libraryDirectory,
          pluginId,
          version: candidate.pluginPackage.lock.version,
          packageHash: candidate.pluginPackage.lock.packageHash,
          entryJavaScript: candidate.entryJavaScript,
          permissions: candidate.pluginPackage.manifest.permissions,
        });
      } catch (error) {
        previous.delete(pluginId);
        this.options.logger?.error('plugin.activation.activate', error, { pluginId, libraryId: input.libraryId });
      }
    }

    if (previous.size === 0) this.#activeByLibrary.delete(input.libraryId);
    else this.#activeByLibrary.set(input.libraryId, previous);
  }

  async onLibraryOpened(input: {
    libraryId: string;
    libraryDirectory: string;
  }): Promise<void> {
    await this.refreshLibrary(input);
  }

  onLibraryClosed(libraryId: string): void {
    this.options.supervisor.deactivateLibrary(libraryId, 'library-closed');
    this.#activeByLibrary.delete(libraryId);
  }
}
