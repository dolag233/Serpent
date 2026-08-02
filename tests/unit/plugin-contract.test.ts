import { describe, expect, it } from 'vitest';

import validManifestFixture from '../fixtures/plugin-manifests/palette-tools.serpent-plugin.json';
import previewThumbnailManifestFixture from '../fixtures/plugins/preview-thumbnail-probe/serpent-plugin.json';

import {
  PLUGIN_API_VERSION,
  PLUGIN_MANIFEST_VERSION,
  describePluginApi,
  generatePluginSdkTypeDeclaration,
} from '../../src/plugins/plugin-sdk';
import {
  formatPluginManifestValidationIssues,
  getPluginSettingDefault,
  pluginManifestSchema,
  validatePluginManifestCompatibility,
} from '../../src/plugins/plugin-manifest';
import {
  createPluginPackageLock,
  defaultPluginPackageLimits,
  pluginLibraryLockSchema,
  pluginResolutionSchema,
  pluginTrustDecisionSchema,
  validatePluginPackageSnapshot,
  verifyPluginPackageLock,
} from '../../src/plugins/plugin-package';
import {
  createContributionRegistry,
  createPluginContributionId,
} from '../../src/plugins/plugin-contributions';

const validManifest = pluginManifestSchema.parse(validManifestFixture);

const digest = (letter: string) => letter.repeat(64);

function validSnapshot() {
  return {
    manifest: validManifest,
    manifestSha256: digest('a'),
    archiveByteLength: 1_024,
    files: [
      { path: 'serpent-plugin.json', byteLength: 1_000, sha256: digest('a'), kind: 'file' },
      { path: 'dist/main.js', byteLength: 10_000, sha256: digest('b'), kind: 'file' },
      { path: 'dist/ui/index.html', byteLength: 1_000, sha256: digest('c'), kind: 'file' },
      { path: 'README.md', byteLength: 500, sha256: digest('d'), kind: 'file' },
      { path: 'LICENSE', byteLength: 1_000, sha256: digest('e'), kind: 'file' },
    ],
  } as const;
}

describe('Plugin v1 manifest contract', () => {
  it('uses the declared minimum when a number setting has a negative range', () => {
    const setting = pluginManifestSchema.parse({
      ...validManifest,
      contributes: {
        ...validManifest.contributes,
        settings: [{
          id: 'temperature-offset',
          title: 'Temperature offset',
          type: 'number',
          minimum: -10,
          maximum: -5,
        }],
      },
    }).contributes.settings[0]!;

    expect(getPluginSettingDefault(setting)).toBe(-10);
  });

  it('exports a JSON schema and accepts the documented restricted-plugin manifest', () => {
    const parsed = pluginManifestSchema.parse(validManifest);

    expect(parsed.id).toBe('com.example.palette-tools');
    expect(parsed.runtime.mode).toBe('restricted');
    expect(pluginManifestSchema.toJSONSchema()).toMatchObject({ type: 'object' });
  });

  it('reports precise JSON paths for invalid static setting schemas', () => {
    const invalid = pluginManifestSchema.safeParse({
      ...validManifestFixture,
      contributes: {
        ...validManifestFixture.contributes,
        settings: [{
          id: 'batch-size',
          title: 'Batch size',
          type: 'number',
          default: 20,
          minimum: 1,
          maximum: 10,
        }],
      },
    });
    expect(invalid.success).toBe(false);
    if (invalid.success) throw new Error('Expected invalid setting schema');
    expect(formatPluginManifestValidationIssues(invalid.error)).toContain(
      '$.contributes.settings[0].default: Setting default must be less than or equal to maximum.',
    );
    const packageResult = validatePluginPackageSnapshot({
      ...validSnapshot(),
      manifest: {
        ...validManifestFixture,
        contributes: {
          ...validManifestFixture.contributes,
          settings: [{
            id: 'batch-size',
            title: 'Batch size',
            type: 'number',
            default: 20,
            minimum: 1,
            maximum: 10,
          }],
        },
      },
    });
    expect(packageResult).toMatchObject({
      ok: false,
      code: 'PLUGIN_PACKAGE_INVALID_MANIFEST',
      message: expect.stringContaining('$.contributes.settings[0].default'),
    });
  });

  it.each([
    {
      label: 'boolean default type',
      setting: { id: 'enabled', title: 'Enabled', type: 'boolean', default: 'yes' },
      path: '$.contributes.settings[0].default',
    },
    {
      label: 'number default type',
      setting: { id: 'batch-size', title: 'Batch size', type: 'number', default: 'many' },
      path: '$.contributes.settings[0].default',
    },
    {
      label: 'number default range',
      setting: { id: 'batch-size', title: 'Batch size', type: 'number', default: 20, minimum: 1, maximum: 10 },
      path: '$.contributes.settings[0].default',
    },
    {
      label: 'select default option',
      setting: {
        id: 'quality',
        title: 'Quality',
        type: 'select',
        default: 'ultra',
        options: [{ value: 'fast', label: 'Fast' }],
      },
      path: '$.contributes.settings[0].default',
    },
    {
      label: 'select option value',
      setting: {
        id: 'quality',
        title: 'Quality',
        type: 'select',
        options: [{ value: '', label: 'Empty' }],
      },
      path: '$.contributes.settings[0].options[0].value',
    },
  ] as const)('reports a JSON path for a bad static setting %s', ({ setting, path: expectedPath }) => {
    const invalid = pluginManifestSchema.safeParse({
      ...validManifestFixture,
      contributes: {
        ...validManifestFixture.contributes,
        settings: [setting],
      },
    });

    expect(invalid.success).toBe(false);
    if (invalid.success) throw new Error('Expected invalid setting schema');
    expect(formatPluginManifestValidationIssues(invalid.error)).toContain(expectedPath);
  });

  it('maps legacy standard/trusted runtime aliases to restricted/unrestricted', () => {
    expect(pluginManifestSchema.parse({
      ...validManifestFixture,
      runtime: { mode: 'standard', entry: 'dist/main.js' },
    }).runtime.mode).toBe('restricted');
    expect(pluginManifestSchema.parse({
      ...validManifestFixture,
      runtime: { mode: 'trusted', entry: 'dist/main.js' },
    }).runtime.mode).toBe('unrestricted');
  });

  it.each([
    ['bad identifier', { ...validManifest, id: 'Com.Example' }],
    ['non-semver version', { ...validManifest, version: 'v1.2' }],
    ['non-semver prerelease', { ...validManifest, version: '1.2.3-01' }],
    ['traversing runtime entry', {
      ...validManifest,
      runtime: { ...validManifest.runtime, entry: '../main.js' },
    }],
    ['absolute UI entry', {
      ...validManifest,
      ui: { entry: '/tmp/index.html' },
    }],
    ['standard plugin with native modules', {
      ...validManifest,
      runtime: {
        ...validManifest.runtime,
        nativeModules: [{ platform: 'darwin', arch: 'arm64', nodeAbi: 140 }],
      },
    }],
    ['menu command absent from the manifest', {
      ...validManifest,
      contributes: {
        ...validManifest.contributes,
        menus: { asset: [{ command: 'not-declared' }] },
      },
    }],
  ])('rejects a %s', (_label, manifest) => {
    expect(pluginManifestSchema.safeParse(manifest).success).toBe(false);
  });

  it('checks Serpent version, Plugin API and declared native platform before activation', () => {
    const manifest = pluginManifestSchema.parse({
      ...validManifest,
      runtime: {
        mode: 'unrestricted',
        entry: 'dist/main.js',
        nativeModules: [{ platform: 'darwin', arch: 'arm64', nodeAbi: 140 }],
      },
    });

    expect(validatePluginManifestCompatibility(manifest, {
      serpentVersion: '0.2.4',
      pluginApiVersion: 1,
      platform: 'darwin',
      arch: 'arm64',
      nodeAbi: 140,
    })).toEqual({ ok: true });
    expect(validatePluginManifestCompatibility(manifest, {
      serpentVersion: '0.2.4',
      pluginApiVersion: 1,
      platform: 'win32',
      arch: 'x64',
      nodeAbi: 140,
    })).toMatchObject({ ok: false, code: 'PLUGIN_PLATFORM_UNSUPPORTED' });
    expect(validatePluginManifestCompatibility(manifest, {
      serpentVersion: '1.0.0',
      pluginApiVersion: 1,
      platform: 'darwin',
      arch: 'arm64',
      nodeAbi: 140,
    })).toMatchObject({ ok: false, code: 'PLUGIN_SERPENT_VERSION_UNSUPPORTED' });
  });

  it('requires declared extensions for preview, thumbnail, and metadata providers', () => {
    const parsed = pluginManifestSchema.parse(previewThumbnailManifestFixture);
    expect(parsed.contributes.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'preview', extensions: ['.probe'] }),
      expect.objectContaining({ kind: 'thumbnail', extensions: ['.probe'] }),
      expect.objectContaining({ kind: 'metadata', extensions: ['.probe'] }),
    ]));
    expect(pluginManifestSchema.safeParse({
      ...parsed,
      contributes: {
        ...parsed.contributes,
        providers: [{ id: 'missing-extensions', kind: 'preview' }],
      },
    }).success).toBe(false);
    expect(pluginManifestSchema.safeParse({
      ...parsed,
      contributes: {
        ...parsed.contributes,
        providers: [{ id: 'missing-extensions', kind: 'metadata' }],
      },
    }).success).toBe(false);
  });
});

describe('Plugin package, installation, trust and resolution contracts', () => {
  it('creates a deterministic lock that covers the manifest and every packaged file', () => {
    const snapshot = validSnapshot();
    const lock = createPluginPackageLock(snapshot);

    expect(lock.pluginId).toBe(validManifest.id);
    expect(lock.version).toBe(validManifest.version);
    expect(lock.files.map((file) => file.path)).toEqual([
      'LICENSE',
      'README.md',
      'dist/main.js',
      'dist/ui/index.html',
      'serpent-plugin.json',
    ]);
    expect(verifyPluginPackageLock(snapshot, lock)).toEqual({ ok: true });
    expect(pluginLibraryLockSchema.parse({ lockVersion: 1, packages: [lock] })).toBeTruthy();
  });

  it('fails closed when a digest, package path, symlink or lock digest changes', () => {
    const snapshot = validSnapshot();
    const lock = createPluginPackageLock(snapshot);
    const modified = {
      ...snapshot,
      files: snapshot.files.map((file) => file.path === 'dist/main.js'
        ? { ...file, sha256: digest('f') }
        : file),
    };

    expect(verifyPluginPackageLock(modified, lock)).toMatchObject({
      ok: false,
      code: 'PLUGIN_PACKAGE_INTEGRITY_MISMATCH',
    });
    expect(validatePluginPackageSnapshot({
      ...snapshot,
      files: [...snapshot.files, {
        path: 'dist/linked.js',
        byteLength: 1,
        sha256: digest('f'),
        kind: 'symlink',
      }],
    })).toMatchObject({ ok: false, code: 'PLUGIN_PACKAGE_SYMLINK_FORBIDDEN' });
    expect(validatePluginPackageSnapshot({
      ...snapshot,
      files: [...snapshot.files, {
        path: '../escape.js',
        byteLength: 1,
        sha256: digest('f'),
        kind: 'file',
      }],
    })).toMatchObject({ ok: false, code: 'PLUGIN_PACKAGE_INVALID_PATH' });
  });

  it('applies archive, file-count, per-file and expanded-size limits before installation', () => {
    const snapshot = validSnapshot();

    expect(validatePluginPackageSnapshot({
      ...snapshot,
      archiveByteLength: defaultPluginPackageLimits.maxArchiveBytes + 1,
    })).toMatchObject({ ok: false, code: 'PLUGIN_PACKAGE_ARCHIVE_TOO_LARGE' });
    expect(validatePluginPackageSnapshot({
      ...snapshot,
      files: Array.from({ length: defaultPluginPackageLimits.maxFileCount + 1 }, (_, index) => ({
        path: `dist/file-${index}.js`,
        byteLength: 1,
        sha256: digest('f'),
        kind: 'file' as const,
      })),
    })).toMatchObject({ ok: false, code: 'PLUGIN_PACKAGE_TOO_MANY_FILES' });
    expect(validatePluginPackageSnapshot({
      ...snapshot,
      files: snapshot.files.map((file) => file.path === 'dist/main.js'
        ? { ...file, byteLength: defaultPluginPackageLimits.maxSingleFileBytes + 1 }
        : file),
    })).toMatchObject({ ok: false, code: 'PLUGIN_PACKAGE_FILE_TOO_LARGE' });
    expect(validatePluginPackageSnapshot({
      ...snapshot,
      files: snapshot.files.map((file) => file.path === 'dist/main.js'
        ? { ...file, byteLength: defaultPluginPackageLimits.maxExtractedBytes }
        : file),
    }, {
      ...defaultPluginPackageLimits,
      maxSingleFileBytes: defaultPluginPackageLimits.maxExtractedBytes + 1,
    })).toMatchObject({ ok: false, code: 'PLUGIN_PACKAGE_EXPANDED_TOO_LARGE' });
  });

  it('keeps trust and version choice device-local and explicit', () => {
    expect(pluginTrustDecisionSchema.parse({
      deviceId: 'device-a',
      pluginId: validManifest.id,
      packageHash: digest('a'),
      sourceFingerprint: 'github:example/serpent-palette-tools@v1.2.0',
      runtimeMode: 'restricted',
      permissions: validManifest.permissions,
      decision: 'trusted',
      decidedAt: '2026-07-29T00:00:00.000Z',
    })).toMatchObject({ decision: 'trusted' });
    expect(pluginResolutionSchema.parse({
      deviceId: 'device-a',
      libraryId: 'library-a',
      pluginId: validManifest.id,
      selection: 'use-library',
      packageHash: digest('a'),
    })).toMatchObject({ selection: 'use-library' });
    expect(pluginResolutionSchema.safeParse({
      deviceId: 'device-a',
      libraryId: 'library-a',
      pluginId: validManifest.id,
      selection: 'use-library',
    }).success).toBe(false);
  });
});

describe('Plugin contribution registry and generated SDK', () => {
  it('namespaces stable contribution IDs and revokes all active contributions on deactivation', () => {
    expect(createPluginContributionId(validManifest.id, 'extract-palette', 'library-a'))
      .toBe('com.example.palette-tools.library-a.extract-palette');

    const registry = createContributionRegistry();
    registry.register({
      pluginInstanceId: 'instance-a',
      pluginId: validManifest.id,
      libraryId: 'library-a',
      localId: 'extract-palette',
      kind: 'command',
      target: 'commands',
      title: 'Extract palette',
    });
    registry.register({
      pluginInstanceId: 'instance-a',
      pluginId: validManifest.id,
      libraryId: 'library-a',
      localId: 'palette-board',
      kind: 'view',
      target: 'workspace.views',
      title: 'Palette board',
    });

    expect(registry.list()).toHaveLength(2);
    expect(() => registry.register({
      pluginInstanceId: 'instance-b',
      pluginId: validManifest.id,
      libraryId: 'library-a',
      localId: 'extract-palette',
      kind: 'command',
      target: 'commands',
      title: 'Duplicate',
    })).toThrow(/already registered/u);
    expect(() => registry.register({
      pluginInstanceId: 'instance-b',
      pluginId: validManifest.id,
      libraryId: 'library-b',
      localId: 'extract-palette',
      kind: 'command',
      target: 'commands',
      title: 'Same command other library',
    })).not.toThrow();
    expect(registry.revokePluginInstance('instance-a')).toBe(2);
    expect(registry.list()).toHaveLength(1);
    expect(registry.revokePluginInstance('instance-b')).toBe(1);
    expect(registry.list()).toEqual([]);
  });

  it('registers descriptor Contributions from a verified manifest', async () => {
    const { registerManifestContributions } = await import('../../src/plugins/plugin-contributions');
    const registry = createContributionRegistry();
    const count = registerManifestContributions(registry, {
      pluginInstanceId: 'instance-manifest',
      libraryId: 'library-a',
      pluginId: validManifest.id,
      contributes: validManifest.contributes,
    });
    expect(count).toBeGreaterThan(0);
    expect(registry.list().some((entry) => entry.id.endsWith('.extract-palette'))).toBe(true);
    expect(registry.revokePluginInstance('instance-manifest')).toBe(count);
  });

  it('generates a standalone Plugin API v1 declaration and transport-safe description', () => {
    const declaration = generatePluginSdkTypeDeclaration('@serpent/plugin-api');
    const description = describePluginApi();

    expect(PLUGIN_MANIFEST_VERSION).toBe(1);
    expect(PLUGIN_API_VERSION).toBe(1);
    expect(description.apiVersion).toBe(1);
    expect(description.manifestSchema).toMatchObject({ type: 'object' });
    expect(declaration).toContain('interface SerpentPluginApi');
    expect(declaration).toContain("'asset.read'");
    expect(declaration).toContain('registerContribution');
    expect(declaration).toContain('hooks');
    expect(declaration).toContain('onWill');
    expect(declaration).toContain('forLibrary');
    expect(declaration).toContain('SerpentPluginScopedApi');
    expect(declaration).toContain("Pick<SerpentPluginApi['jobs'], 'enqueue' | 'reportProgress' | 'cancel' | 'pause' | 'resume' | 'retry'>");
    expect(declaration).toContain('reportProgress');
    expect(declaration).not.toContain('zod');
    expect(declaration).not.toContain('node:');
  });
});
