import { randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { type PluginManifest, parseSemver, pluginIdSchema, validatePluginManifestCompatibility } from '../plugins/plugin-manifest';
import {
  currentPluginPlatformToken,
  isPluginPlatformToken,
  selectPluginReleaseAsset,
  stripSemverTagPrefix,
  type PluginPlatformToken,
} from '../plugins/plugin-release-asset';
import {
  PLUGIN_LIBRARY_LOCK_FILE,
  PLUGIN_LOCK_VERSION,
  defaultPluginPackageLimits,
  pluginLibraryLockSchema,
  pluginQuarantineRecordSchema,
  pluginResolutionSchema,
  pluginTrustDecisionSchema,
  type PluginInstallationScope,
  type PluginPackageLimits,
  type PluginPackageLock,
  type PluginResolution,
  type PluginQuarantineRecord,
  type PluginTrustDecision,
  verifyPluginPackageLock,
} from '../plugins/plugin-package';
import { compareSemver } from '../plugins/plugin-manifest';
import {
  copyInspectedPluginFiles,
  extractPluginArchive,
  inspectPluginDirectory,
} from './plugin-package-archive';
import { parseGitHubRepositoryUrl } from '../shared/plugin-github-url';
import {
  type InstalledPluginPackage,
  type PluginGitHubAvailableUpdate,
  type PluginGitHubClient,
  type PluginInstallFromArchiveInput,
  type PluginInstallFromDirectoryInput,
  type PluginInstallFromGitHubInput,
  type PluginInstallResult,
  type PluginInstalledPackageStatus,
  type PluginPackageManagerLogger,
  type PluginPackageManagerOptions,
  type PluginManagerResolutionChoice,
  type PluginResolutionResult,
  PluginPackageManagerError,
} from './plugin-package-manager-types';

export {
  createGitHubPluginClient,
} from './plugin-github-client';
export {
  parseGitHubRepositoryUrl,
  isGitHubPluginInstallUrl,
} from '../shared/plugin-github-url';
export {
  type InstalledPluginPackage,
  type PluginFetch,
  type PluginGitHubAvailableUpdate,
  type PluginGitHubClient,
  type PluginGitHubRelease,
  type PluginInstallFromArchiveInput,
  type PluginInstallFromDirectoryInput,
  type PluginInstallFromGitHubInput,
  type PluginInstallResult,
  type PluginInstalledPackageStatus,
  type PluginPackageManagerErrorCode,
  PluginPackageManagerError,
  type PluginPackageManagerLogger,
  type PluginPackageManagerOptions,
  type PluginResolutionResult,
} from './plugin-package-manager-types';
export {
  currentPluginPlatformToken,
  parsePluginReleaseAssetFileName,
  selectPluginReleaseAsset,
  type PluginPlatformToken,
} from '../plugins/plugin-release-asset';


const DEVICE_STATE_FILE_NAME = 'plugin-device-state.json';
const USER_PLUGIN_LOCK_FILE_NAME = 'plugin-lock.json';
const DEVICE_STATE_VERSION = 1 as const;
const PLUGIN_CRASH_QUARANTINE_THRESHOLD = 3;
const PLUGIN_CRASH_QUARANTINE_WINDOW_MS = 5 * 60 * 1_000;

const deviceStateSchema = z.strictObject({
  version: z.literal(DEVICE_STATE_VERSION),
  safeMode: z.boolean(),
  trustDecisions: z.array(pluginTrustDecisionSchema).max(20_000),
  resolutions: z.array(pluginResolutionSchema).max(20_000),
  quarantines: z.array(pluginQuarantineRecordSchema).max(20_000).default([]),
  updatePreferences: z.array(z.strictObject({
    pluginId: pluginIdSchema,
    sourceFingerprint: z.string().min(1).max(1_024),
    autoUpdate: z.boolean(),
  })).max(20_000).default([]),
});
type PluginDeviceState = z.infer<typeof deviceStateSchema>;

function emptyDeviceState(): PluginDeviceState {
  return {
    version: DEVICE_STATE_VERSION,
    safeMode: false,
    trustDecisions: [],
    resolutions: [],
    quarantines: [],
    updatePreferences: [],
  };
}

function directoryPathForPackage(root: string, lock: PluginPackageLock): string {
  return path.join(root, lock.pluginId, lock.version);
}

function compareVersions(left: InstalledPluginPackage, right: InstalledPluginPackage): number {
  const leftVersion = parseSemver(left.lock.version);
  const rightVersion = parseSemver(right.lock.version);
  if (leftVersion === undefined || rightVersion === undefined) return 0;
  return compareSemver(rightVersion, leftVersion);
}

function isPermissionIncrease(current: PluginManifest, candidate: PluginManifest): boolean {
  const currentPermissions = new Set(current.permissions);
  return candidate.permissions.some((permission) => !currentPermissions.has(permission));
}

function packageOriginChanged(current: InstalledPluginPackage, candidate: InstalledPluginPackage):
  | 'permissions-increased'
  | 'runtime-mode-changed'
  | 'source-changed'
  | undefined {
  if (current.lock.sourceFingerprint !== candidate.lock.sourceFingerprint) return 'source-changed';
  if (current.manifest.runtime.mode !== candidate.manifest.runtime.mode) return 'runtime-mode-changed';
  if (isPermissionIncrease(current.manifest, candidate.manifest)) return 'permissions-increased';
  return undefined;
}

/**
 * Main-owned installer and activation-preflight store. It deliberately never
 * imports a plugin entrypoint: every operation stops at verified bytes, lock
 * metadata, per-device trust and deterministic resolution.
 */
export class PluginPackageManager {
  readonly #limits: PluginPackageLimits;
  readonly #logger: PluginPackageManagerLogger | undefined;

  constructor(private readonly options: PluginPackageManagerOptions) {
    this.#limits = options.limits ?? defaultPluginPackageLimits;
    this.#logger = options.logger;
  }

  async installFromDirectory(input: PluginInstallFromDirectoryInput): Promise<PluginInstallResult> {
    const root = this.#packageStoreRoot(input.scope, input.libraryDirectory);
    const inspectedSource = await inspectPluginDirectory(input.directory, input.source, this.#limits);
    this.#assertCompatible(inspectedSource.manifest);

    await mkdir(root, { recursive: true });
    const targetDirectory = directoryPathForPackage(root, inspectedSource.lock);
    const existing = await this.#readInstalledAt(targetDirectory, input.scope, inspectedSource.lock);
    if (existing !== undefined) {
      if (existing.status === 'valid' && existing.package.lock.packageHash === inspectedSource.lock.packageHash) {
        return { package: existing.package, packageDirectory: targetDirectory, alreadyInstalled: true };
      }
      throw new PluginPackageManagerError(
        'PLUGIN_PACKAGE_ALREADY_EXISTS',
        'A different package already exists for this plugin id and version. Install a new version instead of overwriting it.',
      );
    }

    const stagingDirectory = path.join(root, `.staging-${randomUUID()}`);
    try {
      await mkdir(stagingDirectory, { recursive: false });
      await copyInspectedPluginFiles(input.directory, stagingDirectory, inspectedSource.snapshot.files);
      const staged = await inspectPluginDirectory(stagingDirectory, input.source, this.#limits);
      if (staged.lock.packageHash !== inspectedSource.lock.packageHash
        || staged.lock.manifestSha256 !== inspectedSource.lock.manifestSha256) {
        throw new PluginPackageManagerError(
          'PLUGIN_SOURCE_READ_FAILED',
          'Plugin source bytes changed while the package was being installed.',
        );
      }
      await mkdir(path.dirname(targetDirectory), { recursive: true });
      await rename(stagingDirectory, targetDirectory);
      try {
        await this.#upsertPackageLock(input.scope, input.libraryDirectory, staged.lock);
      } catch (error) {
        await rm(targetDirectory, { recursive: true, force: true });
        throw error;
      }
      const installed: InstalledPluginPackage = {
        lock: staged.lock,
        manifest: staged.manifest,
        scope: input.scope,
        packageDirectory: targetDirectory,
      };
      this.#logger?.info('plugin.install', 'Installed verified plugin package.', {
        pluginId: staged.lock.pluginId,
        version: staged.lock.version,
        scope: input.scope,
      });
      return { package: installed, packageDirectory: targetDirectory, alreadyInstalled: false };
    } catch (error) {
      await rm(stagingDirectory, { recursive: true, force: true });
      this.#logger?.error('plugin.install', error, { scope: input.scope });
      throw error;
    }
  }

  async installFromArchive(input: PluginInstallFromArchiveInput): Promise<PluginInstallResult> {
    if (input.archive.byteLength > this.#limits.maxArchiveBytes) {
      throw new PluginPackageManagerError('PLUGIN_ARCHIVE_INVALID', 'The plugin archive exceeds the maximum allowed size.');
    }
    const root = this.#packageStoreRoot(input.scope, input.libraryDirectory);
    const extractionDirectory = path.join(root, `.archive-staging-${randomUUID()}`);
    try {
      await mkdir(extractionDirectory, { recursive: true });
      await extractPluginArchive(input.archive, extractionDirectory, this.#limits);
      try {
        return await this.installFromDirectory({
          directory: extractionDirectory,
          scope: input.scope,
          libraryDirectory: input.libraryDirectory,
          source: input.source,
        });
      } catch (error) {
        if (error instanceof PluginPackageManagerError && [
          'PLUGIN_SOURCE_NOT_DIRECTORY',
          'PLUGIN_SOURCE_SYMLINK_FORBIDDEN',
          'PLUGIN_SOURCE_FILE_TOO_LARGE',
          'PLUGIN_SOURCE_READ_FAILED',
          'PLUGIN_SOURCE_INVALID_JSON',
        ].includes(error.code)) {
          throw new PluginPackageManagerError('PLUGIN_ARCHIVE_INVALID', 'The plugin archive does not contain a valid plugin package.');
        }
        throw error;
      }
    } finally {
      await rm(extractionDirectory, { recursive: true, force: true });
    }
  }

  async installFromGitHub(input: PluginInstallFromGitHubInput): Promise<PluginInstallResult> {
    let parsed;
    try {
      parsed = parseGitHubRepositoryUrl(input.repository);
    } catch (error) {
      throw new PluginPackageManagerError(
        'PLUGIN_ARCHIVE_INVALID',
        error instanceof Error ? error.message : 'Plugin installation requires a valid GitHub repository URL.',
      );
    }
    const repository = parsed.repository;
    const platformToken = this.#resolvePlatformToken(input.platformToken);
    const releaseInstall = await this.#tryInstallFromGitHubRelease({
      repository,
      preferredTag: parsed.preferredTag,
      scope: input.scope,
      libraryDirectory: input.libraryDirectory,
      client: input.client,
      platformToken,
    });
    if (releaseInstall !== undefined) return releaseInstall;

    this.#logger?.info('plugin.install.github', 'No matching Release asset; falling back to source archive for already-built packages.', {
      repository,
      platformToken,
    });
    return this.#installFromGitHubZipballFallback({
      repository,
      preferredTag: parsed.preferredTag,
      scope: input.scope,
      libraryDirectory: input.libraryDirectory,
      client: input.client,
    });
  }

  /**
   * Looks for a newer stable Release with a matching platform (or `any`) asset.
   */
  async findGitHubAvailableUpdate(input: {
    package: InstalledPluginPackage;
    client: PluginGitHubClient;
    platformToken?: string;
  }): Promise<PluginGitHubAvailableUpdate | undefined> {
    const source = input.package.lock.source;
    if (source.kind !== 'github') return undefined;
    const platformToken = this.#resolvePlatformToken(input.platformToken);
    const currentVersion = parseSemver(input.package.lock.version);
    if (currentVersion === undefined) return undefined;
    const releases = await input.client.listReleases(source.repository);
    const candidates = this.#stableSemverReleases(releases)
      .filter((entry) => compareSemver(entry.version, currentVersion) > 0);
    for (const candidate of candidates) {
      const asset = selectPluginReleaseAsset(candidate.release.assets, platformToken, {
        pluginId: input.package.lock.pluginId,
        version: stripSemverTagPrefix(candidate.release.tagName),
      }) ?? selectPluginReleaseAsset(candidate.release.assets, platformToken, {
        pluginId: input.package.lock.pluginId,
      });
      if (asset === undefined) continue;
      const commitSha = await input.client.commitShaForRef(source.repository, candidate.release.tagName);
      return {
        version: stripSemverTagPrefix(candidate.release.tagName),
        tag: candidate.release.tagName,
        assetName: asset.name,
        browserDownloadUrl: asset.browserDownloadUrl,
        commitSha,
      };
    }
    return undefined;
  }

  async applyGitHubUpdateForLock(input: {
    scope: PluginInstallationScope;
    libraryDirectory?: string;
    pluginId: string;
    packageHash: string;
    client: PluginGitHubClient;
    platformToken?: string;
  }): Promise<PluginInstallResult> {
    const installed = await this.listInstalled({
      scope: input.scope,
      libraryDirectory: input.libraryDirectory,
    });
    const match = installed.find((entry) => entry.status === 'valid'
      && entry.package.lock.pluginId === input.pluginId
      && entry.package.lock.packageHash === input.packageHash);
    if (match === undefined || match.status !== 'valid') {
      throw new PluginPackageManagerError('PLUGIN_RESOLUTION_INVALID', 'Cannot update a package that is not installed and verified.');
    }
    const source = match.package.lock.source;
    if (source.kind !== 'github') {
      throw new PluginPackageManagerError('PLUGIN_ARCHIVE_INVALID', 'Only GitHub-installed plugins can check for updates.');
    }
    const available = await this.findGitHubAvailableUpdate({
      package: match.package,
      client: input.client,
      platformToken: input.platformToken,
    });
    if (available === undefined) {
      throw new PluginPackageManagerError('PLUGIN_ARCHIVE_INVALID', 'No newer compatible GitHub Release asset is available.');
    }
    const archive = await input.client.downloadReleaseAsset(available.browserDownloadUrl);
    return this.installFromArchive({
      archive,
      scope: input.scope,
      libraryDirectory: input.libraryDirectory,
      source: {
        kind: 'github',
        repository: source.repository,
        ref: available.tag,
        commitSha: available.commitSha,
        fingerprint: source.fingerprint,
      },
    });
  }

  async getAutoUpdatePreference(input: {
    pluginId: string;
    sourceFingerprint: string;
  }): Promise<boolean> {
    const state = await this.#readDeviceState();
    return state.updatePreferences.find((entry) => entry.pluginId === input.pluginId
      && entry.sourceFingerprint === input.sourceFingerprint)?.autoUpdate ?? false;
  }

  async setAutoUpdatePreference(input: {
    pluginId: string;
    sourceFingerprint: string;
    autoUpdate: boolean;
  }): Promise<void> {
    const state = await this.#readDeviceState();
    state.updatePreferences = state.updatePreferences.filter((entry) => !(entry.pluginId === input.pluginId
      && entry.sourceFingerprint === input.sourceFingerprint));
    if (input.autoUpdate) {
      state.updatePreferences.push({
        pluginId: input.pluginId,
        sourceFingerprint: input.sourceFingerprint,
        autoUpdate: true,
      });
    }
    await this.#writeDeviceState(state);
  }

  /**
   * Downloads and installs eligible GitHub updates when auto-update is on and
   * the resolution is not pinned. Permission / runtime-mode / source changes
   * still surface through resolve() as requires-confirmation.
   */
  async applyEligibleGitHubAutoUpdates(input: {
    scope: PluginInstallationScope;
    libraryDirectory?: string;
    libraryId?: string;
    client: PluginGitHubClient;
    platformToken?: string;
  }): Promise<PluginInstallResult[]> {
    const installed = await this.listInstalled({
      scope: input.scope,
      libraryDirectory: input.libraryDirectory,
    });
    const state = await this.#readDeviceState();
    const applied: PluginInstallResult[] = [];
    for (const entry of installed) {
      if (entry.status !== 'valid' || entry.package.lock.source.kind !== 'github') continue;
      const preference = state.updatePreferences.find((item) => item.pluginId === entry.package.lock.pluginId
        && item.sourceFingerprint === entry.package.lock.sourceFingerprint);
      if (preference?.autoUpdate !== true) continue;
      if (input.libraryId !== undefined) {
        const resolution = state.resolutions.find((item) => item.libraryId === input.libraryId
          && item.pluginId === entry.package.lock.pluginId);
        if (resolution?.updatePolicy === 'pinned') continue;
      }
      const available = await this.findGitHubAvailableUpdate({
        package: entry.package,
        client: input.client,
        platformToken: input.platformToken,
      });
      if (available === undefined) continue;
      const result = await this.applyGitHubUpdateForLock({
        scope: input.scope,
        libraryDirectory: input.libraryDirectory,
        pluginId: entry.package.lock.pluginId,
        packageHash: entry.package.lock.packageHash,
        client: input.client,
        platformToken: input.platformToken,
      });
      applied.push(result);
    }
    return applied;
  }

  async #tryInstallFromGitHubRelease(input: {
    repository: string;
    preferredTag?: string;
    scope: PluginInstallationScope;
    libraryDirectory?: string;
    client: PluginGitHubClient;
    platformToken: PluginPlatformToken;
  }): Promise<PluginInstallResult | undefined> {
    let releases: Awaited<ReturnType<PluginGitHubClient['listReleases']>>;
    try {
      releases = await input.client.listReleases(input.repository);
    } catch (error) {
      if (error instanceof PluginPackageManagerError && error.code === 'PLUGIN_ARCHIVE_INVALID') {
        return undefined;
      }
      throw error;
    }
    const ordered = this.#orderedReleaseCandidates(releases, input.preferredTag);
    if (ordered.length === 0) return undefined;

    let sawAnyNormativeAsset = false;
    let lastCompatibilityFailure: unknown;
    let missingPlatform = false;
    for (const candidate of ordered) {
      const version = stripSemverTagPrefix(candidate.tagName);
      const asset = selectPluginReleaseAsset(candidate.assets, input.platformToken, { version })
        ?? selectPluginReleaseAsset(candidate.assets, input.platformToken);
      if (asset === undefined) {
        if (candidate.assets.some((item) => selectPluginReleaseAsset([item], 'any') !== undefined
          || selectPluginReleaseAsset([item], input.platformToken) !== undefined
          || /-[a-z0-9][a-z0-9-]*\.zip$/u.test(item.name))) {
          // Has other platform zips but not ours.
          if (candidate.assets.some((item) => /\.zip$/iu.test(item.name))) missingPlatform = true;
        }
        continue;
      }
      sawAnyNormativeAsset = true;
      const [archive, commitSha] = await Promise.all([
        input.client.downloadReleaseAsset(asset.browserDownloadUrl),
        input.client.commitShaForRef(input.repository, candidate.tagName),
      ]);
      try {
        return await this.installFromArchive({
          archive,
          scope: input.scope,
          libraryDirectory: input.libraryDirectory,
          source: {
            kind: 'github',
            repository: input.repository,
            ref: candidate.tagName,
            commitSha,
            fingerprint: `github:${input.repository}`,
          },
        });
      } catch (error) {
        if (error instanceof PluginPackageManagerError && error.code === 'PLUGIN_PACKAGE_INCOMPATIBLE') {
          lastCompatibilityFailure = error;
          continue;
        }
        throw error;
      }
    }

    if (sawAnyNormativeAsset && lastCompatibilityFailure instanceof Error) {
      throw lastCompatibilityFailure;
    }
    if (missingPlatform && ordered.every((release) => selectPluginReleaseAsset(release.assets, input.platformToken) === undefined
      && selectPluginReleaseAsset(release.assets, 'any') === undefined)) {
      throw new PluginPackageManagerError(
        'PLUGIN_PLATFORM_ASSET_MISSING',
        `No plugin Release ZIP matches this platform (${input.platformToken}). Authors must publish {pluginId}-{version}-{platform}.zip or -any.zip.`,
      );
    }
    return undefined;
  }

  async #installFromGitHubZipballFallback(input: {
    repository: string;
    preferredTag?: string;
    scope: PluginInstallationScope;
    libraryDirectory?: string;
    client: PluginGitHubClient;
  }): Promise<PluginInstallResult> {
    const tags = await input.client.listTags(input.repository);
    const compatibleTags = tags
      .flatMap((tag) => {
        const version = parseSemver(stripSemverTagPrefix(tag.name));
        return version === undefined ? [] : [{ ...tag, version }];
      })
      .sort((left, right) => compareSemver(right.version, left.version));
    const preferred = input.preferredTag === undefined
      ? undefined
      : compatibleTags.find((tag) => tag.name === input.preferredTag
        || stripSemverTagPrefix(tag.name) === stripSemverTagPrefix(input.preferredTag!));
    const candidates = preferred !== undefined
      ? [{ ref: preferred.name, expectedCommit: preferred.commitSha }]
      : compatibleTags.length > 0
        ? compatibleTags.map((tag) => ({ ref: tag.name, expectedCommit: tag.commitSha }))
        : [await input.client.defaultBranch(input.repository).then((branch) => ({
          ref: branch.name,
          expectedCommit: branch.commitSha,
        }))];

    let lastCompatibilityFailure: unknown;
    for (const candidate of candidates) {
      const downloaded = await input.client.downloadArchive(input.repository, candidate.ref);
      if (!/^[a-f0-9]{40,64}$/u.test(downloaded.commitSha)) {
        throw new PluginPackageManagerError('PLUGIN_ARCHIVE_INVALID', 'GitHub returned an invalid commit SHA for the plugin archive.');
      }
      try {
        return await this.installFromArchive({
          archive: downloaded.archive,
          scope: input.scope,
          libraryDirectory: input.libraryDirectory,
          source: {
            kind: 'github',
            repository: input.repository,
            ref: candidate.ref,
            commitSha: downloaded.commitSha,
            fingerprint: `github:${input.repository}`,
          },
        });
      } catch (error) {
        if (error instanceof PluginPackageManagerError && error.code === 'PLUGIN_PACKAGE_INCOMPATIBLE') {
          lastCompatibilityFailure = error;
          continue;
        }
        throw error;
      }
    }
    throw lastCompatibilityFailure instanceof Error
      ? lastCompatibilityFailure
      : new PluginPackageManagerError('PLUGIN_PACKAGE_INCOMPATIBLE', 'No compatible plugin tag is available.');
  }

  #resolvePlatformToken(explicit: string | undefined): PluginPlatformToken {
    if (explicit !== undefined) {
      if (!isPluginPlatformToken(explicit)) {
        throw new PluginPackageManagerError('PLUGIN_ARCHIVE_INVALID', `Unsupported plugin platform token: ${explicit}`);
      }
      return explicit;
    }
    const fromOptions = `${this.options.platform}-${this.options.arch}`;
    if (isPluginPlatformToken(fromOptions)) return fromOptions;
    return currentPluginPlatformToken();
  }

  #stableSemverReleases(releases: Awaited<ReturnType<PluginGitHubClient['listReleases']>>) {
    return releases
      .filter((release) => !release.draft && !release.prerelease)
      .flatMap((release) => {
        const version = parseSemver(stripSemverTagPrefix(release.tagName));
        return version === undefined ? [] : [{ release, version }];
      })
      .sort((left, right) => compareSemver(right.version, left.version));
  }

  #orderedReleaseCandidates(
    releases: Awaited<ReturnType<PluginGitHubClient['listReleases']>>,
    preferredTag: string | undefined,
  ) {
    const stable = this.#stableSemverReleases(releases).map((entry) => entry.release);
    if (preferredTag === undefined) return stable;
    const preferred = releases.find((release) => !release.draft
      && (release.tagName === preferredTag
        || stripSemverTagPrefix(release.tagName) === stripSemverTagPrefix(preferredTag)));
    if (preferred === undefined) return stable;
    return [preferred, ...stable.filter((release) => release.tagName !== preferred.tagName)];
  }

  async listInstalled(input: {
    scope: PluginInstallationScope;
    libraryDirectory?: string;
  }): Promise<PluginInstalledPackageStatus[]> {
    const locks = await this.#readPackageLocks(input.scope, input.libraryDirectory);
    const root = this.#packageStoreRoot(input.scope, input.libraryDirectory);
    const deviceState = await this.#readDeviceState();
    const installed: PluginInstalledPackageStatus[] = [];
    for (const lock of locks) {
      const packageDirectory = directoryPathForPackage(root, lock);
      const verified = await this.#readInstalledAt(packageDirectory, input.scope, lock);
      if (verified === undefined) {
        installed.push({
          status: 'invalid',
          package: lock,
          scope: input.scope,
          errorCode: 'PLUGIN_PACKAGE_INTEGRITY_MISMATCH',
          message: 'The package directory recorded in the plugin lock is missing.',
        });
        continue;
      }
      if (verified.status === 'invalid') {
        installed.push(verified);
        continue;
      }
      const trust = deviceState.trustDecisions.find((decision) => decision.pluginId === lock.pluginId
        && decision.packageHash === lock.packageHash
        && decision.sourceFingerprint === lock.sourceFingerprint
        && decision.runtimeMode === verified.package.manifest.runtime.mode);
      installed.push({ status: 'valid', package: verified.package, trust });
    }
    return installed.sort((left, right) => {
      const leftLock = left.status === 'valid' ? left.package.lock : left.package;
      const rightLock = right.status === 'valid' ? right.package.lock : right.package;
      const leftId = leftLock.pluginId;
      const rightId = rightLock.pluginId;
      if (leftId !== rightId) return leftId.localeCompare(rightId);
      return leftLock.version.localeCompare(rightLock.version);
    });
  }

  async recordTrust(input: {
    package: InstalledPluginPackage;
    decision: 'trusted' | 'denied';
  }): Promise<PluginTrustDecision> {
    const state = await this.#readDeviceState();
    const record = pluginTrustDecisionSchema.parse({
      deviceId: this.options.deviceId,
      pluginId: input.package.lock.pluginId,
      packageHash: input.package.lock.packageHash,
      sourceFingerprint: input.package.lock.sourceFingerprint,
      runtimeMode: input.package.manifest.runtime.mode,
      permissions: input.package.manifest.permissions,
      decision: input.decision,
      decidedAt: new Date().toISOString(),
    });
    state.trustDecisions = state.trustDecisions.filter((decision) => !(decision.pluginId === record.pluginId
      && decision.packageHash === record.packageHash
      && decision.sourceFingerprint === record.sourceFingerprint));
    state.trustDecisions.push(record);
    await this.#writeDeviceState(state);
    return record;
  }

  async chooseResolution(input: PluginManagerResolutionChoice): Promise<PluginResolution> {
    const resolution = pluginResolutionSchema.parse({
      ...input,
      deviceId: this.options.deviceId,
      updatePolicy: input.updatePolicy ?? 'follow-latest',
    });
    const state = await this.#readDeviceState();
    state.resolutions = state.resolutions.filter((candidate) => !(candidate.libraryId === resolution.libraryId
      && candidate.pluginId === resolution.pluginId));
    state.resolutions.push(resolution);
    await this.#writeDeviceState(state);
    return resolution;
  }

  async setSafeMode(enabled: boolean): Promise<void> {
    const state = await this.#readDeviceState();
    state.safeMode = enabled;
    await this.#writeDeviceState(state);
  }

  async getSafeMode(): Promise<boolean> {
    return (await this.#readDeviceState()).safeMode;
  }

  /**
   * Records a supervised plugin-process crash. The supervisor is the only
   * caller: this API deliberately is not exposed to Renderer or plugin code.
   * Three crashes in a short window quarantine only this package for this
   * library on this device, so opening another library remains possible.
   */
  async recordRuntimeCrash(input: {
    libraryId: string;
    libraryDirectory: string;
    pluginId: string;
    packageHash: string;
    failureCode: string;
    occurredAt?: Date;
  }): Promise<PluginQuarantineRecord> {
    const occurredAt = input.occurredAt ?? new Date();
    const occurredAtIso = occurredAt.toISOString();
    const failureCode = input.failureCode.trim().toUpperCase();
    const validFailureCode = z.string().min(1).max(128).regex(/^[A-Z0-9_:-]+$/u).safeParse(failureCode);
    if (!validFailureCode.success) {
      throw new PluginPackageManagerError('PLUGIN_RESOLUTION_INVALID', 'Plugin crash reports require a stable error code.');
    }
    const packages = await Promise.all([
      this.#validPackages('user'),
      this.#validPackages('library', input.libraryDirectory),
    ]);
    if (!packages.flat().some((pluginPackage) => pluginPackage.lock.pluginId === input.pluginId
      && pluginPackage.lock.packageHash === input.packageHash)) {
      throw new PluginPackageManagerError('PLUGIN_RESOLUTION_INVALID', 'Cannot quarantine a package that is not installed and verified.');
    }

    const state = await this.#readDeviceState();
    const previous = state.quarantines.find((record) => record.libraryId === input.libraryId
      && record.pluginId === input.pluginId
      && record.packageHash === input.packageHash);
    const previousFailureAt = previous === undefined ? undefined : Date.parse(previous.lastFailureAt);
    const continuingRecord = previous !== undefined && previousFailureAt !== undefined
      && Number.isFinite(previousFailureAt)
      && occurredAt.getTime() >= previousFailureAt
      && occurredAt.getTime() - previousFailureAt <= PLUGIN_CRASH_QUARANTINE_WINDOW_MS
      ? previous
      : undefined;
    const failureCount = continuingRecord === undefined ? 1 : continuingRecord.failureCount + 1;
    const record = pluginQuarantineRecordSchema.parse({
      deviceId: this.options.deviceId,
      libraryId: input.libraryId,
      pluginId: input.pluginId,
      packageHash: input.packageHash,
      failureCount,
      firstFailureAt: continuingRecord?.firstFailureAt ?? occurredAtIso,
      lastFailureAt: occurredAtIso,
      lastFailureCode: validFailureCode.data,
      ...(failureCount >= PLUGIN_CRASH_QUARANTINE_THRESHOLD ? { quarantinedAt: occurredAtIso } : {}),
    });
    state.quarantines = state.quarantines.filter((candidate) => !(candidate.libraryId === record.libraryId
      && candidate.pluginId === record.pluginId
      && candidate.packageHash === record.packageHash));
    state.quarantines.push(record);
    await this.#writeDeviceState(state);
    this.#logger?.error('plugin.quarantine', new Error('Plugin runtime crashed.'), {
      libraryId: input.libraryId,
      pluginId: input.pluginId,
      packageHash: input.packageHash,
      failureCode: validFailureCode.data,
      failureCount,
      quarantined: record.quarantinedAt !== undefined,
    });
    return record;
  }

  async clearRuntimeQuarantine(input: {
    libraryId: string;
    pluginId: string;
    packageHash?: string;
  }): Promise<void> {
    const state = await this.#readDeviceState();
    state.quarantines = state.quarantines.filter((record) => !(record.libraryId === input.libraryId
      && record.pluginId === input.pluginId
      && (input.packageHash === undefined || record.packageHash === input.packageHash)));
    await this.#writeDeviceState(state);
    this.#logger?.info('plugin.quarantine-cleared', 'Cleared the local plugin crash quarantine.', {
      libraryId: input.libraryId,
      pluginId: input.pluginId,
      ...(input.packageHash === undefined ? {} : { packageHash: input.packageHash }),
    });
  }

  /**
   * Pins the current scope to its immediately preceding verified package.
   * Package bytes remain immutable; rollback only changes this device's
   * resolution and never edits the synchronized library lock.
   */
  async rollback(input: {
    libraryId: string;
    libraryDirectory: string;
    pluginId: string;
  }): Promise<InstalledPluginPackage> {
    const state = await this.#readDeviceState();
    const [globalPackages, libraryPackages] = await Promise.all([
      this.#validPackages('user'),
      this.#validPackages('library', input.libraryDirectory),
    ]);
    const saved = state.resolutions.find((resolution) => resolution.libraryId === input.libraryId
      && resolution.pluginId === input.pluginId);
    const selection = saved?.selection ?? (globalPackages.some((candidate) => candidate.lock.pluginId === input.pluginId)
      ? 'use-global'
      : 'use-library');
    if (selection === 'disabled') {
      throw new PluginPackageManagerError('PLUGIN_RESOLUTION_INVALID', 'A disabled plugin does not have a version to roll back.');
    }
    const candidates = (selection === 'use-global' ? globalPackages : libraryPackages)
      .filter((candidate) => candidate.lock.pluginId === input.pluginId)
      .sort(compareVersions);
    const currentIndex = saved?.packageHash === undefined
      ? 0
      : candidates.findIndex((candidate) => candidate.lock.packageHash === saved.packageHash);
    const target = candidates[(currentIndex < 0 ? 0 : currentIndex) + 1];
    if (target === undefined) {
      throw new PluginPackageManagerError('PLUGIN_RESOLUTION_INVALID', 'No previous verified plugin version is available to roll back to.');
    }
    await this.chooseResolution({
      libraryId: input.libraryId,
      pluginId: input.pluginId,
      selection,
      packageHash: target.lock.packageHash,
      updatePolicy: 'pinned',
    });
    this.#logger?.info('plugin.rollback', 'Pinned plugin resolution to its previous verified package.', {
      libraryId: input.libraryId,
      pluginId: input.pluginId,
      version: target.lock.version,
      scope: target.scope,
    });
    return target;
  }

  /**
   * Removal first detaches the package from the lock, so a crash can leave only
   * harmless orphan bytes. It never leaves a lock that activates missing code.
   */
  async uninstall(input: {
    scope: PluginInstallationScope;
    libraryDirectory?: string;
    libraryId?: string;
    pluginId: string;
    version: string;
  }): Promise<void> {
    const locks = await this.#readPackageLocks(input.scope, input.libraryDirectory);
    const removed = locks.find((lock) => lock.pluginId === input.pluginId && lock.version === input.version);
    if (removed === undefined) return;
    await this.#writePackageLocks(
      input.scope,
      input.libraryDirectory,
      locks.filter((lock) => lock !== removed),
    );
    await rm(directoryPathForPackage(this.#packageStoreRoot(input.scope, input.libraryDirectory), removed), {
      recursive: true,
      force: true,
    });
    const state = await this.#readDeviceState();
    state.trustDecisions = state.trustDecisions.filter((decision) => decision.packageHash !== removed.packageHash);
    if (input.libraryId !== undefined) {
      state.resolutions = state.resolutions.map((resolution) => resolution.libraryId === input.libraryId
        && resolution.pluginId === input.pluginId
        && resolution.packageHash === removed.packageHash
        ? {
          ...resolution,
          selection: 'disabled' as const,
          packageHash: undefined,
          updatePolicy: 'follow-latest' as const,
        }
        : resolution);
    }
    await this.#writeDeviceState(state);
  }

  async resolve(input: {
    libraryId: string;
    libraryDirectory: string;
    pluginId: string;
  }): Promise<PluginResolutionResult> {
    const state = await this.#readDeviceState();

    const [globalPackages, libraryPackages] = await Promise.all([
      this.#validPackages('user'),
      this.#validPackages('library', input.libraryDirectory),
    ]);
    const global = this.#highestVersion(globalPackages.filter((candidate) => candidate.lock.pluginId === input.pluginId));
    const library = this.#highestVersion(libraryPackages.filter((candidate) => candidate.lock.pluginId === input.pluginId));
    if (global === undefined && library === undefined) return { status: 'not-installed' };

    const saved = state.resolutions.find((resolution) => resolution.libraryId === input.libraryId
      && resolution.pluginId === input.pluginId);
    if (saved?.selection === 'disabled') return { status: 'disabled', reason: 'user-disabled' };
    if (global !== undefined && library !== undefined && saved === undefined) {
      return { status: 'conflict', global, library };
    }

    const selection = saved?.selection ?? (global === undefined ? 'use-library' : 'use-global');
    const candidates = selection === 'use-global' ? globalPackages : libraryPackages;
    const latest = this.#highestVersion(candidates.filter((candidate) => candidate.lock.pluginId === input.pluginId));
    if (latest === undefined) {
      const current = saved?.packageHash === undefined
        ? (global ?? library)
        : [...globalPackages, ...libraryPackages].find((candidate) => candidate.lock.packageHash === saved.packageHash)
          ?? global
          ?? library;
      if (current === undefined) return { status: 'not-installed' };
      return { status: 'requires-confirmation', reason: 'selected-package-unavailable', current };
    }

    // Unrestricted packages stay off until the user explicitly enables them.
    if (saved === undefined && latest.manifest.runtime.mode === 'unrestricted') {
      return { status: 'disabled', reason: 'user-disabled' };
    }

    const current = saved?.packageHash === undefined
      ? latest
      : candidates.find((candidate) => candidate.lock.packageHash === saved.packageHash);
    if (current === undefined) {
      return { status: 'requires-confirmation', reason: 'selected-package-unavailable', current: latest };
    }
    if (current.lock.packageHash !== latest.lock.packageHash) {
      if (saved?.updatePolicy === 'pinned') {
        return this.#resolvedOrAwaitingTrust(state, input.libraryId, selection, current);
      }
      const reason = packageOriginChanged(current, latest);
      if (reason !== undefined) return { status: 'requires-confirmation', reason, current, candidate: latest };
      await this.chooseResolution({
        libraryId: input.libraryId,
        pluginId: input.pluginId,
        selection,
        packageHash: latest.lock.packageHash,
      });
      return this.#resolvedOrAwaitingTrust(state, input.libraryId, selection, latest);
    }
    return this.#resolvedOrAwaitingTrust(state, input.libraryId, selection, current);
  }

  #packageStoreRoot(scope: PluginInstallationScope, libraryDirectory?: string): string {
    if (scope === 'user') return path.join(this.options.userDataDirectory, 'plugins');
    if (libraryDirectory === undefined || libraryDirectory.trim() === '') {
      throw new PluginPackageManagerError('PLUGIN_SOURCE_READ_FAILED', 'A library plugin operation requires a library directory.');
    }
    return path.join(libraryDirectory, '.serpent', 'plugins');
  }

  #lockPath(scope: PluginInstallationScope, libraryDirectory?: string): string {
    if (scope === 'user') return path.join(this.options.userDataDirectory, 'plugins', USER_PLUGIN_LOCK_FILE_NAME);
    if (libraryDirectory === undefined || libraryDirectory.trim() === '') {
      throw new PluginPackageManagerError('PLUGIN_SOURCE_READ_FAILED', 'A library plugin operation requires a library directory.');
    }
    return path.join(libraryDirectory, PLUGIN_LIBRARY_LOCK_FILE);
  }

  async #readPackageLocks(scope: PluginInstallationScope, libraryDirectory?: string): Promise<PluginPackageLock[]> {
    let contents: string;
    try {
      contents = await readFile(this.#lockPath(scope, libraryDirectory), 'utf8');
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    try {
      return pluginLibraryLockSchema.parse(JSON.parse(contents)).packages;
    } catch {
      throw new PluginPackageManagerError('PLUGIN_LOCK_INVALID', 'The plugin lock file is invalid.');
    }
  }

  async #upsertPackageLock(
    scope: PluginInstallationScope,
    libraryDirectory: string | undefined,
    lock: PluginPackageLock,
  ): Promise<void> {
    const existing = await this.#readPackageLocks(scope, libraryDirectory);
    const packages = [
      ...existing.filter((candidate) => !(candidate.pluginId === lock.pluginId && candidate.version === lock.version)),
      lock,
    ].sort((left, right) => `${left.pluginId}@${left.version}`.localeCompare(`${right.pluginId}@${right.version}`));
    await this.#writePackageLocks(scope, libraryDirectory, packages);
  }

  async #writePackageLocks(
    scope: PluginInstallationScope,
    libraryDirectory: string | undefined,
    packages: readonly PluginPackageLock[],
  ): Promise<void> {
    const lockPath = this.#lockPath(scope, libraryDirectory);
    const contents = `${JSON.stringify({ lockVersion: PLUGIN_LOCK_VERSION, packages }, null, 2)}\n`;
    await mkdir(path.dirname(lockPath), { recursive: true });
    const temporaryPath = `${lockPath}.staging-${randomUUID()}`;
    try {
      await writeFile(temporaryPath, contents, { encoding: 'utf8', mode: 0o600 });
      await rename(temporaryPath, lockPath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }

  async #readDeviceState(): Promise<PluginDeviceState> {
    const statePath = path.join(this.options.userDataDirectory, DEVICE_STATE_FILE_NAME);
    let contents: string;
    try {
      contents = await readFile(statePath, 'utf8');
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyDeviceState();
      throw error;
    }
    try {
      return deviceStateSchema.parse(JSON.parse(contents));
    } catch {
      throw new PluginPackageManagerError('PLUGIN_DEVICE_STATE_INVALID', 'The local plugin trust and resolution state is invalid.');
    }
  }

  async #writeDeviceState(state: PluginDeviceState): Promise<void> {
    const statePath = path.join(this.options.userDataDirectory, DEVICE_STATE_FILE_NAME);
    await mkdir(path.dirname(statePath), { recursive: true });
    const temporaryPath = `${statePath}.staging-${randomUUID()}`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(deviceStateSchema.parse(state), null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      await rename(temporaryPath, statePath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }

  async #validPackages(scope: PluginInstallationScope, libraryDirectory?: string): Promise<InstalledPluginPackage[]> {
    const installed = await this.listInstalled({ scope, libraryDirectory });
    return installed.flatMap((entry) => entry.status === 'valid' ? [entry.package] : []);
  }

  #highestVersion(packages: readonly InstalledPluginPackage[]): InstalledPluginPackage | undefined {
    return [...packages].sort(compareVersions)[0];
  }

  #resolvedOrAwaitingTrust(
    state: PluginDeviceState,
    libraryId: string,
    selection: 'use-global' | 'use-library',
    pluginPackage: InstalledPluginPackage,
  ): PluginResolutionResult {
    const quarantine = state.quarantines.find((record) => record.libraryId === libraryId
      && record.pluginId === pluginPackage.lock.pluginId
      && record.packageHash === pluginPackage.lock.packageHash
      && record.quarantinedAt !== undefined);
    if (quarantine !== undefined) {
      return { status: 'disabled', reason: 'quarantined', package: pluginPackage, quarantine };
    }
    // Safe Mode only pauses unrestricted (trusted) runtimes; restricted (standard) may keep running.
    if (state.safeMode && pluginPackage.manifest.runtime.mode === 'unrestricted') {
      return { status: 'disabled', reason: 'safe-mode', package: pluginPackage };
    }
    if (selection === 'use-global') return { status: 'resolved', selection, package: pluginPackage };
    const trust = state.trustDecisions.find((decision) => decision.pluginId === pluginPackage.lock.pluginId
      && decision.packageHash === pluginPackage.lock.packageHash
      && decision.sourceFingerprint === pluginPackage.lock.sourceFingerprint
      && decision.runtimeMode === pluginPackage.manifest.runtime.mode);
    if (trust?.decision !== 'trusted') {
      return {
        status: 'awaiting-trust',
        selection,
        package: pluginPackage,
        reason: trust?.decision === 'denied' ? 'denied' : 'untrusted',
      };
    }
    return { status: 'resolved', selection, package: pluginPackage };
  }

  #assertCompatible(manifest: PluginManifest): void {
    const compatibility = validatePluginManifestCompatibility(manifest, {
      serpentVersion: this.options.serpentVersion,
      pluginApiVersion: this.options.pluginApiVersion,
      platform: this.options.platform,
      arch: this.options.arch,
      nodeAbi: this.options.nodeAbi,
    });
    if (!compatibility.ok) throw new PluginPackageManagerError('PLUGIN_PACKAGE_INCOMPATIBLE', compatibility.message);
  }

  async #readInstalledAt(
    packageDirectory: string,
    scope: PluginInstallationScope,
    lock: PluginPackageLock,
  ): Promise<PluginInstalledPackageStatus | undefined> {
    try {
      await lstat(packageDirectory);
      const inspection = await inspectPluginDirectory(packageDirectory, lock.source, this.#limits);
      const integrity = verifyPluginPackageLock(inspection.snapshot, lock);
      if (!integrity.ok) {
        return {
          status: 'invalid',
          package: lock,
          scope,
          errorCode: integrity.code,
          message: integrity.message,
        };
      }
      return {
        status: 'valid',
        package: { lock, manifest: inspection.manifest, scope, packageDirectory },
        trust: undefined,
      };
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      return {
        status: 'invalid',
        package: lock,
        scope,
        errorCode: error instanceof PluginPackageManagerError ? error.code : 'PLUGIN_PACKAGE_INTEGRITY_MISMATCH',
        message: error instanceof Error ? error.message : 'The installed plugin package could not be verified.',
      };
    }
  }

}
