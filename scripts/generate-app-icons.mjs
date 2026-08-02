import { mkdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import sharp from 'sharp';
import toIco from 'to-ico';

import {
  generatedAppIcons,
  iconAssetsDir,
  iconSources,
} from './icon-assets.mjs';

const iconsetDir = path.join(iconAssetsDir, 'app.iconset');

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

// These ICNS entries use PNG payloads and are understood by current macOS
// releases. Keeping the fallback here lets Windows regenerate the complete
// cross-platform icon bundle even though Apple's `iconutil` is unavailable.
const portableIcnsEntries = [
  ['ic11', 32],
  ['ic12', 64],
  ['ic07', 128],
  ['ic08', 256],
  ['ic13', 256],
  ['ic09', 512],
  ['ic14', 512],
  ['ic10', 1024],
];

async function resizePng(size) {
  return sharp(iconSources.app)
    .resize(size, size, { fit: 'cover' })
    .png()
    .toBuffer();
}

async function writeMasterPng() {
  await sharp(iconSources.app)
    .resize(1024, 1024, { fit: 'cover' })
    .png()
    .toFile(generatedAppIcons.png);
}

async function writeIco() {
  const buffers = await Promise.all(icoSizes.map((size) => resizePng(size)));
  await writeFile(generatedAppIcons.ico, await toIco(buffers));
}

async function writePortableIcns() {
  const entries = await Promise.all(
    portableIcnsEntries.map(async ([type, size]) => {
      const payload = await resizePng(size);
      const header = Buffer.alloc(8);
      header.write(type, 0, 4, 'ascii');
      header.writeUInt32BE(payload.length + header.length, 4);
      return Buffer.concat([header, payload]);
    }),
  );
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(header.length + entries.reduce((total, entry) => total + entry.length, 0), 4);
  await writeFile(generatedAppIcons.icns, Buffer.concat([header, ...entries]));
}

async function writeIcns() {
  if (process.platform !== 'darwin') {
    console.warn('[icons] iconutil is macOS-only; generating a portable PNG-based app.icns');
    await writePortableIcns();
    return;
  }

  await rm(iconsetDir, { recursive: true, force: true });
  await mkdir(iconsetDir, { recursive: true });

  await Promise.all(
    iconsetEntries.map(async ([filename, size]) => {
      await sharp(iconSources.app)
        .resize(size, size, { fit: 'cover' })
        .png()
        .toFile(path.join(iconsetDir, filename));
    }),
  );

  const result = spawnSync(
    'iconutil',
    ['-c', 'icns', iconsetDir, '-o', generatedAppIcons.icns],
    { stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`iconutil failed with exit code ${String(result.status)}`);
  }

  await rm(iconsetDir, { recursive: true, force: true });
}

async function main() {
  await mkdir(iconAssetsDir, { recursive: true });
  await writeMasterPng();
  await writeIco();
  await writeIcns();

  console.log('[icons] generated from assets/icons/source-app.png:');
  console.log(`  - assets/icons/app.png`);
  console.log(`  - assets/icons/app.ico`);
  console.log(`  - assets/icons/app.icns`);
}

await main();
