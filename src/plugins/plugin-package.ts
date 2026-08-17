import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  PLUGIN_MANIFEST_FILE_NAME,
  pluginIdSchema,
  pluginManifestSchema,
  pluginPackagePathSchema,
  pluginPermissionSchema,
  pluginRuntimeModeSchema,
  pluginSha256Schema,
  semverSchema,
  formatPluginManifestValidationIssues,
  type PluginManifest,
} from './plugin-manifest';

export const PLUGIN_LIBRARY_DIRECTORY = '.serpent/plugins';
export const PLUGIN_LIBRARY_LOCK_FILE = '.serpent/plugin-lock.json';
export const PLUGIN_LIBRARY_SETTINGS_DIRECTORY = '.serpent/plugin-settings';
export const PLUGIN_LIBRARY_DATA_DIRECTORY = '.serpent/plugin-data';
export const PLUGIN_LOCK_VERSION = 1 as const;

const nonBlankIdSchema = z.string().min(1).max(255).refine((value) => value.trim().length > 0, {
  message: 'Value must not be blank.',
});

export const pluginInstallationScopeSchema = z.enum(['user', 'library']);
export type PluginInstallationScope = z.infer<typeof pluginInstallationScopeSchema>;

export const pluginPackageSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('local-directory'),
    fingerprint: z.string().min(1).max(1_024),
  }),
  z.strictObject({
    kind: z.literal('local-package'),
    fingerprint: z.string().min(1).max(1_024),
  }),
  z.strictObject({
    kind: z.literal('github'),
    repository: z.url(),
    ref: z.string().min(1).max(255),
    commitSha: z.string().regex(/^[a-f0-9]{40,64}$/u),
    fingerprint: z.string().min(1).max(1_024),
  }),
]);
export type PluginPackageSource = z.infer<typeof pluginPackageSourceSchema>;

export const pluginPackageFileSchema = z.strictObject({
  path: pluginPackagePathSchema,
  byteLength: z.number().int().nonnegative(),
  sha256: pluginSha256Schema,
});
export type PluginPackageFile = z.infer<typeof pluginPackageFileSchema>;

export const pluginPackageLockSchema = z.strictObject({
  lockVersion: z.literal(PLUGIN_LOCK_VERSION),
  pluginId: pluginIdSchema,
  version: semverSchema,
  manifestSha256: pluginSha256Schema,
  packageHash: pluginSha256Schema,
  /**
   * Displayable, immutable provenance for this exact package.  The lock keeps
   * the full GitHub tuple (rather than only its fingerprint) so users can make
   * a meaningful trust/upgrade decision without exposing a local filesystem
   * path to the Renderer.
   */
  source: pluginPackageSourceSchema,
  sourceFingerprint: z.string().min(1).max(1_024),
  files: z.array(pluginPackageFileSchema).min(1).max(10_000),
});
export type PluginPackageLock = z.infer<typeof pluginPackageLockSchema>;

export const pluginLibraryLockSchema = z.strictObject({
  lockVersion: z.literal(PLUGIN_LOCK_VERSION),
  packages: z.array(pluginPackageLockSchema).max(10_000),
});
export type PluginLibraryLock = z.infer<typeof pluginLibraryLockSchema>;

export const pluginInstallationSchema = z.strictObject({
  scope: pluginInstallationScopeSchema,
  package: pluginPackageLockSchema,
  source: pluginPackageSourceSchema,
  installedAt: z.string().datetime(),
});
export type PluginInstallation = z.infer<typeof pluginInstallationSchema>;

export const pluginTrustDecisionSchema = z.strictObject({
  deviceId: nonBlankIdSchema,
  pluginId: pluginIdSchema,
  packageHash: pluginSha256Schema,
  sourceFingerprint: z.string().min(1).max(1_024),
  runtimeMode: pluginRuntimeModeSchema,
  permissions: z.array(pluginPermissionSchema).max(64),
  decision: z.enum(['trusted', 'denied']),
  decidedAt: z.string().datetime(),
});
export type PluginTrustDecision = z.infer<typeof pluginTrustDecisionSchema>;

/**
 * Per-device crash state for one resolved package in one library. It contains
 * only a stable error code, never an error stack, filesystem path or secret.
 */
export const pluginQuarantineRecordSchema = z.strictObject({
  deviceId: nonBlankIdSchema,
  libraryId: nonBlankIdSchema,
  pluginId: pluginIdSchema,
  packageHash: pluginSha256Schema,
  failureCount: z.number().int().min(1).max(10_000),
  firstFailureAt: z.string().datetime(),
  lastFailureAt: z.string().datetime(),
  lastFailureCode: z.string().min(1).max(128).regex(/^[A-Z0-9_:-]+$/u),
  quarantinedAt: z.string().datetime().optional(),
});
export type PluginQuarantineRecord = z.infer<typeof pluginQuarantineRecordSchema>;

export const pluginResolutionSchema = z.strictObject({
  deviceId: nonBlankIdSchema,
  libraryId: nonBlankIdSchema,
  pluginId: pluginIdSchema,
  selection: z.enum(['use-global', 'use-library', 'disabled']),
  packageHash: pluginSha256Schema.optional(),
  /** Follow compatible upgrades unless the user explicitly rolled back. */
  updatePolicy: z.enum(['follow-latest', 'pinned']).default('follow-latest'),
}).superRefine((value, context) => {
  const requiresPackage = value.selection === 'use-global' || value.selection === 'use-library';
  if (requiresPackage && value.packageHash === undefined) {
    context.addIssue({ code: 'custom', path: ['packageHash'], message: 'An enabled plugin resolution requires an exact package hash.' });
  }
  if (!requiresPackage && value.packageHash !== undefined) {
    context.addIssue({ code: 'custom', path: ['packageHash'], message: 'A disabled plugin resolution must not select a package.' });
  }
  if (!requiresPackage && value.updatePolicy !== 'follow-latest') {
    context.addIssue({ code: 'custom', path: ['updatePolicy'], message: 'A disabled resolution cannot pin a package version.' });
  }
});
export type PluginResolution = z.infer<typeof pluginResolutionSchema>;

export interface PluginPackageLimits {
  maxArchiveBytes: number;
  maxFileCount: number;
  maxSingleFileBytes: number;
  maxExtractedBytes: number;
}

export const defaultPluginPackageLimits: Readonly<PluginPackageLimits> = Object.freeze({
  maxArchiveBytes: 256 * 1024 * 1024,
  maxFileCount: 10_000,
  maxSingleFileBytes: 64 * 1024 * 1024,
  maxExtractedBytes: 512 * 1024 * 1024,
});

const packageSnapshotSchema = z.strictObject({
  manifest: z.unknown(),
  manifestSha256: pluginSha256Schema,
  source: pluginPackageSourceSchema.optional(),
  sourceFingerprint: z.string().min(1).max(1_024).optional(),
  archiveByteLength: z.number().int().nonnegative(),
  files: z.array(z.strictObject({
    path: z.string(),
    byteLength: z.number().int().nonnegative(),
    sha256: pluginSha256Schema,
    kind: z.enum(['file', 'symlink']),
  })).min(1),
});
type PluginPackageSnapshot = z.infer<typeof packageSnapshotSchema>;

export type PluginPackageValidationFailureCode =
  | 'PLUGIN_PACKAGE_INVALID_SNAPSHOT'
  | 'PLUGIN_PACKAGE_INVALID_MANIFEST'
  | 'PLUGIN_PACKAGE_ARCHIVE_TOO_LARGE'
  | 'PLUGIN_PACKAGE_TOO_MANY_FILES'
  | 'PLUGIN_PACKAGE_FILE_TOO_LARGE'
  | 'PLUGIN_PACKAGE_EXPANDED_TOO_LARGE'
  | 'PLUGIN_PACKAGE_SYMLINK_FORBIDDEN'
  | 'PLUGIN_PACKAGE_INVALID_PATH'
  | 'PLUGIN_PACKAGE_DUPLICATE_PATH'
  | 'PLUGIN_PACKAGE_REQUIRED_FILE_MISSING'
  | 'PLUGIN_PACKAGE_INTEGRITY_MISMATCH';

export type PluginPackageValidationResult =
  | { ok: true; manifest: PluginManifest; files: PluginPackageFile[]; snapshot: PluginPackageSnapshot }
  | { ok: false; code: PluginPackageValidationFailureCode; message: string };

function failure(code: PluginPackageValidationFailureCode, message: string): PluginPackageValidationResult {
  return { ok: false, code, message };
}

function packageHash(input: { manifestSha256: string; files: readonly PluginPackageFile[] }): string {
  const canonical = JSON.stringify({
    manifestSha256: input.manifestSha256,
    files: [...input.files]
      .sort(comparePackagePath)
      .map((file) => ({ path: file.path, byteLength: file.byteLength, sha256: file.sha256 })),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/** Package locks use bytewise POSIX path order, never locale-sensitive order. */
function comparePackagePath(left: PluginPackageFile, right: PluginPackageFile): number {
  if (left.path === right.path) return 0;
  return left.path < right.path ? -1 : 1;
}

function requiredPackagePaths(manifest: PluginManifest): string[] {
  return [
    PLUGIN_MANIFEST_FILE_NAME,
    'README.md',
    'LICENSE',
    manifest.runtime.entry,
    ...(manifest.ui === undefined ? [] : [manifest.ui.entry]),
  ];
}

export function validatePluginPackageSnapshot(
  value: unknown,
  limits: PluginPackageLimits = defaultPluginPackageLimits,
): PluginPackageValidationResult {
  const parsedSnapshot = packageSnapshotSchema.safeParse(value);
  if (!parsedSnapshot.success) return failure('PLUGIN_PACKAGE_INVALID_SNAPSHOT', 'The plugin package snapshot is invalid.');
  const snapshot = parsedSnapshot.data;
  if (snapshot.archiveByteLength > limits.maxArchiveBytes) {
    return failure('PLUGIN_PACKAGE_ARCHIVE_TOO_LARGE', 'The plugin archive exceeds the maximum allowed size.');
  }
  if (snapshot.files.length > limits.maxFileCount) {
    return failure('PLUGIN_PACKAGE_TOO_MANY_FILES', 'The plugin package contains too many files.');
  }

  const files: PluginPackageFile[] = [];
  const seenPaths = new Set<string>();
  let extractedBytes = 0;
  for (const sourceFile of snapshot.files) {
    if (sourceFile.kind === 'symlink') {
      return failure('PLUGIN_PACKAGE_SYMLINK_FORBIDDEN', 'Plugin packages must not contain symbolic links.');
    }
    const parsedPath = pluginPackagePathSchema.safeParse(sourceFile.path);
    if (!parsedPath.success) {
      return failure('PLUGIN_PACKAGE_INVALID_PATH', 'Plugin packages must not contain absolute or traversing paths.');
    }
    if (seenPaths.has(parsedPath.data)) {
      return failure('PLUGIN_PACKAGE_DUPLICATE_PATH', 'Plugin packages must not contain duplicate paths.');
    }
    if (sourceFile.byteLength > limits.maxSingleFileBytes) {
      return failure('PLUGIN_PACKAGE_FILE_TOO_LARGE', 'A plugin package file exceeds the maximum allowed size.');
    }
    seenPaths.add(parsedPath.data);
    extractedBytes += sourceFile.byteLength;
    if (extractedBytes > limits.maxExtractedBytes) {
      return failure('PLUGIN_PACKAGE_EXPANDED_TOO_LARGE', 'The expanded plugin package exceeds the maximum allowed size.');
    }
    files.push({
      path: parsedPath.data,
      byteLength: sourceFile.byteLength,
      sha256: sourceFile.sha256,
    });
  }

  const parsedManifest = pluginManifestSchema.safeParse(snapshot.manifest);
  if (!parsedManifest.success) {
    return failure(
      'PLUGIN_PACKAGE_INVALID_MANIFEST',
      `The plugin manifest is invalid: ${formatPluginManifestValidationIssues(parsedManifest.error)}`,
    );
  }
  const manifestFile = files.find((file) => file.path === PLUGIN_MANIFEST_FILE_NAME);
  if (manifestFile === undefined || manifestFile.sha256 !== snapshot.manifestSha256) {
    return failure('PLUGIN_PACKAGE_INTEGRITY_MISMATCH', 'The manifest digest does not match the packaged manifest file.');
  }
  const filePaths = new Set(files.map((file) => file.path));
  const missingPath = requiredPackagePaths(parsedManifest.data).find((path) => !filePaths.has(path));
  if (missingPath !== undefined) {
    return failure('PLUGIN_PACKAGE_REQUIRED_FILE_MISSING', `The plugin package is missing ${missingPath}.`);
  }

  return { ok: true, manifest: parsedManifest.data, files, snapshot };
}

export function createPluginPackageLock(value: unknown): PluginPackageLock {
  const validation = validatePluginPackageSnapshot(value);
  if (!validation.ok) throw new TypeError(validation.message);
  const files = [...validation.files].sort(comparePackagePath);
  const source = validation.snapshot.source ?? {
    kind: 'local-directory' as const,
    fingerprint: validation.snapshot.sourceFingerprint
      ?? `unattributed:${validation.manifest.id}@${validation.manifest.version}`,
  };
  return {
    lockVersion: PLUGIN_LOCK_VERSION,
    pluginId: validation.manifest.id,
    version: validation.manifest.version,
    manifestSha256: validation.snapshot.manifestSha256,
    packageHash: packageHash({ manifestSha256: validation.snapshot.manifestSha256, files }),
    source,
    sourceFingerprint: source.fingerprint,
    files,
  };
}

export function verifyPluginPackageLock(snapshot: unknown, lock: unknown): { ok: true } | {
  ok: false;
  code: PluginPackageValidationFailureCode;
  message: string;
} {
  const validation = validatePluginPackageSnapshot(snapshot);
  if (!validation.ok) return validation;
  const parsedLock = pluginPackageLockSchema.safeParse(lock);
  if (!parsedLock.success) {
    return failure('PLUGIN_PACKAGE_INTEGRITY_MISMATCH', 'The plugin package lock is invalid.');
  }
  const expected = createPluginPackageLock(validation.snapshot);
  const actual = parsedLock.data;
  if (expected.pluginId !== actual.pluginId
    || expected.version !== actual.version
    || expected.manifestSha256 !== actual.manifestSha256
    || expected.packageHash !== actual.packageHash
    || JSON.stringify(expected.source) !== JSON.stringify(actual.source)
    || expected.sourceFingerprint !== actual.sourceFingerprint
    || JSON.stringify(expected.files) !== JSON.stringify(actual.files)) {
    return failure('PLUGIN_PACKAGE_INTEGRITY_MISMATCH', 'The package no longer matches its verified lock.');
  }
  return { ok: true };
}

export function getLibraryPluginPackageDirectory(pluginId: string): string {
  return `${PLUGIN_LIBRARY_DIRECTORY}/${pluginIdSchema.parse(pluginId)}`;
}

export function getUserPluginPackageDirectory(pluginId: string): string {
  return `plugins/${pluginIdSchema.parse(pluginId)}`;
}
