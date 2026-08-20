import { z } from 'zod';

export const APP_UPDATE_DISTRIBUTIONS = [
  'development',
  'installed',
  'portable',
] as const;
export type AppUpdateDistribution = (typeof APP_UPDATE_DISTRIBUTIONS)[number];

export const APP_UPDATE_ASSET_KINDS = ['installer', 'portable'] as const;
export type AppUpdateAssetKind = (typeof APP_UPDATE_ASSET_KINDS)[number];

export const APP_UPDATE_ERROR_CODES = [
  'unauthorized-sender',
  'service-unavailable',
  'network',
  'invalid-release',
  'asset-missing',
  'verification-failed',
  'download-failed',
  'open-failed',
  'busy',
  'not-available',
] as const;
export type AppUpdateErrorCode = (typeof APP_UPDATE_ERROR_CODES)[number];

const appUpdateDistributionSchema = z.enum(APP_UPDATE_DISTRIBUTIONS);
const appUpdateAssetKindSchema = z.enum(APP_UPDATE_ASSET_KINDS);
const appUpdateErrorCodeSchema = z.enum(APP_UPDATE_ERROR_CODES);

const appUpdateErrorSchema = z.object({
  ok: z.literal(false),
  status: z.literal('error'),
  code: appUpdateErrorCodeSchema,
});

const appUpdateUnsupportedSchema = z.object({
  ok: z.literal(true),
  status: z.literal('unsupported'),
  reason: z.enum(['development', 'platform', 'architecture']),
  currentVersion: z.string().min(1).max(64),
  distribution: appUpdateDistributionSchema,
});

const appUpdateUpToDateSchema = z.object({
  ok: z.literal(true),
  status: z.literal('up-to-date'),
  currentVersion: z.string().min(1).max(64),
  latestVersion: z.string().min(1).max(64),
  distribution: appUpdateDistributionSchema,
});

const appUpdateAvailableSchema = z.object({
  ok: z.literal(true),
  status: z.literal('available'),
  currentVersion: z.string().min(1).max(64),
  latestVersion: z.string().min(1).max(64),
  distribution: z.enum(['installed', 'portable']),
  assetKind: appUpdateAssetKindSchema,
  assetName: z.string().min(1).max(255),
  assetSize: z.number().int().nonnegative(),
  releaseNotes: z.string().max(12_000),
});

export const appUpdateCheckResultSchema = z.discriminatedUnion('status', [
  appUpdateErrorSchema,
  appUpdateUnsupportedSchema,
  appUpdateUpToDateSchema,
  appUpdateAvailableSchema,
]);

export type AppUpdateCheckResult = z.infer<typeof appUpdateCheckResultSchema>;

const appUpdateInstallSuccessSchema = z.object({
  ok: z.literal(true),
  status: z.literal('completed'),
  action: z.enum(['installer-opened', 'portable-downloaded']),
  version: z.string().min(1).max(64),
  distribution: z.enum(['installed', 'portable']),
});

export const appUpdateInstallResultSchema = z.discriminatedUnion('status', [
  appUpdateErrorSchema,
  appUpdateInstallSuccessSchema,
]);

export type AppUpdateInstallResult = z.infer<typeof appUpdateInstallResultSchema>;

export function parseAppUpdateCheckResult(input: unknown): AppUpdateCheckResult {
  const parsed = appUpdateCheckResultSchema.safeParse(input);
  return parsed.success
    ? parsed.data
    : { ok: false, status: 'error', code: 'service-unavailable' };
}

export function parseAppUpdateInstallResult(input: unknown): AppUpdateInstallResult {
  const parsed = appUpdateInstallResultSchema.safeParse(input);
  return parsed.success
    ? parsed.data
    : { ok: false, status: 'error', code: 'service-unavailable' };
}

export interface SerpentAppUpdateApi {
  checkForUpdates(): Promise<AppUpdateCheckResult>;
  downloadAndInstall(): Promise<AppUpdateInstallResult>;
}
