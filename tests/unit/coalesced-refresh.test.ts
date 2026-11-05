import { describe, expect, it, vi } from "vitest";

import { createCoalescedRefresh } from "../../src/renderer/coalesced-refresh";

describe("coalesced library refresh", () => {
  it("collapses requests behind a blocked query into one latest trailing refresh", async () => {
    const refresh = createCoalescedRefresh();
    let release!: () => void;
    const blocked = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const active = refresh("library", blocked);
    await Promise.resolve();
    const obsolete = vi.fn(async () => {});
    for (let index = 0; index < 1000; index += 1) refresh("library", obsolete);
    const latest = vi.fn(async () => {});
    expect(refresh("library", latest)).toBe(active);
    expect(blocked).toHaveBeenCalledTimes(1);
    expect(latest).not.toHaveBeenCalled();
    release();
    await active;
    expect(obsolete).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
  });

  it("lets a new library refresh while the old library query is blocked", async () => {
    const refresh = createCoalescedRefresh();
    let release!: () => void;
    const old = refresh("old", () => new Promise<void>((resolve) => { release = resolve; }));
    const next = vi.fn(async () => {});
    await refresh("new", next);
    expect(next).toHaveBeenCalledTimes(1);
    release();
    await old;
  });

  it("allows a fresh request after a rejected query", async () => {
    const refresh = createCoalescedRefresh();
    await expect(refresh("library", async () => { throw new Error("query failed"); }))
      .rejects.toThrow("query failed");
    const next = vi.fn(async () => {});
    await refresh("library", next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
