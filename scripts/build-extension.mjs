import { copyFile, mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';
import { build } from 'vite';

import {
  extensionIconSizes,
  iconSources,
} from './icon-assets.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(rootDir, 'extension');
const outDir = path.join(rootDir, 'dist', 'extension');
const iconSizes = extensionIconSizes;

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
    throw new Error('Extension manifest must request storage permission for recent folders');
  }
  if (!manifest.permissions?.includes('alarms')) {
    throw new Error('Extension manifest must request alarms permission for connection checks');
  }
  if (!manifest.action?.default_icon?.['32']?.includes('icon-gray-32.png')) {
    throw new Error('Extension action must default to the gray toolbar icon');
  }
  if (manifest.options_page !== 'options.html') {
    throw new Error('Extension manifest must reference options.html');
  }
  const contentScript = manifest.content_scripts?.[0];
  if (!contentScript?.js?.includes('content-script.js')) {
    throw new Error('Extension manifest must register content-script.js on http(s) pages');
  }

  await assertFile('background.js');
  await assertFile('content-script.js');
  await assertFile('options.js');
  await assertFile('options.html');
  await assertFile('options.css');
  await assertFile('README.md');

  // 三个脚本都必须是自包含单文件。多入口同一次构建会让 Rollup 抽取共享 chunk，
  // 产物首行出现 import 语句；Chrome content script 不能是 ES module，
  // 整个脚本会解析失败、静默失效（2026-07-25 实测事故）。
  for (const relativePath of ['background.js', 'content-script.js', 'options.js']) {
    const source = await readFile(path.join(outDir, relativePath), 'utf8');
    if (/^(?:import|export)\s/m.test(source)) {
      throw new Error(
        `${relativePath} must be a self-contained single file (found top-level import/export)`,
      );
    }
  }
  for (const size of iconSizes) {
    const relativePath = `icons/icon-${size}.png`;
    if (manifest.icons?.[String(size)] !== relativePath) {
      throw new Error(`Extension manifest icon ${size} must reference ${relativePath}`);
    }
    await assertFile(relativePath);
    const grayRelativePath = `icons/icon-gray-${size}.png`;
    if (manifest.action?.default_icon?.[String(size)] !== grayRelativePath) {
      throw new Error(`Extension action icon ${size} must reference ${grayRelativePath}`);
    }
    await assertFile(grayRelativePath);
  }

  const background = await readFile(path.join(outDir, 'background.js'), 'utf8');
  if (background.includes('capturedMedia') || background.includes('capture-media')) {
    throw new Error('Generated background must not use ephemeral captured-media state');
  }

  process.stdout.write(`Verified installable extension at ${outDir}\n`);
}

/**
 * 三个入口各自独立打包：单入口构建会把全部静态依赖内联进一个文件，
 * 不会产生共享 chunk。content script 必须是 classic script（IIFE）；
 * background（manifest "type": "module"）与 options（type="module" 引入）
 * 同样输出无任何 import 的单文件，杜绝 chunk 解析依赖。
 */
const scriptEntries = [
  { name: 'background', format: 'es' },
  { name: 'content-script', format: 'iife' },
  { name: 'options', format: 'es' },
];

async function bundleScriptEntries() {
  for (const [index, entry] of scriptEntries.entries()) {
    await build({
      configFile: false,
      root: rootDir,
      logLevel: 'warn',
      build: {
        target: 'chrome120',
        outDir,
        emptyOutDir: index === 0,
        minify: false,
        sourcemap: true,
        rollupOptions: {
          input: path.join(sourceDir, `${entry.name}.ts`),
          output: {
            format: entry.format,
            codeSplitting: false,
            entryFileNames: `${entry.name}.js`,
          },
        },
      },
    });
  }
}

async function buildExtension() {
  await rm(outDir, { recursive: true, force: true });

  await bundleScriptEntries();

  await copyFile(path.join(sourceDir, 'manifest.json'), path.join(outDir, 'manifest.json'));
  await copyFile(path.join(sourceDir, 'README.md'), path.join(outDir, 'README.md'));
  await copyFile(path.join(sourceDir, 'options.html'), path.join(outDir, 'options.html'));
  await copyFile(path.join(sourceDir, 'options.css'), path.join(outDir, 'options.css'));
  await mkdir(path.join(outDir, 'icons'), { recursive: true });

  await Promise.all(iconSizes.flatMap((size) => [
    sharp(iconSources.extensionActive)
      .resize(size, size, { fit: 'cover' })
      .png()
      .toFile(path.join(outDir, 'icons', `icon-${size}.png`)),
    sharp(iconSources.extensionInactive)
      .resize(size, size, { fit: 'cover' })
      .png()
      .toFile(path.join(outDir, 'icons', `icon-gray-${size}.png`)),
  ]));

  await validateBuild();
}

await buildExtension();
