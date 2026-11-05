import { randomUUID } from "node:crypto";

import { DEFAULT_AI_API_FORMAT, DEFAULT_AI_MODELS, migrateLegacyProviderToApiFormat, type AiApiFormat } from "../shared/ai-endpoints";

export type AiConnectionProfile = {
  id: string;
  name: string;
  apiFormat: AiApiFormat;
  model: string;
  baseUrl: string;
};

export type AiProfileCatalog = {
  version: 1;
  activeProfileId: string | null;
  profiles: AiConnectionProfile[];
};

export type AiConnectionProfileSummary = AiConnectionProfile & {
  hasCredential: boolean;
};

export type AiConnectionSnapshot = Readonly<AiConnectionProfile & {
  apiKey: string;
}>;

export type AiConnectionProfileDraft = Omit<AiConnectionProfile, "id"> & {
  id?: string;
};

export class AiProfileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiProfileValidationError";
  }
}

export class AiProfileStorageError extends Error {
  override readonly cause: unknown;

  constructor(cause?: unknown) {
    super("AI profile storage could not be read or recovered.");
    this.name = "AiProfileStorageError";
    this.cause = cause;
  }
}

export type AiProfileMigrationIo = {
  markerExists(): boolean;
  readCatalog(): AiProfileCatalog | null;
  cleanupOrphanCredentials(catalog: AiProfileCatalog): void;
  readPreferences(): unknown | null;
  legacyProfile: AiConnectionProfile | null;
  readLegacyCredential(): string | null;
  writeCredential(profileId: string, credential: string): void;
  verifyCredential(profileId: string): void;
  defaultPreferences: unknown;
  normalizeLegacyPreferences(): unknown | null;
  writeCatalog(catalog: AiProfileCatalog): void;
  writePreferences(preferences: unknown): void;
  writeMarker(): void;
  cleanupLegacy(): void;
};

export function emptyAiProfileCatalog(): AiProfileCatalog {
  return { version: 1, activeProfileId: null, profiles: [] };
}

export function createAiProfileId(): string {
  return `ai_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
}

export function isAiProfileId(value: string): boolean {
  return /^ai_[a-f0-9]{24}$/u.test(value);
}

export function parseAiProfileCatalog(input: unknown): AiProfileCatalog {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("AI profile catalog must be an object.");
  }
  const raw = input as { version?: unknown; activeProfileId?: unknown; profiles?: unknown };
  if (raw.version !== 1 || !Array.isArray(raw.profiles) || raw.profiles.length > 100) {
    throw new Error("AI profile catalog has an unsupported or invalid structure.");
  }
  const profiles: AiConnectionProfile[] = [];
  const ids = new Set<string>();
  for (const value of raw.profiles) {
    if (!isProfile(value)) throw new Error("AI profile catalog contains an invalid profile.");
    if (ids.has(value.id)) throw new Error("AI profile catalog contains duplicate profile ids.");
    const name = value.name.trim();
    const model = value.model.trim();
    if (!name || name.length > 80 || !model || model.length > 255 || value.baseUrl.length > 2048) {
      throw new Error("AI profile catalog contains invalid profile fields.");
    }
    ids.add(value.id);
    profiles.push({
      id: value.id,
      name,
      apiFormat: value.apiFormat,
      model,
      baseUrl: value.baseUrl.trim(),
    });
  }
  const activeProfileId = raw.activeProfileId;
  if (activeProfileId !== null
    && (typeof activeProfileId !== "string" || !ids.has(activeProfileId))) {
    throw new Error("AI profile catalog selects a profile that does not exist.");
  }
  return { version: 1, activeProfileId: activeProfileId as string | null, profiles };
}

export function saveAiConnectionProfile(
  catalog: AiProfileCatalog,
  draft: AiConnectionProfileDraft,
): AiProfileCatalog {
  const id = draft.id ?? createAiProfileId();
  if (!isAiProfileId(id)) throw new AiProfileValidationError("Invalid AI profile id.");
  const existing = catalog.profiles.find((profile) => profile.id === id);
  if (!existing && catalog.profiles.length >= 100) {
    throw new AiProfileValidationError("AI profile limit reached.");
  }
  const name = draft.name.trim();
  const model = draft.model.trim();
  const baseUrl = draft.baseUrl.trim();
  if (!name || name.length > 80 || !model || model.length > 255 || baseUrl.length > 2048) {
    throw new AiProfileValidationError("Invalid AI profile fields.");
  }
  const profile: AiConnectionProfile = {
    id,
    name,
    apiFormat: draft.apiFormat,
    model,
    baseUrl,
  };
  return {
    version: 1,
    // A newly added profile becomes the one AI requests use. Editing an
    // existing profile leaves the current selection unchanged.
    activeProfileId: existing ? catalog.activeProfileId : id,
    profiles: existing
      ? catalog.profiles.map((item) => (item.id === id ? profile : item))
      : [...catalog.profiles, profile],
  };
}

export function activateAiProfile(
  catalog: AiProfileCatalog,
  id: string,
): AiProfileCatalog {
  if (!catalog.profiles.some((profile) => profile.id === id)) {
    throw new AiProfileValidationError("AI profile does not exist.");
  }
  return { ...catalog, activeProfileId: id };
}

export function deleteAiProfile(
  catalog: AiProfileCatalog,
  id: string,
): AiProfileCatalog {
  if (!catalog.profiles.some((profile) => profile.id === id)) {
    throw new AiProfileValidationError("AI profile does not exist.");
  }
  return {
    version: 1,
    activeProfileId: catalog.activeProfileId === id ? null : catalog.activeProfileId,
    profiles: catalog.profiles.filter((profile) => profile.id !== id),
  };
}

export function summarizeAiProfiles(
  catalog: AiProfileCatalog,
  hasCredential: (profileId: string) => boolean,
): AiConnectionProfileSummary[] {
  return catalog.profiles.map((profile) => ({
    ...profile,
    hasCredential: hasCredential(profile.id),
  }));
}

/** Capture the endpoint and secret once so an active-profile change affects only later work. */
export function captureAiConnectionSnapshot(
  profile: AiConnectionProfile,
  apiKey: string,
): AiConnectionSnapshot {
  return Object.freeze({ ...profile, apiKey });
}

/** A missing active profile may still use the legacy key during a failed migration. */
export function resolveAiCredential(
  activeProfileId: string | null,
  migrationCompleted: boolean,
  readProfileCredential: (profileId: string) => string,
  readLegacyCredential: () => string,
): string {
  if (activeProfileId !== null) return readProfileCredential(activeProfileId);
  if (migrationCompleted) throw new Error("AI API key not configured.");
  return readLegacyCredential();
}

/**
 * One-time migration transaction. The marker and destructive legacy cleanup
 * happen only after all new files and migrated credentials have been verified.
 */
export function migrateAiProfileStorage(io: AiProfileMigrationIo): AiProfileCatalog {
  if (io.markerExists()) {
    const catalog = io.readCatalog();
    if (!catalog) throw new Error("AI profile catalog is missing after migration.");
    io.cleanupOrphanCredentials(catalog);
    io.cleanupLegacy();
    return catalog;
  }

  let catalog = io.readCatalog();
  const catalogAlreadyExists = catalog !== null;
  catalog ??= emptyAiProfileCatalog();
  let migratedProfileId: string | null = null;
  if (!catalogAlreadyExists && io.legacyProfile) {
    const credential = io.readLegacyCredential();
    catalog = saveAiConnectionProfile(catalog, io.legacyProfile);
    if (credential) {
      io.writeCredential(io.legacyProfile.id, credential);
      migratedProfileId = io.legacyProfile.id;
    }
    catalog = activateAiProfile(catalog, io.legacyProfile.id);
  }

  if (!catalogAlreadyExists) io.writeCatalog(catalog);
  const storedPreferences = io.readPreferences();
  if (storedPreferences === null) {
    io.writePreferences(io.normalizeLegacyPreferences() ?? io.defaultPreferences);
  }
  const legacyProfile = io.legacyProfile;
  if (!migratedProfileId && legacyProfile
    && catalog.profiles.some((profile) => profile.id === legacyProfile.id)) {
    // A prior attempt may have persisted the catalog before credential
    // verification failed. Re-verify the source profile on every retry while
    // the legacy key still exists; do not mark migration complete or delete it
    // until the profile copy is readable.
    const legacyCredential = io.readLegacyCredential();
    if (legacyCredential) migratedProfileId = legacyProfile.id;
  }
  if (migratedProfileId) io.verifyCredential(migratedProfileId);
  io.cleanupOrphanCredentials(catalog);
  io.writeMarker();
  io.cleanupLegacy();
  return catalog;
}

export function legacyAiConnectionProfile(input: {
  apiFormat?: unknown;
  provider?: unknown;
  model?: unknown;
  baseUrl?: unknown;
}): AiConnectionProfile {
  const apiFormat =
    migrateLegacyProviderToApiFormat(input.apiFormat) ??
    migrateLegacyProviderToApiFormat(input.provider) ??
    DEFAULT_AI_API_FORMAT;
  const model = typeof input.model === "string" && input.model.trim()
    ? input.model.trim()
    : DEFAULT_AI_MODELS[apiFormat];
  return {
    id: "ai_000000000000000000000000",
    name: "默认配置",
    apiFormat,
    model,
    baseUrl: typeof input.baseUrl === "string" ? input.baseUrl.trim() : "",
  };
}

function isProfile(value: unknown): value is AiConnectionProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Partial<AiConnectionProfile>;
  return typeof profile.id === "string" && isAiProfileId(profile.id)
    && typeof profile.name === "string" && profile.name.trim().length > 0
    && typeof profile.apiFormat === "string"
    && ["dashscope_native", "openai_chat", "openai_responses", "anthropic", "gemini_native"].includes(profile.apiFormat)
    && typeof profile.model === "string" && profile.model.trim().length > 0
    && typeof profile.baseUrl === "string";
}
