#!/usr/bin/env node
/**
 * 上传媒体 bundle 到 Serpent-Build Release（单一 Release + 标准 asset 名）。
 *
 * 策略（2026-08-08 产品确定）：
 *   - 只保留一个 Release（tag media-v0.1.1，标题 SerpentBuildDependencies）
 *   - asset 用标准名（serpent-media-<platform>.zip），更新时删除旧资产再上传
 *
 * 用法：
 *   node scripts/release/publish-media-bundle.mjs \
 *     --platform win32-x64 --version v0.1.1 \
 *     --zip artifacts/media-binaries/serpent-media-win32-x64.zip
 *
 * 认证：GITHUB_TOKEN 环境变量，或 git credential（HTTPS）。
 */
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BUILD_REPO = 'dolag233/Serpent-Build';

function fail(message) {
  console.error(`[publish-media] FAILED: ${message}`);
  process.exit(1);
}

function tokenFromGitCredential() {
  try {
    const out = execFileSync('git', ['credential', 'fill'], {
      input: 'protocol=https\nhost=github.com\n',
      encoding: 'utf8',
    });
    const match = out.match(/^password=(.+)$/m);
    return match?.[1];
  } catch {
    return undefined;
  }
}

async function api(pathname, options = {}) {
  const token = process.env.GITHUB_TOKEN || tokenFromGitCredential();
  if (!token) fail('No GitHub token (set GITHUB_TOKEN or configure git credential).');
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    ...(options.headers ?? {}),
  };
  const response = await fetch(`https://api.github.com${pathname}`, { ...options, headers });
  if (!response.ok && response.status !== 404) {
    const body = await response.text();
    fail(`GitHub API ${options.method ?? 'GET'} ${pathname} → ${response.status}: ${body.slice(0, 300)}`);
  }
  return response;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i]?.startsWith('--')) args[argv[i].slice(2)] = argv[i + 1];
  }
  return args;
}

function main() {
  const { platform, version, zip } = parseArgs(process.argv.slice(2));
  if (!platform || !version || !zip) {
    fail('Usage: --platform win32-x64 --version v0.1.1 --zip <bundle.zip>');
  }
  if (!['win32-x64', 'darwin-arm64'].includes(platform)) fail(`Unsupported platform ${platform}.`);

  const zipPath = path.resolve(repoRoot, zip);
  const zipSha = createHash('sha256').update(readFileSync(zipPath)).digest('hex');
  const shaPath = `${zipPath}.sha256`;
  const manifestShaPath = zipPath.replace(/\.zip$/, '.manifest.sha256');

  // 标准 asset 名（先删旧资产再上传，避免同名冲突）
  const base = `serpent-media-${platform}`;
  const assetFiles = [
    [zipPath, `${base}.zip`],
    [shaPath, `${base}.zip.sha256`],
    [manifestShaPath, `${base}.manifest.sha256`],
  ];

  console.log(`[publish-media] Uploading ${base} to ${BUILD_REPO} Release ${version}`);
  console.log(`  zip sha256: ${zipSha}`);
  console.log(`  size: ${(statSync(zipPath).size / 1024 / 1024).toFixed(1)} MB`);

  api(`/repos/${BUILD_REPO}/releases?per_page=100`)
    .then(async (listResponse) => {
      const releases = await listResponse.json();
      const release = releases.find((r) => r.tag_name === version);
      if (!release) fail(`Release ${version} not found (create it manually or fix --version).`);
      const uploadUrl = release.upload_url;
      const token = process.env.GITHUB_TOKEN || tokenFromGitCredential();

      // 删除同名旧资产（Release 允许删 asset）
      for (const [, name] of assetFiles) {
        const existing = (release.assets ?? []).find((a) => a.name === name);
        if (existing) {
          const del = await api(`/repos/${BUILD_REPO}/releases/assets/${existing.id}`, { method: 'DELETE' });
          if (!del.ok && del.status !== 404) fail(`Delete ${name} → ${del.status}`);
          console.log(`  removed old ${name}`);
        }
      }

      for (const [file, name] of assetFiles) {
        const upload = await fetch(uploadUrl.replace('{?name,label}', `?name=${encodeURIComponent(name)}`), {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/octet-stream',
          },
          body: readFileSync(file),
        });
        if (!upload.ok) fail(`Upload ${name} → ${upload.status}: ${(await upload.text()).slice(0, 200)}`);
        console.log(`  uploaded ${name}`);
      }

      console.log(`[publish-media] Done: https://github.com/${BUILD_REPO}/releases/tag/${version}`);
      console.log('\n[bundle-lock] promotion entry:');
      console.log(JSON.stringify({
        status: 'ready',
        url: `https://github.com/${BUILD_REPO}/releases/download/${version}/${base}.zip`,
        sha256: zipSha,
        size: statSync(zipPath).size,
        manifestSha256: readFileSync(manifestShaPath, 'utf8').trim().split(/\s+/)[0],
      }, null, 1));
    })
    .catch((error) => fail(error.message));
}

main();
