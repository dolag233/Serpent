import { mkdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';
import toIco from 'to-ico';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = path.join(projectRoot, 'assets');
const defaultSource = path.join(assetsDir, 'icon-source.png');

const sourcePath = process.argv[2]
  ? path.resolve(process.argv[2])
  : defaultSource;

const iconsetDir = path.join(assetsDir, 'icon.iconset');
const icnsPath = path.join(assetsDir, 'icon.icns');
const icoPath = path.join(assetsDir, 'icon.ico');
const pngPath = path.join(assetsDir, 'icon.png');

const iconsetEntries = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
];

const icoSizes = [16, 24, 32, 48, 64, 128, 256];

async function resizePng(size) {
  return sharp(sourcePath)
    .resize(size, size, { fit: 'cover' })
    .png()
    .toBuffer();
}

async function writeMasterPng() {
  await sharp(sourcePath)
    .resize(1024, 1024, { fit: 'cover' })
    .png()
    .toFile(pngPath);
}

async function writeIco() {
  const buffers = await Promise.all(icoSizes.map((size) => resizePng(size)));
  await writeFile(icoPath, await toIco(buffers));
}

async function writeIcns() {
  if (process.platform !== 'darwin') {
    console.warn('[icons] skipping icon.icns generation (iconutil is macOS-only)');
    return;
  }

  await rm(iconsetDir, { recursive: true, force: true });
  await mkdir(iconsetDir, { recursive: true });

  await Promise.all(
    iconsetEntries.map(async ([filename, size]) => {
      await sharp(sourcePath)
        .resize(size, size, { fit: 'cover' })
        .png()
        .toFile(path.join(iconsetDir, filename));
    }),
  );

  const result = spawnSync('iconutil', ['-c', 'icns', iconsetDir, '-o', icnsPath], {
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`iconutil failed with exit code ${String(result.status)}`);
  }

  await rm(iconsetDir, { recursive: true, force: true });
}

async function main() {
  await mkdir(assetsDir, { recursive: true });
  if (process.argv[2]) {
    await sharp(sourcePath)
      .png()
      .toFile(defaultSource);
    console.log(`[icons] saved source copy to ${path.relative(projectRoot, defaultSource)}`);
  }

  await writeMasterPng();
  await writeIco();
  await writeIcns();

  console.log('[icons] generated:');
  console.log(`  - ${path.relative(projectRoot, pngPath)}`);
  console.log(`  - ${path.relative(projectRoot, icoPath)}`);
  if (process.platform === 'darwin') {
    console.log(`  - ${path.relative(projectRoot, icnsPath)}`);
  }
}

await main();
