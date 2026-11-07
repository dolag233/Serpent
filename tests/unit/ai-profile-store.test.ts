import { describe, expect, it, vi } from "vitest";

import {
  activateAiProfile,
  captureAiConnectionSnapshot,
  deleteAiProfile,
  emptyAiProfileCatalog,
  legacyAiConnectionProfile,
  migrateAiProfileStorage,
  parseAiProfileCatalog,
  resolveAiCredential,
  saveAiConnectionProfile,
  summarizeAiProfiles,
} from "../../src/main/ai-profile-store";

describe("AI connection profile catalog", () => {
  it("selects a newly created profile and keeps that selection when another profile is edited", () => {
    const first = saveAiConnectionProfile(emptyAiProfileCatalog(), {
      id: "ai_000000000000000000000001",
      name: "Fast model",
      apiFormat: "openai_chat",
      model: "small-model",
      baseUrl: "https://example.invalid/v1",
    });
    expect(first.activeProfileId).toBe("ai_000000000000000000000001");
    const second = saveAiConnectionProfile(first, {
      id: "ai_000000000000000000000002",
      name: "Strong model",
      apiFormat: "anthropic",
      model: "large-model",
      baseUrl: "",
    });

    expect(second.profiles.map(({ name }) => name)).toEqual(["Fast model", "Strong model"]);
    expect(second.activeProfileId).toBe("ai_000000000000000000000002");
    const renamed = saveAiConnectionProfile(second, {
      id: "ai_000000000000000000000001",
      name: "Fast model renamed",
      apiFormat: "openai_chat",
      model: "small-model-v2",
      baseUrl: "",
    });
    expect(renamed.activeProfileId).toBe("ai_000000000000000000000002");
    expect(renamed.profiles[0]).toMatchObject({ name: "Fast model renamed", model: "small-model-v2" });
  });

  it("clears active selection when that profile is deleted", () => {
    const catalog = activateAiProfile(saveAiConnectionProfile(emptyAiProfileCatalog(), {
      id: "ai_000000000000000000000003",
      name: "Default",
      apiFormat: "openai_chat",
      model: "model",
      baseUrl: "",
    }), "ai_000000000000000000000003");

    expect(deleteAiProfile(catalog, "ai_000000000000000000000003")).toEqual({
      version: 1,
      activeProfileId: null,
      profiles: [],
    });
  });

  it("selects a newly saved profile even when that profile has no credential yet", () => {
    const active = saveAiConnectionProfile(emptyAiProfileCatalog(), {
      id: "ai_000000000000000000000011",
      name: "Current",
      apiFormat: "openai_chat",
      model: "current-model",
      baseUrl: "",
    });
    expect(active.activeProfileId).toBe("ai_000000000000000000000011");

    const withIncompleteDraft = saveAiConnectionProfile(active, {
      id: "ai_000000000000000000000012",
      name: "Needs a key",
      apiFormat: "openai_chat",
      model: "draft-model",
      baseUrl: "",
    });

    expect(withIncompleteDraft.activeProfileId).toBe("ai_000000000000000000000012");
    expect(withIncompleteDraft.profiles).toHaveLength(2);
    expect(withIncompleteDraft.profiles[1]).toMatchObject({
      id: "ai_000000000000000000000012",
      name: "Needs a key",
      model: "draft-model",
    });
  });

  it("keeps an in-flight connection snapshot stable after selecting another profile", () => {
    const oldProfile = {
      id: "ai_000000000000000000000007",
      name: "Old profile",
      apiFormat: "openai_chat" as const,
      model: "old-model",
      baseUrl: "https://old.example.invalid",
    };
    const nextProfile = {
      id: "ai_000000000000000000000008",
      name: "New profile",
      apiFormat: "anthropic" as const,
      model: "new-model",
      baseUrl: "https://new.example.invalid",
    };
    const snapshot = captureAiConnectionSnapshot(oldProfile, "old-secret");
    const nextCatalog = activateAiProfile(
      saveAiConnectionProfile(
        activateAiProfile(saveAiConnectionProfile(emptyAiProfileCatalog(), oldProfile), oldProfile.id),
        nextProfile,
      ),
      nextProfile.id,
    );

    expect(nextCatalog.activeProfileId).toBe(nextProfile.id);
    expect(snapshot).toMatchObject({
      id: oldProfile.id,
      model: "old-model",
      apiKey: "old-secret",
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(captureAiConnectionSnapshot(nextProfile, "new-secret").model).toBe("new-model");
  });

  it("uses the old encrypted credential only while no profile is active", () => {
    const readProfileCredential = vi.fn((id: string) => `profile:${id}`);
    const readLegacyCredential = vi.fn(() => "legacy-secret");

    expect(resolveAiCredential(null, false, readProfileCredential, readLegacyCredential)).toBe("legacy-secret");
    expect(readLegacyCredential).toHaveBeenCalledOnce();
    expect(readProfileCredential).not.toHaveBeenCalled();

    expect(resolveAiCredential("ai_000000000000000000000009", true, readProfileCredential, readLegacyCredential))
      .toBe("profile:ai_000000000000000000000009");
    expect(readLegacyCredential).toHaveBeenCalledOnce();

    expect(() => resolveAiCredential(null, true, readProfileCredential, readLegacyCredential))
      .toThrow("AI API key not configured.");
    expect(readLegacyCredential).toHaveBeenCalledOnce();
  });

  it("rejects malformed catalogs instead of silently dropping profiles", () => {
    const persisted = parseAiProfileCatalog({
      version: 1,
      activeProfileId: "ai_000000000000000000000004",
      profiles: [
        { id: "ai_000000000000000000000004", name: "A", apiFormat: "openai_chat", model: "m", baseUrl: "" },
      ],
    });
    const summary = summarizeAiProfiles(persisted, () => true);
    expect(summary[0]).toEqual({
      id: "ai_000000000000000000000004",
      name: "A",
      apiFormat: "openai_chat",
      model: "m",
      baseUrl: "",
      hasCredential: true,
    });
    expect(() => parseAiProfileCatalog({
      version: 1,
      activeProfileId: "ai_000000000000000000000004",
      profiles: [
        { id: "ai_000000000000000000000004", name: "A", apiFormat: "openai_chat", model: "m", baseUrl: "" },
        { id: "ai_000000000000000000000004", name: "Duplicate", apiFormat: "openai_chat", model: "m", baseUrl: "" },
      ],
    })).toThrow("duplicate profile ids");
    expect(() => parseAiProfileCatalog({
      version: 1,
      activeProfileId: null,
      profiles: [{ id: "invalid", name: "Invalid", apiFormat: "openai_chat", model: "m", baseUrl: "" }],
    })).toThrow("invalid profile");
  });

  it("migrates legacy endpoint fields into a stable profile without carrying behavior settings", () => {
    expect(legacyAiConnectionProfile({
      apiFormat: "openai_responses",
      model: "reasoner",
      baseUrl: "https://proxy.example.invalid",
    })).toEqual({
      id: "ai_000000000000000000000000",
      name: "默认配置",
      apiFormat: "openai_responses",
      model: "reasoner",
      baseUrl: "https://proxy.example.invalid",
    });
  });

  it("keeps legacy files when credential decryption fails and marks only complete migrations", () => {
    const cleanupLegacy = vi.fn();
    const writeCatalog = vi.fn();
    expect(() => migrateAiProfileStorage({
      markerExists: () => false,
      readCatalog: () => null,
      cleanupOrphanCredentials: vi.fn(),
      readPreferences: () => null,
      legacyProfile: legacyAiConnectionProfile({ model: "legacy-model" }),
      readLegacyCredential: () => { throw new Error("cannot decrypt"); },
      writeCredential: vi.fn(),
      verifyCredential: vi.fn(),
      defaultPreferences: {},
      normalizeLegacyPreferences: () => ({ preserved: true }),
      writeCatalog,
      writePreferences: vi.fn(),
      writeMarker: vi.fn(),
      cleanupLegacy,
    })).toThrow("cannot decrypt");
    expect(writeCatalog).not.toHaveBeenCalled();
    expect(cleanupLegacy).not.toHaveBeenCalled();
  });

  it("re-verifies the migrated source credential when retrying after the catalog was written", () => {
    let storedCatalog: ReturnType<typeof emptyAiProfileCatalog> | null = null;
    let verificationAttempts = 0;
    const writeMarker = vi.fn();
    const cleanupLegacy = vi.fn();
    const io = {
      markerExists: () => false,
      readCatalog: () => storedCatalog,
      cleanupOrphanCredentials: vi.fn(),
      readPreferences: () => ({}),
      legacyProfile: legacyAiConnectionProfile({ model: "legacy-model" }),
      readLegacyCredential: () => "legacy-secret",
      writeCredential: vi.fn(),
      verifyCredential: () => {
        verificationAttempts += 1;
        if (verificationAttempts === 1) throw new Error("profile copy cannot be decrypted yet");
      },
      defaultPreferences: {},
      normalizeLegacyPreferences: () => null,
      writeCatalog: (catalog: ReturnType<typeof emptyAiProfileCatalog>) => { storedCatalog = catalog; },
      writePreferences: vi.fn(),
      writeMarker,
      cleanupLegacy,
    };

    expect(() => migrateAiProfileStorage(io)).toThrow("cannot be decrypted yet");
    expect(storedCatalog).toMatchObject({ activeProfileId: "ai_000000000000000000000000" });
    expect(writeMarker).not.toHaveBeenCalled();
    expect(cleanupLegacy).not.toHaveBeenCalled();

    migrateAiProfileStorage(io);
    expect(verificationAttempts).toBe(2);
    expect(writeMarker).toHaveBeenCalledOnce();
    expect(cleanupLegacy).toHaveBeenCalledOnce();
  });

  it("writes the marker and cleans legacy files only after credential verification", () => {
    const events: string[] = [];
    const catalog = migrateAiProfileStorage({
      markerExists: () => false,
      readCatalog: () => null,
      readPreferences: () => null,
      legacyProfile: legacyAiConnectionProfile({ model: "legacy-model" }),
      readLegacyCredential: () => "legacy-secret",
      writeCredential: (id, credential) => {
        expect(id).toBe("ai_000000000000000000000000");
        expect(credential).toBe("legacy-secret");
        events.push("credential");
      },
      verifyCredential: () => { events.push("verify"); },
      defaultPreferences: {},
      normalizeLegacyPreferences: () => ({ forceExistingTags: true }),
      writeCatalog: (value) => {
        expect(value.activeProfileId).toBe("ai_000000000000000000000000");
        events.push("catalog");
      },
      writePreferences: (value) => {
        expect(value).toEqual({ forceExistingTags: true });
        events.push("preferences");
      },
      cleanupOrphanCredentials: (value) => {
        expect(value.activeProfileId).toBe("ai_000000000000000000000000");
        events.push("orphan-cleanup");
      },
      writeMarker: () => { events.push("marker"); },
      cleanupLegacy: () => { events.push("cleanup"); },
    });
    expect(catalog.activeProfileId).toBe("ai_000000000000000000000000");
    expect(events).toEqual([
      "credential", "catalog", "preferences", "verify", "orphan-cleanup", "marker", "cleanup",
    ]);
  });

  it("preserves legacy files when an existing profile catalog is malformed", () => {
    const writeCatalog = vi.fn();
    const writeMarker = vi.fn();
    const cleanupLegacy = vi.fn();
    const cleanupOrphanCredentials = vi.fn();
    const readLegacyCredential = vi.fn(() => "legacy-secret");

    expect(() => migrateAiProfileStorage({
      markerExists: () => false,
      readCatalog: () => parseAiProfileCatalog({ version: 1, activeProfileId: null, profiles: "corrupt" }),
      cleanupOrphanCredentials,
      readPreferences: () => null,
      legacyProfile: legacyAiConnectionProfile({ model: "legacy-model" }),
      readLegacyCredential,
      writeCredential: vi.fn(),
      verifyCredential: vi.fn(),
      defaultPreferences: {},
      normalizeLegacyPreferences: () => null,
      writeCatalog,
      writePreferences: vi.fn(),
      writeMarker,
      cleanupLegacy,
    })).toThrow("invalid structure");

    expect(writeCatalog).not.toHaveBeenCalled();
    expect(writeMarker).not.toHaveBeenCalled();
    expect(cleanupOrphanCredentials).not.toHaveBeenCalled();
    expect(cleanupLegacy).not.toHaveBeenCalled();
    expect(readLegacyCredential).not.toHaveBeenCalled();
  });

  it("cleans orphan credentials only after a valid catalog and retries cleanup on later loads", () => {
    const catalog = parseAiProfileCatalog({
      version: 1,
      activeProfileId: "ai_000000000000000000000010",
      profiles: [
        { id: "ai_000000000000000000000010", name: "Active", apiFormat: "openai_chat", model: "m", baseUrl: "" },
      ],
    });
    const cleanupOrphanCredentials = vi.fn(() => { throw new Error("temporarily locked"); });
    const io = {
      markerExists: () => true,
      readCatalog: () => catalog,
      cleanupOrphanCredentials,
      readPreferences: () => ({}),
      legacyProfile: null,
      readLegacyCredential: () => null,
      writeCredential: vi.fn(),
      verifyCredential: vi.fn(),
      defaultPreferences: {},
      normalizeLegacyPreferences: () => null,
      writeCatalog: vi.fn(),
      writePreferences: vi.fn(),
      writeMarker: vi.fn(),
      cleanupLegacy: vi.fn(),
    };

    expect(() => migrateAiProfileStorage(io)).toThrow("temporarily locked");
    expect(cleanupOrphanCredentials).toHaveBeenCalledOnce();
    expect(cleanupOrphanCredentials).toHaveBeenLastCalledWith(catalog);
    expect(() => migrateAiProfileStorage(io)).toThrow("temporarily locked");
    expect(cleanupOrphanCredentials).toHaveBeenCalledTimes(2);
  });
});
