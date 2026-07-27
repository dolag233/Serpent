import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { currentPlatformKey } from '../media-binaries-lib.mjs';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const DISTRIBUTABLE_EXTENSIONS = new Set(['.exe', '.dmg', '.zip', '.nupkg']);
const DISTRIBUTABLE_BASENAMES = new Set(['RELEASES']);

export function runNpmScript(scriptName, extraEnv = {}, pipelineEnv = {}) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) {
    throw new Error(`${scriptName} must be launched through npm (npm_execpath missing).`);
  }

  process.stdout.write(`\n[release] npm run ${scriptName}\n`);
  const result = spawnSync(process.execPath, [npmCli, 'run', scriptName], {
    cwd: repoRoot,
    env: { ...process.env, ...pipelineEnv, ...extraEnv },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

export function packageDirectoryName() {
  return `Serpent-${process.platform}-${process.arch}`;
}

export function defaultPackageRoot() {
  return path.join(repoRoot, 'out', packageDirectoryName());
}

export function resolvePackagedExecutable(packageRoot = defaultPackageRoot()) {
  if (process.platform === 'darwin') {
    const executable = path.join(packageRoot, 'Serpent.app', 'Contents', 'MacOS', 'Serpent');
    if (!existsSync(executable)) {
      throw new Error(`Packaged executable not found: ${executable}`);
    }
    return executable;
  }

  if (process.platform === 'win32') {
    const executable = path.join(packageRoot, 'Serpent.exe');
    if (!existsSync(executable)) {
      throw new Error(`Packaged executable not found: ${executable}`);
    }
    return executable;
  }

  throw new Error(`Unsupported platform for packaged E2E: ${process.platform}`);
}

export function collectMakeArtifacts(makeRoot = path.join(repoRoot, 'out', 'make')) {
  if (!existsSync(makeRoot)) {
    return [];
  }

  const files = [];
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();
      if (DISTRIBUTABLE_EXTENSIONS.has(extension) || DISTRIBUTABLE_BASENAMES.has(entry.name)) {
        files.push(absolutePath);
      }
    }
  }

  walk(makeRoot);
  return files.sort();
}

export function writeChecksumManifest(files, outputPath) {
  const lines = files.map((filePath) => {
    const hash = createHash('sha256');
    hash.update(readFileSync(filePath));
    const relativePath = path.relative(repoRoot, filePath).replaceAll('\\', '/');
    return `${hash.digest('hex')}  ${relativePath}`;
  });

  writeFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');
  console.log(`Wrote checksum manifest: ${outputPath}`);
  return outputPath;
}

export function platformKey() {
  return currentPlatformKey();
}
