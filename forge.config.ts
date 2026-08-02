import type { ForgeConfig } from '@electron-forge/shared-types';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { VitePlugin } from '@electron-forge/plugin-vite';

const projectRoot = import.meta.dirname;
const appIconBase = path.join(projectRoot, 'assets', 'icons', 'app');

function nativeMediaPlatform(platform: string, arch: string): string {
  const expectedHost = `${process.platform}-${process.arch}`;
  const target = `${platform}-${arch}`;
  if (target !== expectedHost || !['darwin-arm64', 'win32-x64'].includes(target)) {
    throw new Error(
      `Serpent release packages must be built and media-verified natively; host=${expectedHost}, target=${target}.`,
    );
  }
  return target;
}

function runNodeGate(script: string, args: string[], extraEnv?: NodeJS.ProcessEnv): void {
  const result = spawnSync(process.execPath, [path.join(projectRoot, script), ...args], {
    cwd: projectRoot,
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${script} release gate exited with ${String(result.status)}.`);
  }
}

const config: ForgeConfig = {
  hooks: {
    // These hooks are part of Forge itself, so invoking `electron-forge`
    // directly cannot bypass either the promoted-source gate or verification
    // of the bytes that Packager actually copied.
    prePackage: async (_forgeConfig, platform, arch) => {
      const mediaPlatform = nativeMediaPlatform(platform, arch);
      runNodeGate('scripts/media-binaries.mjs', ['verify', '--platform', mediaPlatform]);
    },
    postPackage: async (_forgeConfig, packageResult) => {
      nativeMediaPlatform(packageResult.platform, packageResult.arch);
      for (const outputPath of packageResult.outputPaths) {
        runNodeGate('scripts/verify-package.mjs', [], {
          SERPENT_PACKAGE_ROOT: outputPath,
        });
      }
    },
    // Forge supports `make --skip-package`; verify the exact default package
    // input again so that shortcut cannot feed stale or modified bytes to a
    // maker without passing the package gate.
    preMake: async () => {
      const mediaPlatform = nativeMediaPlatform(process.platform, process.arch);
      runNodeGate('scripts/media-binaries.mjs', ['verify', '--platform', mediaPlatform]);
      runNodeGate('scripts/verify-package.mjs', [], {
        SERPENT_PACKAGE_ROOT: path.join(projectRoot, 'out', `Serpent-${mediaPlatform}`),
      });
    },
  },
  packagerConfig: {
    icon: appIconBase,
    asar: {
      unpack: '**/node_modules/trash/lib/{macos-trash,windows-trash.exe}',
    },
    // Media executables must remain outside app.asar so the Library Worker can
    // spawn them. `npm run media:verify` is the release gate that validates the
    // platform bundle before packaging; `verify:package` repeats the same
    // checks against this copied directory.
    extraResource: ['resources'],
    // Forge's Vite plugin otherwise excludes all node_modules. Keep them in the
    // copy set so Packager can prune to production dependencies and the native
    // module plugin can unpack better-sqlite3.
    ignore: (file) => {
      if (!file) return false;
      return !file.startsWith('/.vite') && !file.startsWith('/node_modules');
    },
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      setupIcon: `${appIconBase}.ico`,
    }),
    new MakerZIP({}, ['darwin', 'win32']),
    new MakerDMG({}),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        {
          entry: 'src/main/index.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/index.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
        {
          entry: 'src/worker/index.ts',
          config: 'vite.worker.config.ts',
          target: 'main',
        },
        {
          entry: 'src/scripting/script-runtime-utility-entry.ts',
          config: 'vite.script-runtime.config.ts',
          target: 'main',
        },
        {
          entry: 'src/scripting/plugin-standard-host-entry.ts',
          config: 'vite.plugin-runtime.config.ts',
          target: 'main',
        },
        {
          entry: 'src/scripting/plugin-trusted-host-entry.ts',
          config: 'vite.plugin-trusted-runtime.config.ts',
          target: 'main',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
  ],
};

export default config;
