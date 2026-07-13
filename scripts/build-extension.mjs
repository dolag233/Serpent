import { copyFile, mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';
import { build } from 'vite';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(rootDir, 'extension');
const outDir = path.join(rootDir, 'dist', 'extension');
const iconSizes = [16, 32, 48, 128];

async function assertFile(relativePath) {
  const absolutePath = path.join(outDir, relativePath);
  const fileStat = await stat(absolutePath);
  if (!fileStat.isFile() || fileStat.size === 0) {
    throw new Error(`Extension build output is missing or empty: ${relativePath}`);
  }
}

async function validateBuild() {
  const manifest = JSON.parse(
    await readFile(path.join(outDir, 'manifest.json'), 'utf8'),
  );

  if (manifest.manifest_version !== 3) {
    throw new Error('Extension manifest must use Manifest V3');
  }
  if (manifest.background?.service_worker !== 'background.js') {
    throw new Error('Extension manifest must reference generated background.js');
  }
  if (!manifest.permissions?.includes('notifications')) {
    throw new Error('Extension manifest must request notifications permission');
  }
  if (!manifest.permissions?.includes('storage')) {
    throw new Error('Extension manifest must request storage permission for pairing');
  }
  if (manifest.options_page !== 'options.html') {
    throw new Error('Extension manifest must reference options.html');
  }
  if (manifest.content_scripts) {
    throw new Error('Extension must not depend on a content-script capture cache');
  }

  await assertFile('background.js');
  await assertFile('options.js');
  await assertFile('options.html');
  await assertFile('options.css');
  await assertFile('README.md');
  for (const size of iconSizes) {
    const relativePath = `icons/icon-${size}.png`;
    if (manifest.icons?.[String(size)] !== relativePath) {
      throw new Error(`Extension manifest icon ${size} must reference ${relativePath}`);
    }
    await assertFile(relativePath);
  }

  const background = await readFile(path.join(outDir, 'background.js'), 'utf8');
  if (background.includes('capturedMedia') || background.includes('capture-media')) {
    throw new Error('Generated background must not use ephemeral captured-media state');
  }

  process.stdout.write(`Verified installable extension at ${outDir}\n`);
}

async function buildExtension() {
  await rm(outDir, { recursive: true, force: true });

  await build({
    configFile: false,
    root: rootDir,
    logLevel: 'warn',
    build: {
      target: 'chrome120',
      outDir,
      emptyOutDir: true,
      minify: false,
      sourcemap: true,
      rollupOptions: {
        input: {
          background: path.join(sourceDir, 'background.ts'),
          options: path.join(sourceDir, 'options.ts'),
        },
        output: {
          entryFileNames: '[name].js',
        },
      },
    },
  });

  await copyFile(path.join(sourceDir, 'manifest.json'), path.join(outDir, 'manifest.json'));
  await copyFile(path.join(sourceDir, 'README.md'), path.join(outDir, 'README.md'));
  await copyFile(path.join(sourceDir, 'options.html'), path.join(outDir, 'options.html'));
  await copyFile(path.join(sourceDir, 'options.css'), path.join(outDir, 'options.css'));
  await mkdir(path.join(outDir, 'icons'), { recursive: true });

  const iconSource = path.join(sourceDir, 'icon.svg');
  await Promise.all(iconSizes.map(async (size) => {
    await sharp(iconSource)
      .resize(size, size)
      .png()
      .toFile(path.join(outDir, 'icons', `icon-${size}.png`));
  }));

  await validateBuild();
}

await buildExtension();
