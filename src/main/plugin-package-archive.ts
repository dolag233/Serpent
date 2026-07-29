import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import AdmZip from 'adm-zip';

import { type PluginManifest, pluginPackagePathSchema } from '../plugins/plugin-manifest';
import {
  createPluginPackageLock,
  type PluginPackageFile,
  type PluginPackageLimits,
  type PluginPackageLock,
  validatePluginPackageSnapshot,
} from '../plugins/plugin-package';
import { PluginPackageManagerError } from './plugin-package-manager-types';

export type InspectedPluginDirectory = {
  snapshot: {
    manifest: unknown;
    manifestSha256: string;
    sourceFingerprint: string;
    archiveByteLength: number;
    files: Array<PluginPackageFile & { kind: 'file' }>;
  };
  manifest: PluginManifest;
  lock: PluginPackageLock;
};

function sha256(contents: Uint8Array): string {
  return createHash('sha256').update(contents).digest('hex');
}

function safeContainedPath(root: string, relativePath: string): string {
  const candidate = path.resolve(root, ...relativePath.split('/'));
  const normalizedRoot = path.resolve(root);
  if (candidate !== normalizedRoot && !candidate.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new PluginPackageManagerError('PLUGIN_SOURCE_READ_FAILED', 'Plugin package path escaped its expected directory.');
  }
  return candidate;
}

export async function inspectPluginDirectory(
  directory: string,
  sourceFingerprint: string,
  limits: PluginPackageLimits,
): Promise<InspectedPluginDirectory> {
  const rootStats = await lstat(directory).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new PluginPackageManagerError('PLUGIN_SOURCE_NOT_DIRECTORY', 'The plugin source directory does not exist.');
    }
    throw error;
  });
  if (rootStats.isSymbolicLink()) {
    throw new PluginPackageManagerError('PLUGIN_SOURCE_SYMLINK_FORBIDDEN', 'A plugin source directory must not be a symbolic link.');
  }
  if (!rootStats.isDirectory()) {
    throw new PluginPackageManagerError('PLUGIN_SOURCE_NOT_DIRECTORY', 'The plugin source must be a directory.');
  }
  const files: Array<PluginPackageFile & { kind: 'file' }> = [];
  let expandedBytes = 0;
  const visit = async (relativeDirectory: string): Promise<void> => {
    const absoluteDirectory = safeContainedPath(directory, relativeDirectory || '.');
    const entries = await readdir(absoluteDirectory, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = relativeDirectory === '' ? entry.name : `${relativeDirectory}/${entry.name}`;
      const absolutePath = safeContainedPath(directory, relativePath);
      const stats = await lstat(absolutePath);
      if (stats.isSymbolicLink()) {
        throw new PluginPackageManagerError('PLUGIN_SOURCE_SYMLINK_FORBIDDEN', 'Plugin packages must not contain symbolic links.');
      }
      if (stats.isDirectory()) {
        await visit(relativePath);
        continue;
      }
      if (!stats.isFile()) {
        throw new PluginPackageManagerError('PLUGIN_SOURCE_READ_FAILED', 'Plugin packages may only contain regular files and directories.');
      }
      if (files.length >= limits.maxFileCount) {
        throw new PluginPackageManagerError('PLUGIN_SOURCE_READ_FAILED', 'Plugin package exceeds the maximum file count.');
      }
      if (stats.size > limits.maxSingleFileBytes) {
        throw new PluginPackageManagerError('PLUGIN_SOURCE_FILE_TOO_LARGE', 'A plugin package file exceeds the maximum allowed size.');
      }
      expandedBytes += stats.size;
      if (expandedBytes > limits.maxExtractedBytes) {
        throw new PluginPackageManagerError('PLUGIN_SOURCE_FILE_TOO_LARGE', 'Plugin package exceeds the maximum expanded size.');
      }
      const contents = await readFile(absolutePath);
      files.push({ path: relativePath, byteLength: contents.byteLength, sha256: sha256(contents), kind: 'file' });
    }
  };
  await visit('');
  const manifestPath = safeContainedPath(directory, 'serpent-plugin.json');
  let manifestBytes: Buffer;
  try {
    manifestBytes = await readFile(manifestPath);
  } catch {
    throw new PluginPackageManagerError('PLUGIN_SOURCE_READ_FAILED', 'The plugin package must contain serpent-plugin.json.');
  }
  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(manifestBytes.toString('utf8'));
  } catch {
    throw new PluginPackageManagerError('PLUGIN_SOURCE_INVALID_JSON', 'The plugin manifest is not valid JSON.');
  }
  const snapshot = {
    manifest: manifestValue,
    manifestSha256: sha256(manifestBytes),
    sourceFingerprint,
    archiveByteLength: 0,
    files,
  };
  const validation = validatePluginPackageSnapshot(snapshot, limits);
  if (!validation.ok) throw new PluginPackageManagerError('PLUGIN_SOURCE_READ_FAILED', validation.message);
  return { snapshot, manifest: validation.manifest, lock: createPluginPackageLock(snapshot) };
}

export async function copyInspectedPluginFiles(
  sourceDirectory: string,
  targetDirectory: string,
  files: readonly (PluginPackageFile & { kind: 'file' })[],
): Promise<void> {
  for (const file of files) {
    const sourcePath = safeContainedPath(sourceDirectory, file.path);
    const targetPath = safeContainedPath(targetDirectory, file.path);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await copyFile(sourcePath, targetPath);
  }
}

export async function extractPluginArchive(
  archive: Uint8Array,
  targetDirectory: string,
  limits: PluginPackageLimits,
): Promise<void> {
  let zip: AdmZip;
  try {
    zip = new AdmZip(Buffer.from(archive));
  } catch {
    throw new PluginPackageManagerError('PLUGIN_ARCHIVE_INVALID', 'The plugin package archive is not a valid ZIP file.');
  }
  const entries = zip.getEntries();
  if (entries.length > limits.maxFileCount) {
    throw new PluginPackageManagerError('PLUGIN_ARCHIVE_INVALID', 'The plugin archive contains too many entries.');
  }
  const fileNames = entries.filter((entry) => !entry.isDirectory).map((entry) => entry.entryName);
  const rootSegments = fileNames.map((name) => name.split('/')[0]).filter((segment): segment is string => segment !== undefined);
  const hasSingleRoot = rootSegments.length > 0
    && pluginPackagePathSchema.safeParse(rootSegments[0]).success
    && rootSegments.every((segment) => segment === rootSegments[0])
    && fileNames.every((name) => name.includes('/'));
  const rootPrefix = hasSingleRoot ? `${rootSegments[0]}/` : '';
  let expandedBytes = 0;
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const unixMode = (entry.attr >>> 16) & 0o170000;
    if (unixMode === 0o120000) {
      throw new PluginPackageManagerError('PLUGIN_ARCHIVE_INVALID', 'Plugin archives must not contain symbolic links.');
    }
    if (!entry.entryName.startsWith(rootPrefix)) {
      throw new PluginPackageManagerError('PLUGIN_ARCHIVE_INVALID', 'Plugin archive contains an invalid root entry.');
    }
    const relativePath = entry.entryName.slice(rootPrefix.length);
    if (!pluginPackagePathSchema.safeParse(relativePath).success) {
      throw new PluginPackageManagerError('PLUGIN_ARCHIVE_INVALID', 'Plugin archive contains an absolute or traversing path.');
    }
    if (entry.header.size > limits.maxSingleFileBytes) {
      throw new PluginPackageManagerError('PLUGIN_ARCHIVE_INVALID', 'A plugin archive entry exceeds the maximum file size.');
    }
    expandedBytes += entry.header.size;
    if (expandedBytes > limits.maxExtractedBytes) {
      throw new PluginPackageManagerError('PLUGIN_ARCHIVE_INVALID', 'The plugin archive exceeds the maximum expanded size.');
    }
    let contents: Buffer;
    try {
      contents = entry.getData();
    } catch {
      throw new PluginPackageManagerError('PLUGIN_ARCHIVE_INVALID', 'A plugin archive entry could not be read.');
    }
    if (contents.byteLength !== entry.header.size) {
      throw new PluginPackageManagerError('PLUGIN_ARCHIVE_INVALID', 'A plugin archive entry has an unexpected decompressed size.');
    }
    const outputPath = safeContainedPath(targetDirectory, relativePath);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, contents, { mode: 0o600 });
  }
}
