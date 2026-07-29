import type { PluginCompatibilityTarget, PluginManifest } from '../plugins/plugin-manifest';
import type {
  PluginInstallationScope,
  PluginPackageLock,
  PluginPackageLimits,
  PluginPackageSource,
  PluginResolution,
  PluginTrustDecision,
} from '../plugins/plugin-package';

export type PluginPackageManagerErrorCode =
  | 'PLUGIN_SOURCE_NOT_DIRECTORY'
  | 'PLUGIN_SOURCE_SYMLINK_FORBIDDEN'
  | 'PLUGIN_SOURCE_FILE_TOO_LARGE'
  | 'PLUGIN_SOURCE_READ_FAILED'
  | 'PLUGIN_SOURCE_INVALID_JSON'
  | 'PLUGIN_ARCHIVE_INVALID'
  | 'PLUGIN_PACKAGE_INCOMPATIBLE'
  | 'PLUGIN_PACKAGE_ALREADY_EXISTS'
  | 'PLUGIN_LOCK_INVALID'
  | 'PLUGIN_DEVICE_STATE_INVALID'
  | 'PLUGIN_RESOLUTION_INVALID';

export class PluginPackageManagerError extends Error {
  constructor(
    readonly code: PluginPackageManagerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PluginPackageManagerError';
  }
}

export interface PluginPackageManagerLogger {
  info(scope: string, message: string, context?: Record<string, unknown>): void;
  error(scope: string, error: unknown, context?: Record<string, unknown>): void;
}

export interface PluginPackageManagerOptions extends PluginCompatibilityTarget {
  userDataDirectory: string;
  deviceId: string;
  limits?: PluginPackageLimits;
  logger?: PluginPackageManagerLogger;
}

export interface PluginInstallFromDirectoryInput {
  directory: string;
  scope: PluginInstallationScope;
  libraryDirectory?: string;
  source: PluginPackageSource;
}

export interface PluginInstallFromArchiveInput {
  archive: Uint8Array;
  scope: PluginInstallationScope;
  libraryDirectory?: string;
  source: PluginPackageSource;
}

export interface PluginGitHubClient {
  listTags(repository: string): Promise<Array<{ name: string; commitSha: string }>>;
  defaultBranch(repository: string): Promise<{ name: string; commitSha: string }>;
  downloadArchive(repository: string, ref: string): Promise<{ archive: Uint8Array; commitSha: string }>;
}

export type PluginFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface PluginInstallFromGitHubInput {
  repository: string;
  scope: PluginInstallationScope;
  libraryDirectory?: string;
  client: PluginGitHubClient;
}

export interface InstalledPluginPackage {
  lock: PluginPackageLock;
  manifest: PluginManifest;
  scope: PluginInstallationScope;
  packageDirectory: string;
}

export interface PluginInstallResult {
  package: InstalledPluginPackage;
  packageDirectory: string;
  alreadyInstalled: boolean;
}

export type PluginInstalledPackageStatus =
  | {
    status: 'valid';
    package: InstalledPluginPackage;
    trust: PluginTrustDecision | undefined;
  }
  | {
    status: 'invalid';
    package: PluginPackageLock;
    scope: PluginInstallationScope;
    errorCode: string;
    message: string;
  };

export type PluginResolutionResult =
  | { status: 'disabled'; reason: 'safe-mode' | 'user-disabled' }
  | { status: 'not-installed' }
  | {
    status: 'conflict';
    global: InstalledPluginPackage;
    library: InstalledPluginPackage;
  }
  | {
    status: 'requires-confirmation';
    reason: 'selected-package-unavailable' | 'permissions-increased' | 'runtime-mode-changed' | 'source-changed';
    current: InstalledPluginPackage;
    candidate?: InstalledPluginPackage;
  }
  | {
    status: 'awaiting-trust';
    selection: 'use-library';
    package: InstalledPluginPackage;
    reason: 'untrusted' | 'denied';
  }
  | {
    status: 'resolved';
    selection: 'use-global' | 'use-library';
    package: InstalledPluginPackage;
  };

export type PluginManagerResolutionChoice = Omit<PluginResolution, 'deviceId'>;
