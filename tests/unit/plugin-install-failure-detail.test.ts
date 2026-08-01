import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createPluginPackageRequestHandler } from '../../src/main/plugin-package-ipc';
import { PluginPackageManager } from '../../src/main/plugin-package-manager';
import manifestFixture from '../fixtures/plugin-manifests/palette-tools.serpent-plugin.json';

const roots: string[] = [];

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function writePlugin(directory: string): void {
  mkdirSync(path.join(directory, 'dist', 'ui'), { recursive: true });
  writeFileSync(path.join(directory, 'serpent-plugin.json'), `${JSON.stringify(manifestFixture, null, 2)}\n`);
  writeFileSync(path.join(directory, 'dist', 'main.js'), 'export const version = "1.2.0";\n');
  writeFileSync(path.join(directory, 'dist', 'ui', 'index.html'), '<main>palette</main>\n');
  writeFileSync(path.join(directory, 'README.md'), '# Palette Tools\n');
  writeFileSync(path.join(directory, 'LICENSE'), 'MIT\n');
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('plugin install failure detail', () => {
  it('returns failureCode and message when a non-.bin symlink blocks install', async () => {
    const source = temporaryRoot('serpent-plugin-symlink-');
    const userData = temporaryRoot('serpent-plugin-symlink-user-');
    writePlugin(source);
    writeFileSync(path.join(source, 'real.js'), 'export {};\n');
    symlinkSync('real.js', path.join(source, 'alias.js'));
    const handler = createPluginPackageRequestHandler({
      manager: new PluginPackageManager({
        userDataDirectory: userData,
        deviceId: 'test-device',
        serpentVersion: '0.2.4',
        pluginApiVersion: 1,
        platform: 'darwin',
        arch: 'arm64',
        nodeAbi: 140,
      }),
      resolveLibraryDirectory: async () => undefined,
      chooseLocalPackage: async () => source,
    });

    await expect(handler({ type: 'plugin-manager.install-local', scope: 'user' })).resolves.toMatchObject({
      ok: false,
      code: 'operation-failed',
      failureCode: 'PLUGIN_SOURCE_SYMLINK_FORBIDDEN',
      message: expect.stringContaining('alias.js'),
    });
  });

  it('ignores npm node_modules/.bin shims so packaged deps can install', async () => {
    const source = temporaryRoot('serpent-plugin-npmbin-');
    const userData = temporaryRoot('serpent-plugin-npmbin-user-');
    writePlugin(source);
    mkdirSync(path.join(source, 'node_modules', 'semver'), { recursive: true });
    mkdirSync(path.join(source, 'node_modules', '.bin'), { recursive: true });
    writeFileSync(path.join(source, 'node_modules', 'semver', 'index.js'), 'module.exports = {};\n');
    symlinkSync('../semver/index.js', path.join(source, 'node_modules', '.bin', 'semver'));
    const handler = createPluginPackageRequestHandler({
      manager: new PluginPackageManager({
        userDataDirectory: userData,
        deviceId: 'test-device',
        serpentVersion: '0.2.4',
        pluginApiVersion: 1,
        platform: 'darwin',
        arch: 'arm64',
        nodeAbi: 140,
      }),
      resolveLibraryDirectory: async () => undefined,
      chooseLocalPackage: async () => source,
    });

    const installed = await handler({ type: 'plugin-manager.install-local', scope: 'user' });
    expect(installed).toMatchObject({ ok: true });
    expect(JSON.stringify(installed)).not.toContain(source);
  });
});
