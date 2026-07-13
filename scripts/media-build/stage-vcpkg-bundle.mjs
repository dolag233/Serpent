import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

import { generateManifest, verifyBundle } from '../media-binaries-lib.mjs';
import { assertWindowsSystemDependencies } from './pe-dependencies.mjs';

function parseArguments(args) {
  const options = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith('--') || !value) throw new Error(`Invalid argument near ${key ?? '<end>'}.`);
    options.set(key.slice(2), value);
  }
  return options;
}

function required(options, key) {
  const value = options.get(key);
  if (!value) throw new Error(`Missing --${key}.`);
  return value;
}

function executableName(name, platform) {
  return platform === 'win32-x64' ? `${name}.exe` : name;
}

function findTool(targetRoot, component, name) {
  const expected = path.join(targetRoot, 'tools', component, name);
  if (existsSync(expected)) return expected;
  const candidates = [];
  const visit = (directory) => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase()) {
        candidates.push(entryPath);
      }
    }
  };
  visit(path.join(targetRoot, 'tools'));
  if (candidates.length !== 1) {
    throw new Error(`Expected exactly one ${name} in vcpkg tools, found ${candidates.length}.`);
  }
  return candidates[0];
}

function run(binary, args) {
  const result = spawnSync(binary, args, { encoding: 'utf8', shell: false });
  if (result.error || result.status !== 0) {
    throw new Error(`Failed to run ${binary}: ${result.error?.message ?? result.stderr}`);
  }
  return result.stdout;
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function findLockedArchive(downloadRoot, expectedHash) {
  const matches = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.isFile() && sha256(entryPath) === expectedHash) matches.push(entryPath);
    }
  };
  visit(downloadRoot);
  if (matches.length !== 1) {
    throw new Error(`Expected one vcpkg download with SHA-256 ${expectedHash}, found ${matches.length}.`);
  }
  return matches[0];
}

function extractLockedText(archive, suffix) {
  const listing = run('tar', ['-tf', archive]).split(/\r?\n/).filter(Boolean);
  const matches = listing.filter((entry) => entry.endsWith(`/${suffix}`));
  if (matches.length !== 1) {
    throw new Error(`Expected one ${suffix} in ${archive}, found ${matches.length}.`);
  }
  return run('tar', ['-xOf', archive, matches[0]]);
}

function extractUpstreamLicenses(vcpkgRoot, sourceLock) {
  const ffmpegArchive = findLockedArchive(
    path.join(vcpkgRoot, 'downloads'),
    sourceLock.components.ffmpeg.sha256,
  );
  const oiioArchive = findLockedArchive(
    path.join(vcpkgRoot, 'downloads'),
    sourceLock.components.openimageio.sha256,
  );
  const licenses = {
    'FFmpeg-LICENSE.md': extractLockedText(ffmpegArchive, 'LICENSE.md'),
    'COPYING.LGPLv2.1': extractLockedText(ffmpegArchive, 'COPYING.LGPLv2.1'),
    'OpenImageIO-LICENSE.md': extractLockedText(oiioArchive, 'LICENSE.md'),
    'OpenImageIO-THIRD-PARTY.md': extractLockedText(oiioArchive, 'THIRD-PARTY.md'),
  };
  if (
    !licenses['COPYING.LGPLv2.1'].includes('GNU LESSER GENERAL PUBLIC LICENSE') ||
    !licenses['COPYING.LGPLv2.1'].includes('Version 2.1')
  ) {
    throw new Error('Locked FFmpeg COPYING.LGPLv2.1 is not the LGPL 2.1 license text.');
  }
  if (!licenses['FFmpeg-LICENSE.md'].includes('GNU Lesser General Public License version 2.1')) {
    throw new Error('Locked FFmpeg LICENSE.md does not identify the FFmpeg license.');
  }
  if (
    !licenses['OpenImageIO-LICENSE.md'].includes('Apache License') ||
    !licenses['OpenImageIO-LICENSE.md'].includes('Version 2.0')
  ) {
    throw new Error('Locked OpenImageIO LICENSE.md is not the Apache 2.0 license text.');
  }
  if (!licenses['OpenImageIO-THIRD-PARTY.md'].includes('The remainder of this file')) {
    throw new Error('Locked OpenImageIO THIRD-PARTY.md is not the expected notice file.');
  }
  return licenses;
}

function assertMacSystemDependencies(binary) {
  const lines = run('otool', ['-L', binary]).split(/\r?\n/).slice(1);
  const dependencies = lines
    .map((line) => line.trim().split(/\s+\(/, 1)[0])
    .filter(Boolean);
  const unexpected = dependencies.filter(
    (dependency) =>
      !dependency.startsWith('/usr/lib/') && !dependency.startsWith('/System/Library/'),
  );
  if (unexpected.length > 0) {
    throw new Error(
      `${binary} has non-system dynamic dependencies:\n${unexpected.join('\n')}`,
    );
  }
}

function parseStatus(statusPath, triplet) {
  const records = [];
  for (const paragraph of readFileSync(statusPath, 'utf8').split(/\r?\n\r?\n/)) {
    const record = {};
    for (const line of paragraph.split(/\r?\n/)) {
      const separator = line.indexOf(': ');
      if (separator > 0) record[line.slice(0, separator)] = line.slice(separator + 2);
    }
    if (record.Package && record.Architecture === triplet) records.push(record);
  }
  return records.sort((left, right) =>
    `${left.Package}:${left.Feature ?? ''}`.localeCompare(`${right.Package}:${right.Feature ?? ''}`),
  );
}

function generateDependencyNotices(installedRoot, targetRoot, triplet, registryCommit) {
  const records = parseStatus(path.join(installedRoot, 'vcpkg/status'), triplet);
  const packages = [...new Set(records.map((record) => record.Package))];
  const sections = [
    'Serpent media runtime dependency notices',
    `vcpkg registry commit: ${registryCommit}`,
    `target triplet: ${triplet}`,
    '',
    'Installed package records:',
    ...records.map(
      (record) =>
        `${record.Package} ${record.Version ?? '<unknown>'}` +
        (record.Feature ? ` [feature=${record.Feature}]` : ''),
    ),
  ];
  for (const packageName of packages) {
    const copyright = path.join(targetRoot, 'share', packageName, 'copyright');
    if (!existsSync(copyright) || statSync(copyright).size === 0) {
      throw new Error(`Installed vcpkg package lacks a copyright file: ${packageName}`);
    }
    sections.push('', `===== ${packageName} =====`, readFileSync(copyright, 'utf8').trim());
  }
  return `${sections.join('\n')}\n`;
}

const options = parseArguments(process.argv.slice(2));
const platform = required(options, 'platform');
if (!['darwin-arm64', 'win32-x64'].includes(platform)) throw new Error(`Unsupported ${platform}.`);
const triplet = required(options, 'triplet');
const installedRoot = path.resolve(required(options, 'installed-root'));
const vcpkgRoot = path.resolve(required(options, 'vcpkg-root'));
const resourceRoot = path.resolve(required(options, 'resource-root'));
const sourceLock = JSON.parse(
  readFileSync(path.join(resourceRoot, 'media-binaries/source-lock.json'), 'utf8'),
);
const targetRoot = path.join(installedRoot, triplet);

const names = {
  ffmpeg: executableName('ffmpeg', platform),
  ffprobe: executableName('ffprobe', platform),
  oiiotool: executableName('oiiotool', platform),
};
const sourceTools = {
  ffmpeg: findTool(targetRoot, 'ffmpeg', names.ffmpeg),
  ffprobe: findTool(targetRoot, 'ffmpeg', names.ffprobe),
  oiiotool: findTool(targetRoot, 'openimageio', names.oiiotool),
};
const ffmpegRoot = path.join(resourceRoot, 'ffmpeg', platform);
const oiioRoot = path.join(resourceRoot, 'oiio', platform);
const metadataRoot = path.join(resourceRoot, 'media-binaries', platform);
const licenseRoot = path.join(metadataRoot, 'licenses');
rmSync(ffmpegRoot, { force: true, recursive: true });
rmSync(oiioRoot, { force: true, recursive: true });
rmSync(metadataRoot, { force: true, recursive: true });
mkdirSync(ffmpegRoot, { recursive: true });
mkdirSync(oiioRoot, { recursive: true });
mkdirSync(licenseRoot, { recursive: true });

const stagedTools = {
  ffmpeg: path.join(ffmpegRoot, names.ffmpeg),
  ffprobe: path.join(ffmpegRoot, names.ffprobe),
  oiiotool: path.join(oiioRoot, names.oiiotool),
};
for (const name of Object.keys(sourceTools)) {
  copyFileSync(sourceTools[name], stagedTools[name]);
  if (platform === 'darwin-arm64') chmodSync(stagedTools[name], 0o755);
}

for (const [fileName, contents] of Object.entries(extractUpstreamLicenses(vcpkgRoot, sourceLock))) {
  writeFileSync(path.join(licenseRoot, fileName), contents, 'utf8');
}
writeFileSync(
  path.join(licenseRoot, 'Build-Dependency-NOTICES.txt'),
  generateDependencyNotices(installedRoot, targetRoot, triplet, sourceLock.registry.commit),
  'utf8',
);

for (const binary of Object.values(stagedTools)) {
  if (platform === 'darwin-arm64') assertMacSystemDependencies(binary);
  else assertWindowsSystemDependencies(binary);
}

const { manifestPath } = generateManifest({ root: resourceRoot, platform });
verifyBundle({ root: resourceRoot, platform });
console.log(`Staged and verified ${platform} media bundle: ${manifestPath}`);
