#!/usr/bin/env node
/**
 * Replay the Poly Haven HDRI acquisition for the bundled 3D preview assets.
 *
 * Downloads the two 1K equirectangular `.hdr` environment maps (studio +
 * natural, CC0) that `src/renderer/3d-viewer/hdri-presets.ts` ships with,
 * verifying exact byte size and SHA-256 against the recorded receipt. Safe
 * to re-run: files are only written after both checks pass.
 *
 * Requires Node >= 24 (global fetch). A TLS-intercepting proxy or corporate
 * MITM CA may fail the standard handshake; pass `--insecure` as a last
 * resort (equivalent to NODE_TLS_REJECT_UNAUTHORIZED=0) and only on trusted
 * networks.
 *
 *   node scripts/acquire-hdri.mjs [--insecure]
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, '..');
const OUT_DIR = resolve(ROOT, 'src/renderer/assets/hdri');

const ASSETS = [
  {
    fileName: 'studio_small_09_1k.hdr',
    url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_09_1k.hdr',
    size: 1615248,
    sha256: 'e7cfda5f4e98e623db12b8bfd0184e048488e4855d9c83e2751fb44a32e80c45',
  },
  {
    fileName: 'kloppenheim_02_1k.hdr',
    url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/kloppenheim_02_1k.hdr',
    size: 1740414,
    sha256: '04d23c6b243742b5046310b29211aec671d7a0570f3596e1a6b43e614c9acadf',
  },
];

function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function download(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': 'Serpent-acquire-hdri/1.0' },
  });
  if (!response.ok) {
    throw new Error(`GET ${url} -> HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength === 0) {
    throw new Error(`GET ${url} -> empty response`);
  }
  return buffer;
}

async function main() {
  const insecure = process.argv.includes('--insecure');
  if (insecure) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  await mkdir(OUT_DIR, { recursive: true });
  let failed = false;

  for (const asset of ASSETS) {
    const target = join(OUT_DIR, asset.fileName);
    const existing = await readFile(target).catch(() => null);
    if (existing && existing.byteLength === asset.size && sha256Hex(existing) === asset.sha256) {
      console.log(`ok (already present): ${asset.fileName}`);
      continue;
    }

    console.log(`downloading: ${asset.url}`);
    const buffer = await download(asset.url);

    const sizeOk = buffer.byteLength === asset.size;
    const hashOk = sha256Hex(buffer) === asset.sha256;
    if (!sizeOk || !hashOk) {
      console.error(
        `FAIL ${asset.fileName}: expected size ${asset.size} (got ${buffer.byteLength}) ` +
          `and sha256 ${asset.sha256} (got ${sha256Hex(buffer)}); not writing file.`,
      );
      failed = true;
      continue;
    }

    await writeFile(target, buffer);
    console.log(`ok: ${asset.fileName} (${buffer.byteLength} bytes, sha256 ${asset.sha256.slice(0, 12)}…)`);
  }

  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`acquire-hdri failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
