import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  validatePluginManifestCompatibility,
  type PluginCompatibilityTarget,
  type PluginPermission,
} from '../plugins/plugin-manifest';
import {
  listCommandContributions,
  listMcpCommandContributions,
  listMenuContributions,
  listInspectorSectionContributions,
  listInspectorViewContributions,
  listSettingsContributions,
  listSettingsPageContributions,
  listSidebarViewContributions,
  listToolbarContributions,
  listViewerActionContributions,
  listShortcutContributions,
  listViewerOverlayContributions,
  listWorkspaceViewContributions,
  registerManifestContributions,
  type PluginContributionRegistry,
} from '../plugins/plugin-contributions';
import { getPluginMcpExportedCommandIds } from '../plugins/plugin-manifest';
import { extractPluginThemePackage, type PluginThemePackage } from '../plugins/plugin-themes';
import type { PluginHostContributionTarget } from '../shared/plugin-manager-api';
import {
  PLUGIN_COMMAND_DEFAULT_TIMEOUT_MS,
  type PluginCommandContext,
  type PluginCommandComplete,
} from '../plugins/plugin-commands';
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
import { resolvePluginUiAssetPath } from './plugin-ui-assets';
import type { PluginProviderRegistry } from '../plugins/plugin-providers';

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
  /** Runtime Provider registrations; revoked whenever a Host instance ends. */
  providers?: PluginProviderRegistry;
  /** Re-check engines / native OS·arch·ABI at activate time (Electron ABI may change after install). */
  compatibility?: PluginCompatibilityTarget;
  readEntryFile?: (absolutePath: string) => Promise<string>;
  logger?: PluginActivationCoordinatorLogger;
  hookTimeoutMs?: number;
  pausePluginJobs?: (input: {
    libraryId: string;
    owners: Array<{ pluginId: string; packageHash?: string }>;
  }) => Promise<void>;
  onInstanceActivated?: (input: { libraryId: string }) => void;
  onContributionsRegistered?: (input: { libraryId: string }) => void;
}

type ActiveHookContribution = {
  event: string;
  blocking: boolean;
  localId: string;
};

type ActiveJobContribution = {
  localId: string;
  recovery: 'idempotent' | 'checkpoint';
};

type ActiveRecord = {
  instanceId: string;
  mode: 'restricted' | 'unrestricted';
  pluginId: string;
  packageHash: string;
  packageDirectory: string;
  permissions: readonly PluginPermission[];
  hooks: readonly ActiveHookContribution[];
  jobs: readonly ActiveJobContribution[];
  themePackage?: PluginThemePackage;
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

    // Activation refresh only needs package identity + manifest; full hash verify
    // blocks open/reload for large packages (e.g. Image Upscaler ~56MB).
    const [userInstalled, libraryInstalled] = await Promise.all([
      this.options.packageManager.listInstalled({ scope: 'user', integrity: 'metadata' }),
      this.options.packageManager.listInstalled({
        scope: 'library',
        libraryDirectory: input.libraryDirectory,
        integrity: 'metadata',
      }),
    ]);
    const pluginIds = new Set<string>();
    for (const entry of [...userInstalled, ...libraryInstalled]) {
      if (entry.status === 'valid') pluginIds.add(entry.package.lock.pluginId);
    }

    const desired = new Map<string, {
      pluginPackage: InstalledPluginPackage;
      mode: 'restricted' | 'unrestricted';
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
      if (mode !== 'restricted' && mode !== 'unrestricted') continue;
      // Belt-and-suspenders: Safe Mode never activates unrestricted (trusted) hosts.
      if (safeMode && mode === 'unrestricted') continue;
      if (mode === 'unrestricted' && this.options.trustedSupervisor === undefined) continue;

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

      if (mode === 'restricted') {
        try {
          const readEntry = this.options.readEntryFile ?? ((absolutePath: string) => readFile(absolutePath, 'utf8'));
          const entryJavaScript = await readEntry(entryAbsolute);
          desired.set(pluginId, { pluginPackage: resolution.package, mode, entryJavaScript });
        } catch (error) {
          this.options.logger?.error('plugin.activation.read-entry', error, { pluginId, entryAbsolute });
        }
        continue;
      }

      desired.set(pluginId, { pluginPackage: resolution.package, mode: 'unrestricted' });
    }

    const previous = this.#activeByLibrary.get(input.libraryId) ?? new Map<string, ActiveRecord>();
    for (const [pluginId, record] of previous) {
      const next = desired.get(pluginId);
      if (next === undefined || next.mode !== record.mode) {
        const reason = safeMode && record.mode === 'unrestricted' && next === undefined
          ? 'safe-mode'
          : 'resolution-changed';
        this.#deactivateInstance(record, reason);
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
        packageHash: candidate.pluginPackage.lock.packageHash,
        packageDirectory: candidate.pluginPackage.packageDirectory,
        permissions: candidate.pluginPackage.manifest.permissions,
        hooks: (candidate.pluginPackage.manifest.contributes?.hooks ?? []).map((hook) => ({
          event: hook.event,
          blocking: hook.blocking,
          localId: hook.id,
        })),
        jobs: (candidate.pluginPackage.manifest.contributes?.jobs ?? []).map((job) => ({
          localId: job.id,
          recovery: job.recovery,
        })),
        ...((): { themePackage?: PluginThemePackage } => {
          const themePackage = extractPluginThemePackage(candidate.pluginPackage.manifest);
          return themePackage === undefined ? {} : { themePackage };
        })(),
      });
      try {
        if (candidate.mode === 'restricted') {
          await this.options.supervisor.activate({
            instanceId,
            libraryId: input.libraryId,
            libraryDirectory: input.libraryDirectory,
            pluginId,
            version: candidate.pluginPackage.lock.version,
            packageHash: candidate.pluginPackage.lock.packageHash,
            entryJavaScript: candidate.entryJavaScript ?? '',
            permissions: candidate.pluginPackage.manifest.permissions,
            installScope: candidate.pluginPackage.scope,
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
            installScope: candidate.pluginPackage.scope,
          });
        }
        this.#registerContributions(input.libraryId, instanceId, pluginId, candidate.pluginPackage);
        this.options.logger?.info('plugin.activation.activate-ok', 'Plugin host activated and contributions registered.', {
          pluginId,
          libraryId: input.libraryId,
          mode: candidate.mode,
          instanceId,
        });
      } catch (error) {
        this.#revokeContributions(instanceId);
        if (candidate.mode === 'restricted') {
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
        try {
          const { appendFileSync } = await import('node:fs');
          const { join } = await import('node:path');
          appendFileSync(
            join(
              process.env.SERPENT_E2E_USER_DATA_PATH
                ?? join(process.env.HOME ?? '/tmp', 'Library/Application Support/Serpent'),
              'plugin-activation-failures.jsonl',
            ),
            `${JSON.stringify({
              at: new Date().toISOString(),
              pluginId,
              libraryId: input.libraryId,
              mode: candidate.mode,
              error: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
            })}\n`,
            'utf8',
          );
        } catch {
          // diagnostic only
        }
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

  /** Libraries that have received onLibraryOpened (startup restore must call it too). */
  trackedOpenLibraryIds(): string[] {
    return [...this.#openLibraries.keys()];
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
      const invoked = record.mode === 'restricted'
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

  listActiveInstances(libraryId: string): Array<{
    instanceId: string;
    mode: 'restricted' | 'unrestricted';
    pluginId: string;
    packageHash: string;
  }> {
    const active = this.#activeByLibrary.get(libraryId);
    if (active === undefined) return [];
    return [...active.values()].map((record) => ({
      instanceId: record.instanceId,
      mode: record.mode,
      pluginId: record.pluginId,
      packageHash: record.packageHash,
    }));
  }

  listActiveProviders(libraryId: string): readonly import('../plugins/plugin-providers').PluginProviderRegistration[] {
    return (this.options.providers?.list() ?? []).filter((provider) => provider.libraryId === libraryId);
  }

  findActiveInstance(instanceId: string): ActiveRecord | undefined {
    for (const active of this.#activeByLibrary.values()) {
      for (const record of active.values()) {
        if (record.instanceId === instanceId) return record;
      }
    }
    return undefined;
  }

  #themePackageForInstance(
    pluginInstanceId: string,
    libraryId?: string,
  ): PluginThemePackage | undefined {
    for (const [activeLibraryId, active] of this.#activeByLibrary) {
      if (libraryId !== undefined && activeLibraryId !== libraryId) continue;
      for (const record of active.values()) {
        if (record.instanceId === pluginInstanceId) return record.themePackage;
      }
    }
    return undefined;
  }

  #viewContributionAttachment(
    contribution: { pluginInstanceId: string; entryPath?: string },
    libraryId?: string,
  ) {
    const themePackage = this.#themePackageForInstance(contribution.pluginInstanceId, libraryId);
    return {
      ...(contribution.entryPath === undefined ? {} : { entryPath: contribution.entryPath }),
      ...(themePackage === undefined ? {} : { themePackage }),
    };
  }

  resolvePluginUiAsset(input: {
    libraryId: string;
    pluginId: string;
    instanceId: string;
    contributionId: string;
    relativePath: string;
  }): { absolutePath: string; pluginId: string } | undefined {
    const active = this.#activeByLibrary.get(input.libraryId);
    const record = [...(active?.values() ?? [])].find((candidate) =>
      candidate.instanceId === input.instanceId && candidate.pluginId === input.pluginId);
    if (record === undefined || this.options.contributions === undefined) return undefined;
    // Settings / sidebar / inspector / viewer iframes share serpent-plugin:// with workspace views.
    const contribution = [
      ...listWorkspaceViewContributions(this.options.contributions),
      ...listSidebarViewContributions(this.options.contributions),
      ...listInspectorViewContributions(this.options.contributions),
      ...listViewerOverlayContributions(this.options.contributions),
      ...listSettingsPageContributions(this.options.contributions),
    ].find((candidate) => candidate.id === input.contributionId
      && candidate.pluginInstanceId === input.instanceId
      && candidate.pluginId === input.pluginId);
    if (contribution?.entryPath === undefined) return undefined;
    const uiRoot = path.posix.dirname(contribution.entryPath);
    if (input.relativePath !== contribution.entryPath
      && !input.relativePath.startsWith(`${uiRoot}/`)) {
      return undefined;
    }
    const absolutePath = resolvePluginUiAssetPath(record.packageDirectory, input.relativePath);
    if (absolutePath === undefined) return undefined;
    return { absolutePath, pluginId: record.pluginId };
  }

  pluginUiStoragePermissions(input: {
    libraryId: string;
    pluginId: string;
    pluginInstanceId: string;
  }): readonly PluginPermission[] | undefined {
    const record = [...(this.#activeByLibrary.get(input.libraryId)?.values() ?? [])]
      .find((candidate) => candidate.instanceId === input.pluginInstanceId
        && candidate.pluginId === input.pluginId);
    return record?.permissions;
  }

  listContributions(input: {
    libraryId?: string;
    target?: PluginHostContributionTarget;
  } = {}) {
    if (this.options.contributions === undefined) return [];
    const activeInstanceIds = new Set(
      [...this.#activeByLibrary.entries()]
        .filter(([libraryId]) => input.libraryId === undefined || libraryId === input.libraryId)
        .flatMap(([, records]) => [...records.values()].map((record) => record.instanceId)),
    );
    if (input.target === 'commands') {
      return listCommandContributions(this.options.contributions)
        .filter((contribution) => activeInstanceIds.has(contribution.pluginInstanceId))
        .map((contribution) => ({
          kind: 'command' as const,
          id: contribution.id,
          pluginId: contribution.pluginId,
          pluginInstanceId: contribution.pluginInstanceId,
          commandId: contribution.commandId,
          title: contribution.title,
          target: 'commands' as const,
          ...(contribution.mcpExported === true ? { mcpExported: true as const } : {}),
        }));
    }
    if (input.target === 'settings.sections') {
      return listSettingsContributions(this.options.contributions)
        .filter((contribution) => activeInstanceIds.has(contribution.pluginInstanceId))
        .map((contribution) => ({
          kind: 'settings-section' as const,
          id: contribution.id,
          pluginId: contribution.pluginId,
          pluginInstanceId: contribution.pluginInstanceId,
          settingId: contribution.settingId,
          title: contribution.title,
          type: contribution.type,
          ...(contribution.description === undefined ? {} : { description: contribution.description }),
          ...(contribution.options === undefined ? {} : { options: contribution.options }),
          target: 'settings.sections' as const,
        }));
    }
    if (input.target === 'toolbar') {
      return listToolbarContributions(this.options.contributions)
        .filter((contribution) => activeInstanceIds.has(contribution.pluginInstanceId))
        .map((contribution) => ({
          kind: 'toolbar' as const,
          id: contribution.id,
          pluginId: contribution.pluginId,
          pluginInstanceId: contribution.pluginInstanceId,
          commandId: contribution.commandId,
          title: contribution.title,
          target: 'toolbar' as const,
        }));
    }
    if (input.target === 'inspector.sections') {
      return listInspectorSectionContributions(this.options.contributions)
        .filter((contribution) => activeInstanceIds.has(contribution.pluginInstanceId))
        .map((contribution) => ({
          kind: 'inspector-section' as const,
          id: contribution.id,
          pluginId: contribution.pluginId,
          pluginInstanceId: contribution.pluginInstanceId,
          commandId: contribution.commandId,
          title: contribution.title,
          commandTitle: contribution.commandTitle,
          target: 'inspector.sections' as const,
        }));
    }
    if (input.target === 'viewer.actions') {
      return listViewerActionContributions(this.options.contributions)
        .filter((contribution) => activeInstanceIds.has(contribution.pluginInstanceId))
        .map((contribution) => ({
          kind: 'viewer-action' as const,
          id: contribution.id,
          pluginId: contribution.pluginId,
          pluginInstanceId: contribution.pluginInstanceId,
          commandId: contribution.commandId,
          title: contribution.title,
          target: 'viewer.actions' as const,
        }));
    }
    if (input.target === 'shortcuts') {
      return listShortcutContributions(this.options.contributions)
        .filter((contribution) => activeInstanceIds.has(contribution.pluginInstanceId))
        .map((contribution) => ({
          kind: 'shortcut' as const,
          id: contribution.id,
          pluginId: contribution.pluginId,
          pluginInstanceId: contribution.pluginInstanceId,
          commandId: contribution.commandId,
          title: contribution.title,
          accelerator: contribution.accelerator,
          target: 'shortcuts' as const,
        }));
    }
    if (input.target === 'sidebar.entries') {
      return listSidebarViewContributions(this.options.contributions)
        .filter((contribution) => activeInstanceIds.has(contribution.pluginInstanceId))
        .map((contribution) => ({
          kind: 'view' as const,
          id: contribution.id,
          pluginId: contribution.pluginId,
          pluginInstanceId: contribution.pluginInstanceId,
          title: contribution.title,
          target: 'sidebar.entries' as const,
          ...this.#viewContributionAttachment(contribution, input.libraryId),
        }));
    }
    if (input.target === 'workspace.views') {
      return listWorkspaceViewContributions(this.options.contributions)
        .filter((contribution) => activeInstanceIds.has(contribution.pluginInstanceId))
        .map((contribution) => ({
          kind: 'view' as const,
          id: contribution.id,
          pluginId: contribution.pluginId,
          pluginInstanceId: contribution.pluginInstanceId,
          title: contribution.title,
          target: 'workspace.views' as const,
          ...this.#viewContributionAttachment(contribution, input.libraryId),
        }));
    }
    if (input.target === 'inspector.views') {
      return listInspectorViewContributions(this.options.contributions)
        .filter((contribution) => activeInstanceIds.has(contribution.pluginInstanceId))
        .map((contribution) => ({
          kind: 'view' as const,
          id: contribution.id,
          pluginId: contribution.pluginId,
          pluginInstanceId: contribution.pluginInstanceId,
          title: contribution.title,
          target: 'inspector.views' as const,
          ...this.#viewContributionAttachment(contribution, input.libraryId),
        }));
    }
    if (input.target === 'viewer.overlays') {
      return listViewerOverlayContributions(this.options.contributions)
        .filter((contribution) => activeInstanceIds.has(contribution.pluginInstanceId))
        .map((contribution) => ({
          kind: 'view' as const,
          id: contribution.id,
          pluginId: contribution.pluginId,
          pluginInstanceId: contribution.pluginInstanceId,
          title: contribution.title,
          target: 'viewer.overlays' as const,
          ...this.#viewContributionAttachment(contribution, input.libraryId),
        }));
    }
    if (input.target === 'settings.pages') {
      return listSettingsPageContributions(this.options.contributions)
        .filter((contribution) => activeInstanceIds.has(contribution.pluginInstanceId))
        .map((contribution) => ({
          kind: 'view' as const,
          id: contribution.id,
          pluginId: contribution.pluginId,
          pluginInstanceId: contribution.pluginInstanceId,
          title: contribution.title,
          target: 'settings.pages' as const,
          ...this.#viewContributionAttachment(contribution, input.libraryId),
        }));
    }
    const targets = input.target === undefined
      ? (['menus.asset', 'menus.folder', 'menus.collection', 'menus.workspace'] as const)
      : [input.target];
    return targets.flatMap((target) => listMenuContributions(this.options.contributions!, target))
      .filter((contribution) => activeInstanceIds.has(contribution.pluginInstanceId))
      .map((contribution) => ({
        kind: 'menu' as const,
        id: contribution.id,
        pluginId: contribution.pluginId,
        pluginInstanceId: contribution.pluginInstanceId,
        ...(contribution.commandId === undefined ? {} : { commandId: contribution.commandId }),
        title: contribution.title,
        target: contribution.target,
        ...(contribution.group === undefined ? {} : { group: contribution.group }),
        ...(contribution.parentId === undefined ? {} : { parentId: contribution.parentId }),
        ...(contribution.before === undefined ? {} : { before: contribution.before }),
        ...(contribution.after === undefined ? {} : { after: contribution.after }),
      }));
  }

  listMcpCommandContributions(input: { libraryId?: string } = {}) {
    if (this.options.contributions === undefined) return [];
    const activeInstanceIds = new Set(
      [...this.#activeByLibrary.entries()]
        .filter(([libraryId]) => input.libraryId === undefined || libraryId === input.libraryId)
        .flatMap(([, records]) => [...records.values()].map((record) => record.instanceId)),
    );
    return listMcpCommandContributions(this.options.contributions)
      .filter((contribution) => activeInstanceIds.has(contribution.pluginInstanceId));
  }

  async runCommand(input: {
    libraryId: string;
    contributionId?: string;
    pluginId?: string;
    commandId?: string;
    assetIds?: readonly string[];
    folderIds?: readonly string[];
    collectionIds?: readonly string[];
    timeoutMs?: number;
  }): Promise<{ complete: PluginCommandComplete; timedOut: boolean }> {
    const candidates = [
      ...this.listContributions({ libraryId: input.libraryId }),
      ...this.listContributions({ libraryId: input.libraryId, target: 'commands' }),
      ...this.listContributions({ libraryId: input.libraryId, target: 'toolbar' }),
      ...this.listContributions({ libraryId: input.libraryId, target: 'inspector.sections' }),
      ...this.listContributions({ libraryId: input.libraryId, target: 'viewer.actions' }),
      ...this.listContributions({ libraryId: input.libraryId, target: 'shortcuts' }),
    ]
      .filter((item): item is Extract<
        ReturnType<PluginActivationCoordinator['listContributions']>[number],
        { kind: 'command' } | { kind: 'menu' } | { kind: 'toolbar' } | { kind: 'inspector-section' } | { kind: 'viewer-action' } | { kind: 'shortcut' }
      > & { commandId: string } => (item.kind === 'menu'
        || item.kind === 'command'
        || item.kind === 'toolbar'
        || item.kind === 'inspector-section'
        || item.kind === 'viewer-action'
        || item.kind === 'shortcut') && item.commandId !== undefined);
    const contribution = input.contributionId === undefined
      ? candidates.find((item) => item.pluginId === input.pluginId && item.commandId === input.commandId)
      : candidates.find((item) => item.id === input.contributionId);
    if (contribution === undefined) {
      throw new Error('The plugin command contribution is not active.');
    }
    const activeRecord = [...(this.#activeByLibrary.get(input.libraryId)?.values() ?? [])]
      .find((item) => item.instanceId === contribution.pluginInstanceId);
    if (activeRecord === undefined) throw new Error('The plugin instance is not active.');
    const context: PluginCommandContext = {
      ...(input.assetIds === undefined ? {} : { assetIds: [...input.assetIds] }),
      ...(input.folderIds === undefined ? {} : { folderIds: [...input.folderIds] }),
      ...(input.collectionIds === undefined ? {} : { collectionIds: [...input.collectionIds] }),
    };
    return activeRecord.mode === 'restricted'
      ? this.options.supervisor.invokeCommand({
        instanceId: activeRecord.instanceId,
        commandId: contribution.commandId,
        context,
        timeoutMs: input.timeoutMs ?? PLUGIN_COMMAND_DEFAULT_TIMEOUT_MS,
      })
      : this.options.trustedSupervisor!.invokeCommand({
        instanceId: activeRecord.instanceId,
        commandId: contribution.commandId,
        context,
        timeoutMs: input.timeoutMs ?? PLUGIN_COMMAND_DEFAULT_TIMEOUT_MS,
      });
  }

  validateJobEnqueue(input: {
    instanceId: string;
    handlerId: string;
    recoveryStrategy?: 'idempotent' | 'checkpoint';
  }):
    | { ok: true; recoveryStrategy: 'idempotent' | 'checkpoint' }
    | { ok: false; code: string; message: string } {
    const record = this.findActiveInstance(input.instanceId);
    if (record === undefined) {
      return { ok: false, code: 'INSTANCE_GONE', message: 'The plugin instance is no longer active.' };
    }
    const declared = record.jobs.find((job) => job.localId === input.handlerId);
    if (declared === undefined) {
      return {
        ok: false,
        code: 'JOB_HANDLER_UNDECLARED',
        message: 'This job handler is not declared in the plugin manifest.',
      };
    }
    return {
      ok: true,
      recoveryStrategy: input.recoveryStrategy ?? declared.recovery,
    };
  }

  onPluginInstanceActivated(libraryId: string): void {
    this.options.onInstanceActivated?.({ libraryId });
  }

  async pauseLibraryPluginJobs(libraryId: string): Promise<void> {
    const active = this.#activeByLibrary.get(libraryId);
    if (active === undefined || active.size === 0 || this.options.pausePluginJobs === undefined) return;
    const owners = [...active.values()].map((record) => ({
      pluginId: record.pluginId,
      packageHash: record.packageHash,
    }));
    await this.options.pausePluginJobs({ libraryId, owners });
  }

  #registerContributions(
    libraryId: string,
    instanceId: string,
    pluginId: string,
    pluginPackage: InstalledPluginPackage,
  ): void {
    const registry = this.options.contributions;
    try {
      if (registry !== undefined) {
        registerManifestContributions(registry, {
          pluginInstanceId: instanceId,
          pluginId,
          libraryId,
          contributes: pluginPackage.manifest.contributes,
          mcpExportedCommandIds: getPluginMcpExportedCommandIds(pluginPackage.manifest),
          uiEntryPath: pluginPackage.manifest.ui?.entry,
        });
      }
      for (const provider of pluginPackage.manifest.contributes?.providers ?? []) {
        this.options.providers?.register({
          pluginInstanceId: instanceId,
          libraryId,
          pluginId,
          packageHash: pluginPackage.lock.packageHash,
          providerId: provider.id,
          kind: provider.kind,
          ...(provider.extensions === undefined ? {} : { extensions: provider.extensions }),
          ...(provider.mimeTypes === undefined ? {} : { mimeTypes: provider.mimeTypes }),
          ...(provider.fieldId === undefined ? {} : { fieldId: provider.fieldId }),
          ...(provider.fieldType === undefined ? {} : { fieldType: provider.fieldType }),
        });
      }
      this.options.onContributionsRegistered?.({ libraryId });
    } catch (error) {
      this.options.logger?.error('plugin.activation.contributions', error, { pluginId, instanceId });
      this.#revokeContributions(instanceId);
      throw error;
    }
  }

  #revokeContributions(instanceId: string): void {
    this.options.contributions?.revokePluginInstance(instanceId);
    this.options.providers?.revokePluginInstance(instanceId);
  }

  #deactivateInstance(record: ActiveRecord, reason: PluginRuntimeDeactivateReason): void {
    this.#revokeContributions(record.instanceId);
    if (record.mode === 'restricted') {
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
      void this.pauseLibraryPluginJobs(libraryId).catch((error) => {
        this.options.logger?.error('plugin.jobs.pause-owners', error, { libraryId, reason });
      });
    }
    this.options.supervisor.deactivateLibrary(libraryId, reason);
    this.options.trustedSupervisor?.deactivateLibrary(libraryId, reason);
  }
}
