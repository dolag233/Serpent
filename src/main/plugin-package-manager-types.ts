import type { PluginCompatibilityTarget, PluginManifest } from '../plugins/plugin-manifest';
import type {
  PluginInstallationScope,
  PluginPackageLock,
  PluginPackageLimits,
  PluginPackageSource,
  PluginQuarantineRecord,
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
  | 'PLUGIN_PLATFORM_ASSET_MISSING'
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
  signal?: AbortSignal;
}

export interface PluginInstallFromArchiveInput {
  archive: Uint8Array;
  scope: PluginInstallationScope;
  libraryDirectory?: string;
  source: PluginPackageSource;
  signal?: AbortSignal;
}

export type PluginGitHubReleaseAsset = {
  name: string;
  browserDownloadUrl: string;
  size: number;
};

export type PluginGitHubRelease = {
  tagName: string;
  draft: boolean;
  prerelease: boolean;
  assets: PluginGitHubReleaseAsset[];
};

export type PluginGitHubDownloadOptions = {
  signal?: AbortSignal;
  waitIfPaused?: () => Promise<void>;
  onPhase?: (phase: 'resolving' | 'downloading' | 'installing') => void;
  onProgress?: (progress: { bytesDownloaded: number; totalBytes?: number }) => void;
};

export type PluginGitHubAvailableUpdate = {
  version: string;
  tag: string;
  assetName: string;
  browserDownloadUrl: string;
  commitSha: string;
};

export interface PluginGitHubClient {
  listTags(repository: string): Promise<Array<{ name: string; commitSha: string }>>;
  defaultBranch(repository: string): Promise<{ name: string; commitSha: string }>;
  listReleases(repository: string): Promise<PluginGitHubRelease[]>;
  downloadReleaseAsset(browserDownloadUrl: string, options?: PluginGitHubDownloadOptions): Promise<Uint8Array>;
  downloadArchive(repository: string, ref: string, options?: PluginGitHubDownloadOptions): Promise<{ archive: Uint8Array; commitSha: string }>;
  commitShaForRef(repository: string, ref: string): Promise<string>;
}

export type PluginFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface PluginInstallFromGitHubInput {
  repository: string;
  scope: PluginInstallationScope;
  libraryDirectory?: string;
  client: PluginGitHubClient;
  /** Prefer Release assets for this host; defaults to process.platform/arch. */
  platformToken?: string;
  signal?: AbortSignal;
  downloadOptions?: PluginGitHubDownloadOptions;
}

export interface PluginGitHubUpdatePreference {
  pluginId: string;
  sourceFingerprint: string;
  autoUpdate: boolean;
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
  | { status: 'disabled'; reason: 'safe-mode'; package?: InstalledPluginPackage }
  | { status: 'disabled'; reason: 'user-disabled' }
  | { status: 'disabled'; reason: 'quarantined'; package: InstalledPluginPackage; quarantine: PluginQuarantineRecord }
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

export type PluginManagerResolutionChoice = Omit<PluginResolution, 'deviceId' | 'updatePolicy'> & {
  updatePolicy?: 'follow-latest' | 'pinned';
  /** When true, mirror use-global / disabled across every library that already resolved this plugin. */
  propagateUserScoped?: boolean;
};
