import { describe, expect, it } from "vitest";

import { ArtifactPathCache } from "../../src/main/artifact-path-cache";

describe("ArtifactPathCache", () => {
  it("promotes hits to MRU and evicts the oldest entry at the bound", () => {
    const cache = new ArtifactPathCache(2);
    cache.set("library-1", "artifact-a", "preview", "/a");
    cache.set("library-1", "artifact-b", "preview", "/b");
    expect(cache.get("library-1", "artifact-a", "preview")).toBe("/a");

    cache.set("library-1", "artifact-c", "preview", "/c");
    expect(cache.get("library-1", "artifact-a", "preview")).toBe("/a");
    expect(cache.get("library-1", "artifact-b", "preview")).toBeUndefined();
    expect(cache.get("library-1", "artifact-c", "preview")).toBe("/c");
  });

  it("rejects old-generation writes after a library handle is replaced", () => {
    const cache = new ArtifactPathCache();
    const oldGeneration = cache.generation("library-1");
    cache.set("library-1", "artifact-a", "preview", "/old", oldGeneration);

    const nextGeneration = cache.clearLibrary("library-1");
    expect(nextGeneration).toBe(oldGeneration + 1);
    expect(cache.set("library-1", "artifact-b", "preview", "/stale", oldGeneration)).toBe(false);
    expect(cache.get("library-1", "artifact-a", "preview", oldGeneration)).toBeUndefined();
    expect(cache.get("library-1", "artifact-b", "preview", nextGeneration)).toBeUndefined();
  });

  it("invalidates one artifact without flushing unrelated usage or libraries", () => {
    const cache = new ArtifactPathCache();
    cache.set("library-1", "artifact-a", "preview", "/preview");
    cache.set("library-1", "artifact-a", "proxy", "/proxy");
    cache.set("library-1", "artifact-b", "preview", "/other");
    cache.set("library-2", "artifact-a", "preview", "/other-library");

    cache.invalidateArtifact("library-1", "artifact-a", "preview");
    expect(cache.get("library-1", "artifact-a", "preview")).toBeUndefined();
    expect(cache.get("library-1", "artifact-a", "proxy")).toBe("/proxy");
    expect(cache.get("library-1", "artifact-b", "preview")).toBe("/other");
    expect(cache.get("library-2", "artifact-a", "preview")).toBe("/other-library");
  });

  it("can invalidate every use of one artifact without advancing generation", () => {
    const cache = new ArtifactPathCache();
    cache.set("library-1", "artifact-a", "preview", "/preview");
    cache.set("library-1", "artifact-a", "proxy", "/proxy");
    const generation = cache.generation("library-1");

    cache.invalidateArtifact("library-1", "artifact-a");

    expect(cache.generation("library-1")).toBe(generation);
    expect(cache.get("library-1", "artifact-a", "preview")).toBeUndefined();
    expect(cache.get("library-1", "artifact-a", "proxy")).toBeUndefined();
  });
});
