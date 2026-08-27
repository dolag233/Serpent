import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, readdirSync } from 'node:fs';
import {
  access,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';

import AdmZip from 'adm-zip';

import {
  compareSemver,
  parseSemver,
  type ParsedSemver,
} from '../plugins/plugin-manifest';
import type {
  AppUpdateAssetKind,
  AppUpdateCheckResult,
  AppUpdateDistribution,
  AppUpdateInstallResult,
  AppUpdateProgress,
  AppUpdateReleaseMeta,
} from '../shared/app-update';
import { appUpdateReleaseMetaSchema } from '../shared/app-update';

export const SERPENT_GITHUB_REPOSITORY = 'dolag233/Serpent';
export const SERPENT_GITHUB_RELEASES_URL =
  `https://github.com/${SERPENT_GITHUB_REPOSITORY}/releases/latest`;

const GITHUB_RELEASE_API_URL =
  `https://api.github.com/repos/${SERPENT_GITHUB_REPOSITORY}/releases/latest`;
const MAX_RELEASE_NOTES_LENGTH = 12_000;
const MAX_RELEASE_META_LENGTH = 64 * 1024;
const RELEASE_META_ASSET_NAME = 'release-meta.json';
const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024;
const SAFE_ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/u;
const SHA256_PATTERN = /\b([a-f0-9]{64})\b/iu;
const INSTALLED_MARKER_NAME = '.serpent-installed';

export type AppUpdatePlatform = 'darwin' | 'win32';

export type AppUpdateTarget = {
  platform: AppUpdatePlatform;
  arch: 'arm64' | 'x64';
  distribution: Exclude<AppUpdateDistribution, 'development'>;
};

export type GitHubReleaseAsset = {
  name: string;
  browserDownloadUrl: string;
  size: number;
  digest?: string;
};

export type GitHubRelease = {
  tagName: string;
  version: string;
  releaseUrl: string;
  notes: string;
  assets: GitHubReleaseAsset[];
};

export type SelectedUpdateAsset = {
  asset: GitHubReleaseAsset;
  assetKind: AppUpdateAssetKind;
  checksumAsset?: GitHubReleaseAsset;
};

export type AppUpdateLogger = {
  info(scope: string, message: string, context?: Record<string, unknown>): void;
  error(scope: string, error: unknown, context?: Record<string, unknown>): void;
};

export type AppUpdateFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export type AppUpdateDistributionInput = {
  isPackaged: boolean;
  platform: string;
  executablePath: string;
  environment?: Record<string, string | undefined>;
  fileExists?: (filePath: string) => boolean;
  directoryEntries?: (directoryPath: string) => string[];
};

export type AppUpdateServiceOptions = {
  currentVersion: string;
  isPackaged: boolean;
  platform: string;
  arch: string;
  executablePath: string;
  tempDirectory: string;
  downloadsDirectory: string;
  environment?: Record<string, string | undefined>;
  fetchImpl?: AppUpdateFetch;
  openPath?: (filePath: string) => Promise<string>;
  showItemInFolder?: (filePath: string) => void;
  launchInstaller?: (installerPath: string) => Promise<void>;
  onDownloadProgress?: (progress: AppUpdateProgress) => void;
  logger?: AppUpdateLogger;
};

type CachedUpdate = {
  release: GitHubRelease;
  target: AppUpdateTarget;
  selected: SelectedUpdateAsset;
};

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null;
}

function isSafeGitHubAssetUrl(input: unknown): input is string {
  if (typeof input !== 'string' || input.length > 2_048) return false;
  try {
    const url = new URL(input);
    return url.protocol === 'https:' && url.hostname === 'github.com';
  } catch {
    return false;
  }
}

function stripVersionPrefix(value: string): string {
  return value.startsWith('v') || value.startsWith('V') ? value.slice(1) : value;
}

function parseDigest(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined;
  const match = /^sha256:([a-f0-9]{64})$/iu.exec(input.trim());
  return match?.[1]?.toLowerCase();
}

function parseReleaseAsset(input: unknown): GitHubReleaseAsset | undefined {
  if (!isRecord(input)) return undefined;
  const name = input.name;
  const browserDownloadUrl = input.browser_download_url;
  const size = input.size;
  if (
    typeof name !== 'string'
    || !SAFE_ASSET_NAME.test(name)
    || !isSafeGitHubAssetUrl(browserDownloadUrl)
    || typeof size !== 'number'
    || !Number.isSafeInteger(size)
    || size < 0
    || size > MAX_DOWNLOAD_BYTES
  ) {
    return undefined;
  }
  const digest = parseDigest(input.digest);
  return digest === undefined
    ? { name, browserDownloadUrl, size }
    : { name, browserDownloadUrl, size, digest };
}

/** Parse the small, stable subset of GitHub's latest-release response we use. */
export function parseGitHubRelease(input: unknown): GitHubRelease | undefined {
  if (!isRecord(input)) return undefined;
  const tagName = input.tag_name;
  const releaseUrl = input.html_url;
  const assetsInput = input.assets;
  if (
    typeof tagName !== 'string'
    || tagName.length === 0
    || !isSafeGitHubAssetUrl(releaseUrl)
    || !Array.isArray(assetsInput)
    || input.draft === true
    || input.prerelease === true
  ) {
    return undefined;
  }
  const version = stripVersionPrefix(tagName);
  if (parseSemver(version) === undefined) return undefined;
  const assets = assetsInput.flatMap((asset) => {
    const parsed = parseReleaseAsset(asset);
    return parsed === undefined ? [] : [parsed];
  });
  const notes = typeof input.body === 'string'
    ? input.body.slice(0, MAX_RELEASE_NOTES_LENGTH)
    : '';
  return {
    tagName,
    version,
    releaseUrl,
    notes,
    assets,
  };
}

export function parseSha256(text: string): string | undefined {
  return SHA256_PATTERN.exec(text)?.[1]?.toLowerCase();
}

export function detectAppDistribution(input: AppUpdateDistributionInput): AppUpdateDistribution {
  const environment = input.environment ?? {};
  const forced = environment.SERPENT_DISTRIBUTION;
  if (forced === 'portable' || forced === 'installed' || forced === 'development') {
    return forced;
  }

  if (!input.isPackaged) {
    // Dev builds check GitHub Releases by default as installed distribution so
    // update UI and installer flow can be exercised without packaging.
    // Override with SERPENT_DISTRIBUTION=portable or =development when needed.
    return 'installed';
  }

  if (
    environment.PORTABLE_EXECUTABLE_FILE !== undefined
    || environment.PORTABLE_EXECUTABLE_DIR !== undefined
  ) {
    return 'portable';
  }

  const fileExists = input.fileExists ?? existsSync;
  const directoryEntries = input.directoryEntries ?? ((directoryPath: string) => {
    try {
      return readdirSync(directoryPath);
    } catch {
      return [];
    }
  });
  const executableDirectory = path.dirname(input.executablePath);

  if (input.platform === 'win32') {
    // Inno Setup writes an explicit marker beside Serpent.exe. Keep the
    // uninstaller fallback for installations created before that marker was
    // added. A Forge ZIP extraction has neither, so it remains portable.
    if (
      fileExists(path.join(executableDirectory, INSTALLED_MARKER_NAME))
      || fileExists(path.join(executableDirectory, 'unins000.exe'))
      || directoryEntries(executableDirectory).some((entry) => /^unins\d+\.exe$/iu.test(entry))
    ) {
      return 'installed';
    }
    return 'portable';
  }

  if (input.platform === 'darwin') {
    const executablePath = path.resolve(input.executablePath);
    const isInApplications = executablePath.includes(`${path.sep}Applications${path.sep}`);
    const hasBundle = executablePath.includes(`.app${path.sep}Contents${path.sep}MacOS${path.sep}`);
    return isInApplications && hasBundle ? 'installed' : 'portable';
  }

  return 'portable';
}

export function resolveAppUpdateTarget(input: {
  platform: string;
  arch: string;
  distribution: AppUpdateDistribution;
}): AppUpdateTarget | undefined {
  if (input.distribution === 'development') return undefined;
  if (input.platform !== 'darwin' && input.platform !== 'win32') return undefined;
  if (input.platform === 'darwin' && input.arch !== 'arm64') return undefined;
  if (input.platform === 'win32' && input.arch !== 'x64') return undefined;
  const platform = input.platform === 'darwin' ? 'darwin' : 'win32';
  return {
    platform,
    arch: platform === 'darwin' ? 'arm64' : 'x64',
    distribution: input.distribution,
  };
}

export function updateAssetName(
  version: string,
  target: AppUpdateTarget,
): { name: string; assetKind: AppUpdateAssetKind } {
  if (target.platform === 'darwin') {
    return target.distribution === 'installed'
      ? {
          name: `Serpent-darwin-arm64-${version}-package.dmg`,
          assetKind: 'installer',
        }
      : {
          name: `Serpent-darwin-arm64-${version}-portable.zip`,
          assetKind: 'portable',
        };
  }
  return target.distribution === 'installed'
    ? {
        name: `Serpent-win-x86-64-${version}-setup.zip`,
        assetKind: 'installer',
      }
    : {
        name: `Serpent-win-x86-64-${version}-portable.zip`,
        assetKind: 'portable',
      };
}

export function selectUpdateAsset(
  release: GitHubRelease,
  target: AppUpdateTarget,
): SelectedUpdateAsset | undefined {
  const expected = updateAssetName(release.version, target);
  const asset = release.assets.find((candidate) => candidate.name === expected.name);
  if (asset === undefined) return undefined;
  const checksumAsset = release.assets.find(
    (candidate) => candidate.name === `${asset.name}.sha256`,
  );
  if (checksumAsset === undefined && asset.digest === undefined) return undefined;
  return {
    asset,
    assetKind: expected.assetKind,
    ...(checksumAsset === undefined ? {} : { checksumAsset }),
  };
}

function resultError(
  code: Extract<AppUpdateCheckResult, { ok: false }>['code'],
): AppUpdateCheckResult {
  return { ok: false, status: 'error', code };
}

function installResultError(
  code: Extract<AppUpdateInstallResult, { ok: false }>['code'],
): AppUpdateInstallResult {
  return { ok: false, status: 'error', code };
}

function parseVersionForComparison(value: string): ParsedSemver | undefined {
  return parseSemver(stripVersionPrefix(value));
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function emitDownloadProgress(
  onProgress: AppUpdateServiceOptions['onDownloadProgress'],
  progress: AppUpdateProgress,
): void {
  onProgress?.(progress);
}

async function writeDownloadedResponse(
  response: Response,
  targetPath: string,
  options: {
    signal?: AbortSignal;
    totalBytes?: number;
    onProgress?: AppUpdateServiceOptions['onDownloadProgress'];
  } = {},
): Promise<string> {
  const hash = createHash('sha256');
  await mkdir(path.dirname(targetPath), { recursive: true });
  const reportProgress = (downloadedBytes: number) => {
    emitDownloadProgress(options.onProgress, {
      phase: 'downloading',
      downloadedBytes,
      totalBytes: options.totalBytes,
    });
  };
  if (response.body === null) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (bytes.byteLength > MAX_DOWNLOAD_BYTES) {
      throw new Error('The update response is too large.');
    }
    hash.update(bytes);
    await writeFile(targetPath, bytes, { mode: 0o600, flag: 'wx' });
    reportProgress(bytes.byteLength);
    return hash.digest('hex');
  }
  let downloadedBytes = 0;
  const hashingTransform = new Transform({
    transform(chunk: Buffer | string, _encoding, callback) {
      if (options.signal?.aborted) {
        callback(new DOMException('Aborted', 'AbortError'));
        return;
      }
      downloadedBytes += Buffer.byteLength(chunk);
      if (downloadedBytes > MAX_DOWNLOAD_BYTES) {
        callback(new Error('The update response is too large.'));
        return;
      }
      hash.update(chunk);
      reportProgress(downloadedBytes);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
      hashingTransform,
      createWriteStream(targetPath, { flags: 'wx', mode: 0o600 }),
      { signal: options.signal },
    );
  } catch (error) {
    await rm(targetPath, { force: true }).catch(() => undefined);
    throw error;
  }
  return hash.digest('hex');
}

async function nextAvailableDownloadPath(
  directory: string,
  fileName: string,
): Promise<string> {
  await mkdir(directory, { recursive: true });
  const extension = path.extname(fileName);
  const stem = fileName.slice(0, -extension.length);
  for (let suffix = 0; suffix < 100; suffix += 1) {
    const candidateName = suffix === 0
      ? fileName
      : `${stem} (${suffix})${extension}`;
    const candidate = path.join(directory, candidateName);
    try {
      await access(candidate);
    } catch {
      return candidate;
    }
  }
  throw new Error('Too many downloaded update copies exist.');
}

function safeInstallerEntryName(entryName: string): boolean {
  const normalized = entryName.replaceAll('\\', '/');
  return normalized.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
    && path.posix.basename(normalized).toLowerCase() === 'serpentsetup.exe';
}

async function extractWindowsInstaller(
  archivePath: string,
  tempDirectory: string,
): Promise<{ installerPath: string; outputDirectory: string }> {
  const archive = new AdmZip(archivePath);
  const entry = archive.getEntries().find((candidate) =>
    !candidate.isDirectory && safeInstallerEntryName(candidate.entryName));
  if (entry === undefined) throw new Error('The Windows update archive has no SerpentSetup.exe.');
  const outputDirectory = await mkdtemp(path.join(tempDirectory, 'serpent-installer-'));
  try {
    const installerPath = path.join(outputDirectory, 'SerpentSetup.exe');
    await writeFile(installerPath, entry.getData(), { mode: 0o700, flag: 'wx' });
    return { installerPath, outputDirectory };
  } catch (error) {
    await rm(outputDirectory, {
      force: true,
      recursive: true,
      maxRetries: 3,
      retryDelay: 100,
    }).catch(() => undefined);
    throw error;
  }
}

async function removeUpdateArtifact(filePath: string | undefined): Promise<void> {
  if (filePath === undefined) return;
  await rm(filePath, {
    force: true,
    recursive: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}

function validateDownloadUrl(input: string): void {
  if (!isSafeGitHubAssetUrl(input)) throw new Error('The update asset URL is not a GitHub HTTPS URL.');
}

function isSafeReleaseMetaUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return (url.protocol === 'https:' || url.protocol === 'http:')
      && url.username === ''
      && url.password === '';
  } catch {
    return false;
  }
}

/** Validate the optional release metadata without allowing it to affect the selected asset. */
export function parseGitHubReleaseMeta(
  input: unknown,
  expectedVersion: string,
): AppUpdateReleaseMeta | undefined {
  const parsed = appUpdateReleaseMetaSchema.safeParse(input);
  if (!parsed.success || parsed.data.version !== expectedVersion) return undefined;
  if (
    (parsed.data.changelogUrl !== undefined && !isSafeReleaseMetaUrl(parsed.data.changelogUrl))
    || (parsed.data.downloadUrl !== undefined && !isSafeReleaseMetaUrl(parsed.data.downloadUrl))
  ) {
    return undefined;
  }
  return parsed.data;
}

export class AppUpdateService {
  readonly #options: AppUpdateServiceOptions;
  readonly #fetch: AppUpdateFetch;
  #cachedUpdate: CachedUpdate | undefined;
  #busy = false;
  #downloadAbort: AbortController | undefined;

  constructor(options: AppUpdateServiceOptions) {
    this.#options = options;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  cancelDownload(): void {
    this.#downloadAbort?.abort();
  }

  async #fetchReleaseMeta(release: GitHubRelease): Promise<AppUpdateReleaseMeta | undefined> {
    const metadataAsset = release.assets.find((asset) => asset.name === RELEASE_META_ASSET_NAME);
    if (metadataAsset === undefined) return undefined;
    try {
      validateDownloadUrl(metadataAsset.browserDownloadUrl);
      const response = await this.#fetch(metadataAsset.browserDownloadUrl, {
        headers: {
          Accept: 'application/json',
          'User-Agent': `Serpent/${this.#options.currentVersion}`,
        },
      });
      if (!response.ok) return undefined;
      const text = await response.text();
      if (text.length > MAX_RELEASE_META_LENGTH) return undefined;
      return parseGitHubReleaseMeta(JSON.parse(text), release.version);
    } catch (error) {
      this.#options.logger?.info('app-update.metadata', 'Release metadata is unavailable.', {
        reason: error instanceof Error ? error.name : 'invalid-response',
      });
      return undefined;
    }
  }

  async checkForUpdates(): Promise<AppUpdateCheckResult> {
    this.#cachedUpdate = undefined;
    const distribution = detectAppDistribution({
      isPackaged: this.#options.isPackaged,
      platform: this.#options.platform,
      executablePath: this.#options.executablePath,
      environment: this.#options.environment,
    });
    if (distribution === 'development') {
      return {
        ok: true,
        status: 'unsupported',
        reason: 'development',
        currentVersion: this.#options.currentVersion,
        distribution,
      };
    }
    const target = resolveAppUpdateTarget({
      platform: this.#options.platform,
      arch: this.#options.arch,
      distribution,
    });
    if (this.#options.platform !== 'darwin' && this.#options.platform !== 'win32') {
      return {
        ok: true,
        status: 'unsupported',
        reason: 'platform',
        currentVersion: this.#options.currentVersion,
        distribution,
      };
    }
    if (target === undefined) {
      return {
        ok: true,
        status: 'unsupported',
        reason: 'architecture',
        currentVersion: this.#options.currentVersion,
        distribution,
      };
    }
    const currentVersion = parseVersionForComparison(this.#options.currentVersion);
    if (currentVersion === undefined) return resultError('invalid-release');

    try {
      const response = await this.#fetch(GITHUB_RELEASE_API_URL, {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': `Serpent/${this.#options.currentVersion}`,
        },
      });
      if (!response.ok) {
        this.#options.logger?.info('app-update.check', 'GitHub latest release request failed.', {
          status: response.status,
        });
        return resultError('network');
      }
      const release = parseGitHubRelease(await response.json());
      if (release === undefined) return resultError('invalid-release');
      const latestVersion = parseVersionForComparison(release.version);
      if (latestVersion === undefined) return resultError('invalid-release');
      if (compareSemver(latestVersion, currentVersion) <= 0) {
        this.#cachedUpdate = undefined;
        return {
          ok: true,
          status: 'up-to-date',
          currentVersion: this.#options.currentVersion,
          latestVersion: release.version,
          distribution,
        };
      }
      const selected = selectUpdateAsset(release, target);
      if (selected === undefined) {
        this.#options.logger?.info('app-update.check', 'Latest release has no compatible verified asset.', {
          version: release.version,
          platform: target.platform,
          arch: target.arch,
          distribution: target.distribution,
        });
        return resultError('asset-missing');
      }
      const releaseMeta = await this.#fetchReleaseMeta(release);
      this.#cachedUpdate = { release, target, selected };
      return {
        ok: true,
        status: 'available',
        currentVersion: this.#options.currentVersion,
        latestVersion: release.version,
        distribution,
        assetKind: selected.assetKind,
        assetName: selected.asset.name,
        assetSize: selected.asset.size,
        releaseNotes: release.notes,
        ...(releaseMeta === undefined ? {} : { releaseMeta }),
      };
    } catch (error) {
      this.#options.logger?.error('app-update.check', error, { code: 'network' });
      return resultError('network');
    }
  }

  async downloadAndInstall(): Promise<AppUpdateInstallResult> {
    if (this.#busy) return installResultError('busy');
    this.#busy = true;
    this.#downloadAbort = new AbortController();
    const { signal } = this.#downloadAbort;
    let downloadPath: string | undefined;
    let extractedInstallerDirectory: string | undefined;
    let keepDownloadedUpdate = false;
    try {
      const cached = this.#cachedUpdate;
      const checked = cached === undefined ? await this.checkForUpdates() : undefined;
      const update = cached ?? (checked?.status === 'available' ? this.#cachedUpdate : undefined);
      if (update === undefined) return installResultError('not-available');

      const { asset, checksumAsset } = update.selected;
      validateDownloadUrl(asset.browserDownloadUrl);
      const checksumUrl = checksumAsset?.browserDownloadUrl;
      let expectedSha256 = asset.digest;
      if (checksumUrl !== undefined) {
        validateDownloadUrl(checksumUrl);
        emitDownloadProgress(this.#options.onDownloadProgress, {
          phase: 'verifying',
          downloadedBytes: 0,
        });
        const checksumResponse = await this.#fetch(checksumUrl, {
          headers: { Accept: 'application/octet-stream', 'User-Agent': `Serpent/${this.#options.currentVersion}` },
          redirect: 'follow',
          signal,
        });
        if (!checksumResponse.ok) {
          this.#options.logger?.info('app-update.verify', 'Update checksum asset request failed.', {
            status: checksumResponse.status,
            version: update.release.version,
            assetName: asset.name,
          });
          return installResultError('verification-failed');
        }
        const sidecarSha256 = parseSha256(await checksumResponse.text());
        if (asset.digest !== undefined && sidecarSha256 !== undefined && asset.digest !== sidecarSha256) {
          this.#options.logger?.info('app-update.verify', 'Release digest and checksum asset disagree.', {
            version: update.release.version,
            assetName: asset.name,
          });
          return installResultError('verification-failed');
        }
        expectedSha256 ??= sidecarSha256;
      }
      if (expectedSha256 === undefined) {
        this.#options.logger?.info('app-update.verify', 'Update has no usable checksum.', {
          version: update.release.version,
          assetName: asset.name,
        });
        return installResultError('verification-failed');
      }

      downloadPath = await nextAvailableDownloadPath(
        this.#options.downloadsDirectory,
        asset.name,
      );
      const response = await this.#fetch(asset.browserDownloadUrl, {
        headers: { Accept: 'application/octet-stream', 'User-Agent': `Serpent/${this.#options.currentVersion}` },
        redirect: 'follow',
        signal,
      });
      if (!response.ok) {
        this.#options.logger?.info('app-update.download', 'Update asset request failed.', {
          status: response.status,
          version: update.release.version,
          assetName: asset.name,
        });
        return installResultError('download-failed');
      }
      const totalBytes = asset.size > 0 ? asset.size : undefined;
      emitDownloadProgress(this.#options.onDownloadProgress, {
        phase: 'downloading',
        downloadedBytes: 0,
        totalBytes,
      });
      const actualSha256 = await writeDownloadedResponse(response, downloadPath, {
        signal,
        totalBytes,
        onProgress: this.#options.onDownloadProgress,
      });
      if (actualSha256 !== expectedSha256) {
        await rm(downloadPath, { force: true }).catch(() => undefined);
        this.#options.logger?.info('app-update.verify', 'Downloaded update checksum mismatch.', {
          version: update.release.version,
          assetName: asset.name,
        });
        return installResultError('verification-failed');
      }

      if (update.target.distribution === 'portable') {
        // A portable update is a user-facing download rather than an
        // in-process install. Keep the archive so the user can launch or
        // copy it after the update flow completes.
        keepDownloadedUpdate = true;
        try {
          this.#options.showItemInFolder?.(downloadPath);
        } catch (error) {
          this.#options.logger?.error('app-update.reveal', error, { version: update.release.version });
        }
        this.#options.logger?.info('app-update.download', 'Portable update downloaded.', {
          version: update.release.version,
          assetName: asset.name,
        });
        this.#cachedUpdate = undefined;
        return {
          ok: true,
          status: 'completed',
          action: 'portable-downloaded',
          version: update.release.version,
          distribution: 'portable',
        };
      }

      let launchPath = downloadPath;
      if (update.target.platform === 'win32') {
        emitDownloadProgress(this.#options.onDownloadProgress, {
          phase: 'extracting',
          downloadedBytes: totalBytes ?? asset.size,
          totalBytes,
        });
        const extracted = await extractWindowsInstaller(downloadPath, this.#options.tempDirectory);
        launchPath = extracted.installerPath;
        extractedInstallerDirectory = extracted.outputDirectory;
      }
      emitDownloadProgress(this.#options.onDownloadProgress, {
        phase: 'launching',
        downloadedBytes: totalBytes ?? asset.size,
        totalBytes,
      });
      if (this.#options.launchInstaller !== undefined) {
        await this.#options.launchInstaller(launchPath);
      } else {
        const openError = await (this.#options.openPath?.(launchPath) ?? Promise.resolve(''));
        if (openError !== '') {
          this.#options.logger?.error('app-update.open', new Error(openError), {
            version: update.release.version,
            assetName: asset.name,
          });
          return installResultError('open-failed');
        }
      }
      this.#options.logger?.info('app-update.install', 'Update installer opened.', {
        version: update.release.version,
        assetName: asset.name,
      });
      this.#cachedUpdate = undefined;
      return {
        ok: true,
        status: 'completed',
        action: 'installer-opened',
        version: update.release.version,
        distribution: 'installed',
      };
    } catch (error) {
      if (isAbortError(error)) {
        this.#options.logger?.info('app-update.download', 'Update download cancelled.');
        return installResultError('cancelled');
      }
      this.#options.logger?.error('app-update.install', error, { code: 'download-failed' });
      return installResultError('download-failed');
    } finally {
      if (!keepDownloadedUpdate) {
        try {
          await removeUpdateArtifact(downloadPath);
        } catch (error) {
          this.#options.logger?.error('app-update.cleanup', error, {
            artifact: downloadPath,
          });
        }
      }
      try {
        await removeUpdateArtifact(extractedInstallerDirectory);
      } catch (error) {
        this.#options.logger?.error('app-update.cleanup', error, {
          artifact: extractedInstallerDirectory,
        });
      }
      this.#downloadAbort = undefined;
      this.#busy = false;
    }
  }
}

export function createAppUpdateService(options: AppUpdateServiceOptions): AppUpdateService {
  return new AppUpdateService(options);
}
