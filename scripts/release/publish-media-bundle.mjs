#!/usr/bin/env node
/**
 * 上传媒体 bundle 到 Serpent-Build Release（不可变 URL + SHA-256 校验）。
 *
 * 用法：
 *   node scripts/release/publish-media-bundle.mjs \
 *     --platform win32-x64 --version v0.1.0 \
 *     --zip artifacts/media-binaries/serpent-media-win32-x64.zip
 *
 * 认证：GITHUB_TOKEN 环境变量，或 git credential（HTTPS）。
 * 流程：创建/复用 Release（media-<version>）→ 上传 zip + .sha256 +
 * manifest.sha256 → 打印 bundle-lock 晋升条目。
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
    fail('Usage: --platform win32-x64 --version v0.1.0 --zip <bundle.zip>');
  }
  if (!['win32-x64', 'darwin-arm64'].includes(platform)) fail(`Unsupported platform ${platform}.`);

  const zipPath = path.resolve(repoRoot, zip);
  const zipSha = createHash('sha256').update(readFileSync(zipPath)).digest('hex');
  const shaPath = `${zipPath}.sha256`;
  const manifestShaPath = zipPath.replace(/\.zip$/, '.manifest.sha256');

  const tag = `media-${version}`;
  const assetFiles = [zipPath];
  for (const extra of [shaPath, manifestShaPath]) {
    if (readFileSync(extra, 'utf8').trim()) assetFiles.push(extra);
  }

  console.log(`[publish-media] Release ${tag} for ${platform}`);
  console.log(`  zip sha256: ${zipSha}`);
  console.log(`  size: ${(statSync(zipPath).size / 1024 / 1024).toFixed(1)} MB`);

  // draft release 无法通过 /releases/tags/{tag} 访问（该端点只对已发布
  // release 生效），统一走 /releases 列表拿 release id。
  api(`/repos/${BUILD_REPO}/releases?per_page=100`)
    .then(async (listResponse) => {
      const releases = await listResponse.json();
      let release = releases.find((r) => r.tag_name === tag);
      let uploadUrl;
      if (!release) {
        const created = await api(`/repos/${BUILD_REPO}/releases`, {
          method: 'POST',
          body: JSON.stringify({
            tag_name: tag,
            name: `Serpent media bundle ${version}`,
            draft: true,
            prerelease: true,
            generate_release_notes: false,
          }),
        });
        release = await created.json();
        uploadUrl = release.upload_url;
      } else {
        uploadUrl = release.upload_url;
      }
      const releaseId = release.id;

      for (const file of assetFiles) {
        const name = path.basename(file);
        const upload = await fetch(uploadUrl.replace('{?name,label}', `?name=${encodeURIComponent(name)}`), {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.GITHUB_TOKEN || tokenFromGitCredential()}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/octet-stream',
          },
          body: readFileSync(file),
        });
        if (!upload.ok) fail(`Upload ${name} → ${upload.status}: ${(await upload.text()).slice(0, 200)}`);
        console.log(`  uploaded ${name}`);
      }

      // 发布（draft → published；Immutable Releases 下发布即不可变）。
      // 注意：PATCH 只能用 /releases/{id}（/releases/tags/{tag} 只支持 GET）。
      await api(`/repos/${BUILD_REPO}/releases/${releaseId}`, {
        method: 'PATCH',
        body: JSON.stringify({ draft: false }),
      });
      console.log(`[publish-media] Release published: https://github.com/${BUILD_REPO}/releases/tag/${tag}`);

      // bundle-lock 晋升条目（贴给主仓库）
      console.log(`\n[bundle-lock] ${platform} promotion entry:`);
      console.log(JSON.stringify({
        status: 'ready',
        url: `https://github.com/${BUILD_REPO}/releases/download/${tag}/${path.basename(zipPath)}`,
        sha256: zipSha,
        size: statSync(zipPath).size,
        manifestSha256: readFileSync(manifestShaPath, 'utf8').trim().split(/\s+/)[0],
      }, null, 1));
    })
    .catch((error) => fail(error.message));
}

main();
