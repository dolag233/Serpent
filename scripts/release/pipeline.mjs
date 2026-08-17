#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  collectMakeArtifacts,
  currentVersion,
  repoRoot,
  resolvePackagedExecutable,
  runNpmScript,
  writeChecksumManifest,
} from './lib.mjs';
import { currentPlatformKey } from '../media-binaries-lib.mjs';

const PHASES = ['verify', 'media', 'package', 'e2e', 'make', 'checksums', 'all'];

/** @type {Record<string, string>} */
const pipelineEnv = {};

function printUsage() {
  process.stdout.write(
    [
      'Usage: npm run release:<phase>',
      '',
      'Phases:',
      '  verify     rebuild:native + verify:mainline (same gates as CI)',
      '  media      media:acquire + media:verify (or local build with --build-media-locally)',
      '  package    package + verify:package',
      '  e2e        test:e2e:packaged against the packaged app',
      '  make       electron-forge make',
      '  checksums  SHA-256 manifests for out/make artifacts',
      '  all        run every phase in order (release:local)',
      '',
      'Flags (release:local only):',
      '  --skip-verify           skip rebuild + mainline verification',
      '  --skip-media            skip media acquire/build',
      '  --skip-e2e              skip packaged startup E2E',
      '  --build-media-locally   build media via scripts/media-build/* on this machine',
      '                          (dev trial only; skips HTTPS bundle-lock provenance)',
      '',
    ].join('\n'),
  );
}

function parseArgs(argv) {
  const flags = new Set();
  const positional = [];

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
    if (arg.startsWith('--')) {
      flags.add(arg);
      continue;
    }
    positional.push(arg);
  }

  return { flags, phase: positional[0] ?? 'all' };
}

function runReleaseScript(scriptName, extraEnv = {}) {
  runNpmScript(scriptName, extraEnv, pipelineEnv);
}

function assertMediaBundleReady() {
  const lockPath = path.join(repoRoot, 'resources/media-binaries/bundle-lock.json');
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  const platform = currentPlatformKey();
  const entry = lock.bundles?.[platform];

  if (!entry || entry.status === 'build-required') {
    const reason = entry?.reason ?? 'bundle-lock has no ready entry for this platform.';
    const buildScript = platform === 'darwin-arm64'
      ? 'scripts/media-build/darwin-arm64.sh'
      : 'scripts/media-build/win32-x64.ps1';

    console.error(
      [
        '',
        `[release:media] Blocked: ${platform} is still build-required.`,
        reason,
        '',
        'What "晋升" means:',
        '- bundle-lock.json still says build-required: no trusted HTTPS download URL exists yet.',
        '- "晋升" promotes the built ZIP + manifest hashes into bundle-lock as status=ready.',
        '- After promotion, release:media downloads that immutable bundle (media:acquire).',
        '',
        'For a local end-to-end trial without promotion, re-run with:',
        '  npm run release:local -- --skip-verify --build-media-locally',
        '',
        'Production release steps:',
        `1. Build locally: ${buildScript}`,
        '   or trigger the "Media binary bundles" GitHub workflow.',
        '2. Promote the immutable bundle URL and checksums into',
        '   resources/media-binaries/bundle-lock.json.',
        '3. Re-run: npm run release:media',
        '',
      ].join('\n'),
    );
    process.exit(1);
  }
}

function phaseMediaBuildLocally() {
  const platform = currentPlatformKey();
  const buildCommand = platform === 'darwin-arm64'
    ? { command: 'bash', args: ['scripts/media-build/darwin-arm64.sh'] }
    : { command: 'pwsh', args: ['-File', 'scripts/media-build/win32-x64.ps1'] };

  process.stdout.write(
    `\n[release:media] Building ${platform} media bundle locally (this can take 1-3+ hours)...\n`,
  );
  const result = spawnSync(buildCommand.command, buildCommand.args, {
    cwd: repoRoot,
    env: { ...process.env, ...pipelineEnv },
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  pipelineEnv.SERPENT_MEDIA_SKIP_PROVENANCE = '1';
  process.env.SERPENT_MEDIA_SKIP_PROVENANCE = '1';
  runReleaseScript('media:verify');
}

function phaseVerify() {
  runReleaseScript('rebuild:native');
  runReleaseScript('verify:mainline');
}

function phaseMedia({ buildMediaLocally }) {
  if (buildMediaLocally) {
    phaseMediaBuildLocally();
    return;
  }

  assertMediaBundleReady();
  runReleaseScript('media:acquire');
  runReleaseScript('media:verify');
}

function phasePackage() {
  runReleaseScript('package');
  runReleaseScript('verify:package');
}

function phaseE2E() {
  const executable = resolvePackagedExecutable();
  runReleaseScript('test:e2e:packaged', {
    SERPENT_E2E_PACKAGED_EXECUTABLE: executable,
  });
}

function phaseMake() {
  runReleaseScript('make');
  // Windows 安装器（Inno Setup）在 Windows 原生环境构建；
  // macOS 不产安装器（dmg 已由 make 产出）。
  if (process.platform === 'win32') {
    runReleaseScript('make:inno');
  }
}

function phaseChecksums() {
  const artifacts = collectMakeArtifacts();
  if (artifacts.length === 0) {
    console.error('[release:checksums] No artifacts found under out/make/. Did make succeed?');
    process.exit(1);
  }

  const manifestPath = path.join(
    repoRoot,
    'out',
    'make',
    `SHA256SUMS-${currentPlatformKey()}.txt`,
  );
  writeChecksumManifest(artifacts, manifestPath);

  for (const artifact of artifacts) {
    writeChecksumManifest([artifact], `${artifact}.sha256`);
  }
}

function main() {
  const { flags, phase } = parseArgs(process.argv.slice(2));

  if (!PHASES.includes(phase)) {
    console.error(`Unknown phase ${JSON.stringify(phase)}. Expected one of: ${PHASES.join(', ')}`);
    printUsage();
    process.exit(2);
  }

  // Every release phase runs against an explicit semver from package.json;
  // bump with `npm version patch|minor|major` before releasing.
  console.log(`[release] Serpent v${currentVersion()} on ${currentPlatformKey()}`);

  const options = {
    skipVerify: flags.has('--skip-verify'),
    skipMedia: flags.has('--skip-media'),
    skipE2E: flags.has('--skip-e2e'),
    buildMediaLocally: flags.has('--build-media-locally'),
  };

  const sequence = phase === 'all'
    ? ['verify', 'media', 'package', 'e2e', 'make', 'checksums']
    : [phase];

  for (const step of sequence) {
    if (options.skipVerify && step === 'verify') {
      console.warn('[release] Skipping verify (--skip-verify).');
      continue;
    }
    if (options.skipMedia && step === 'media') {
      console.warn(
        '[release] Skipping media (--skip-media). package/make will still require verified media.',
      );
      continue;
    }
    if (options.skipE2E && step === 'e2e') {
      console.warn('[release] Skipping packaged E2E (--skip-e2e).');
      continue;
    }

    process.stdout.write(`\n========== release:${step} ==========\n`);
    if (step === 'media') {
      phaseMedia(options);
      continue;
    }

    const runners = {
      verify: phaseVerify,
      package: phasePackage,
      e2e: phaseE2E,
      make: phaseMake,
      checksums: phaseChecksums,
    };
    runners[step]();
  }

  console.log(`\n[release] Phase ${phase} completed successfully.`);
}

main();
