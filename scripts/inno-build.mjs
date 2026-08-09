#!/usr/bin/env node
/**
 * Serpent Windows 安装器（Inno Setup）构建脚本。
 *
 * 流程：ISCC.exe 编译 assets/inno/serpentsetup.iss → out/make/inno/SerpentSetup.exe，
 * 并校验产物（存在 + 非空）。
 *
 * 前置：
 *   - 已执行 npm run package（Inno 从 out/Serpent-win32-x64 打包）
 *   - Inno Setup 工具：SERPENT_INNO_TOOLS 指向含 ISCC.exe 的目录，否则
 *     默认 %LOCALAPPDATA%\SerpentTools\inno\tools（NuGet Tools.InnoSetup
 *     解压即用，见 CLAUDE.md）
 *
 * 用法：node scripts/inno-build.mjs [--out <dir>]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, statSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 从 package.json 读版本（npm version 提升后自动跟随）。 */
function packageVersion() {
  try {
    const manifest = JSON.parse(
      readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
    );
    if (typeof manifest.version === 'string' && manifest.version.trim()) {
      return manifest.version.trim();
    }
  } catch {
    // fall through to default
  }
  return '0.1.0';
}

const defaultIscc = process.env.SERPENT_INNO_TOOLS
  ? path.resolve(process.env.SERPENT_INNO_TOOLS, 'ISCC.exe')
  : path.join(process.env.LOCALAPPDATA || '', 'SerpentTools', 'inno', 'tools', 'ISCC.exe');

const defaultOut = path.join(repoRoot, 'out', 'make', 'inno');

function fail(message) {
  console.error(`[inno-build] FAILED: ${message}`);
  process.exit(1);
}

function main() {
  const outDir = process.argv.includes('--out')
    ? path.resolve(process.argv[process.argv.indexOf('--out') + 1])
    : defaultOut;

  if (!existsSync(defaultIscc)) {
    fail(`ISCC.exe not found at ${defaultIscc} (set SERPENT_INNO_TOOLS or install per CLAUDE.md)`);
  }
  const packageDir = path.join(repoRoot, 'out', 'Serpent-win32-x64');
  if (!existsSync(packageDir)) {
    fail(`Packaged app not found: ${packageDir} (run npm run package first)`);
  }

  mkdirSync(outDir, { recursive: true });
  const version = packageVersion();
  const result = spawnSync(
    defaultIscc,
    [
      `/DAppVersion=${version}`,
      path.join(repoRoot, 'assets', 'inno', 'serpentsetup.iss'),
    ],
    {
      cwd: repoRoot,
      stdio: 'inherit',
      shell: false,
    },
  );
  if (result.error || result.status !== 0) {
    fail(`ISCC exited with ${String(result.status)} (${result.error?.message ?? 'see output above'})`);
  }

  const setupExe = path.join(outDir, 'SerpentSetup.exe');
  if (!existsSync(setupExe) || statSync(setupExe).size < 100 * 1024 * 1024) {
    fail(`Installer not produced or suspiciously small: ${setupExe}`);
  }
  console.log(`[inno-build] Windows installer written to ${setupExe} (${(statSync(setupExe).size / 1024 / 1024).toFixed(1)} MB)`);
}

main();
