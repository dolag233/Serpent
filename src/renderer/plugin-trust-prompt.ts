import type {
  PluginManagerPackageSummary,
  PluginManagerResolutionSummary,
} from '../shared/plugin-manager-api';

/**
 * Library-scoped plugins that are waiting for an explicit per-device trust
 * decision. Discovery is passive: open library, focus return, or any
 * `plugin-manager.list` refresh after packages appear on disk.
 */
export type PendingLibraryPluginTrust = {
  pluginId: string;
  name: string;
  description: string;
  version: string;
  packageHash: string;
  runtimeMode: 'standard' | 'trusted';
  permissions: readonly string[];
};

export type PluginManagerListSnapshot = {
  packages: readonly PluginManagerPackageSummary[];
  resolutions: readonly PluginManagerResolutionSummary[];
};

export function pendingLibraryPluginTrustKey(
  plugin: Pick<PendingLibraryPluginTrust, 'pluginId' | 'packageHash'>,
): string {
  return `${plugin.pluginId}:${plugin.packageHash}`;
}

/**
 * Collect library plugins that are `awaiting-trust` for reason `untrusted`.
 * Denied plugins are omitted so they are not re-prompted after an explicit no.
 */
export function collectPendingLibraryPluginTrust(
  snapshot: PluginManagerListSnapshot,
): PendingLibraryPluginTrust[] {
  const libraryPackages = new Map<string, PluginManagerPackageSummary>();
  for (const pluginPackage of snapshot.packages) {
    if (pluginPackage.scope !== 'library' || pluginPackage.status !== 'valid') continue;
    libraryPackages.set(
      pendingLibraryPluginTrustKey(pluginPackage),
      pluginPackage,
    );
  }

  const pending: PendingLibraryPluginTrust[] = [];
  for (const resolution of snapshot.resolutions) {
    if (resolution.status !== 'awaiting-trust') continue;
    if (resolution.reason !== 'untrusted') continue;
    if (resolution.selection !== 'use-library') continue;
    const pluginPackage = libraryPackages.get(
      pendingLibraryPluginTrustKey(resolution),
    );
    if (pluginPackage === undefined) continue;
    pending.push({
      pluginId: pluginPackage.pluginId,
      name: pluginPackage.name,
      description: pluginPackage.description,
      version: pluginPackage.version,
      packageHash: pluginPackage.packageHash,
      runtimeMode: pluginPackage.runtimeMode,
      permissions: pluginPackage.permissions,
    });
  }

  return pending.sort((left, right) => left.pluginId.localeCompare(right.pluginId));
}

const DISMISS_STORAGE_KEY = 'serpent.plugin-trust-prompt.dismissed.v1';

type DismissStore = Record<string, string[]>;

function readDismissStore(storage: Storage | undefined): DismissStore {
  if (storage === undefined) return {};
  try {
    const raw = storage.getItem(DISMISS_STORAGE_KEY);
    if (raw === null || raw.trim() === '') return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const store: DismissStore = {};
    for (const [libraryId, keys] of Object.entries(parsed)) {
      if (!Array.isArray(keys)) continue;
      store[libraryId] = keys.filter((entry): entry is string => typeof entry === 'string');
    }
    return store;
  } catch {
    return {};
  }
}

function writeDismissStore(storage: Storage | undefined, store: DismissStore): void {
  if (storage === undefined) return;
  try {
    storage.setItem(DISMISS_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // sessionStorage may be unavailable; prompting again is acceptable.
  }
}

export function filterUndismissedPendingLibraryPlugins(
  libraryId: string,
  pending: readonly PendingLibraryPluginTrust[],
  storage: Storage | undefined = typeof sessionStorage === 'undefined'
    ? undefined
    : sessionStorage,
): PendingLibraryPluginTrust[] {
  const dismissed = new Set(readDismissStore(storage)[libraryId] ?? []);
  return pending.filter((plugin) => !dismissed.has(pendingLibraryPluginTrustKey(plugin)));
}

/** Remember "Later" for this session so the same packages do not re-prompt. */
export function dismissPendingLibraryPluginTrust(
  libraryId: string,
  pending: readonly PendingLibraryPluginTrust[],
  storage: Storage | undefined = typeof sessionStorage === 'undefined'
    ? undefined
    : sessionStorage,
): void {
  if (pending.length === 0) return;
  const store = readDismissStore(storage);
  const existing = new Set(store[libraryId] ?? []);
  for (const plugin of pending) {
    existing.add(pendingLibraryPluginTrustKey(plugin));
  }
  store[libraryId] = [...existing].sort();
  writeDismissStore(storage, store);
}
