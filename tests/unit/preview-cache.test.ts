import { mkdtempSync, writeFileSync, mkdirSync, utimesSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { rmSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PreviewCache } from "../../src/main/preview-cache";

describe("PreviewCache", () => {
  let root: string;
  let cache: PreviewCache;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "serpent-preview-cache-test-"));
    cache = new PreviewCache({ rootDir: path.join(root, "cache"), budgetBytes: 1024 * 1024 });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function originFile(name: string, bytes: number): string {
    const origin = path.join(root, "origin");
    mkdirSync(origin, { recursive: true });
    const file = path.join(origin, name);
    writeFileSync(file, Buffer.alloc(bytes, 7));
    return file;
  }

  it("mirrors an artifact and serves it from the mirror", async () => {
    const origin = originFile("a.bin", 128);
    expect(cache.locateSync("lib1", "artifact1", ".webp")).toBeNull();
    await cache.store("lib1", "artifact1", origin, ".webp");
    const mirrored = cache.locateSync("lib1", "artifact1", ".webp");
    expect(mirrored).not.toBeNull();
    expect(existsSync(mirrored!)).toBe(true);
    expect(await cache.totalBytes()).toBe(128);
    expect(await cache.countFiles()).toBe(1);
    expect(cache.getMetrics()).toMatchObject({
      hits: 1,
      misses: 1,
      stores: 1,
      bytesStored: 128,
    });
  });

  it("returns null for unknown artifacts without creating directories", () => {
    expect(cache.locateSync("lib1", "missing", ".webp")).toBeNull();
    expect(existsSync(path.join(root, "cache"))).toBe(false);
  });

  it("rejects path-traversal segments", async () => {
    const origin = originFile("a.bin", 16);
    await cache.store("../evil", "artifact", origin, ".webp");
    await cache.store("lib", "../../evil", origin, ".webp");
    expect(cache.locateSync("../evil", "artifact", ".webp")).toBeNull();
    expect(cache.locateSync("lib", "../../evil", ".webp")).toBeNull();
    expect(await cache.countFiles()).toBe(0);
  });

  it("resolves without throwing when the origin is missing", async () => {
    await cache.store("lib1", "artifact1", path.join(root, "does-not-exist.bin"), ".webp");
    expect(cache.locateSync("lib1", "artifact1", ".webp")).toBeNull();
    expect(await cache.countFiles()).toBe(0);
  });

  it("evicts least-recently-used mirrors beyond the budget", async () => {
    const small = new PreviewCache({ rootDir: path.join(root, "small"), budgetBytes: 300 });
    const first = originFile("first.bin", 200);
    const second = originFile("second.bin", 200);
    await small.store("lib", "old", first, ".webp");
    await small.store("lib", "new", second, ".webp");
    // Backdate the first mirror so LRU order is deterministic. Build the path
    // directly: locateSync would schedule an async mtime touch that can race
    // with utimesSync and re-freshen the entry mid-test.
    const oldPath = path.join(root, "small", "lib", "old.webp");
    const oldTime = new Date(Date.now() - 60_000);
    utimesSync(oldPath, oldTime, oldTime);
    small.locateSync("lib", "new", ".webp");
    await small.evictToBudget();
    expect(small.locateSync("lib", "old", ".webp")).toBeNull();
    expect(small.locateSync("lib", "new", ".webp")).not.toBeNull();
    expect(small.getMetrics()).toMatchObject({
      evictions: 1,
      bytesEvicted: 200,
    });
  });

  it("purges one library without touching others", async () => {
    const origin = originFile("a.bin", 32);
    await cache.store("libA", "artifact", origin, ".jpg");
    await cache.store("libB", "artifact", origin, ".jpg");
    await cache.purgeLibrary("libA");
    expect(cache.locateSync("libA", "artifact", ".jpg")).toBeNull();
    expect(cache.locateSync("libB", "artifact", ".jpg")).not.toBeNull();
  });

  it("emits hit, miss and store events for diagnostics", async () => {
    const events: string[] = [];
    const observed = new PreviewCache({
      rootDir: path.join(root, "events"),
      budgetBytes: 1024 * 1024,
      onEvent: (event) => events.push(`${event.kind}:${event.artifactId}`),
    });
    const origin = originFile("a.bin", 16);
    observed.locateSync("lib", "missing", ".webp");
    await observed.store("lib", "artifact", origin, ".webp");
    observed.locateSync("lib", "artifact", ".webp");
    expect(events).toContain("miss:missing");
    expect(events).toContain("store:artifact");
    expect(events).toContain("hit:artifact");
    expect(observed.getMetrics()).toMatchObject({ hits: 1, misses: 1, stores: 1 });
  });
});
