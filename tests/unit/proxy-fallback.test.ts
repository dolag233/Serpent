import { describe, expect, it } from "vitest";

import { createProxyFallbackRunGuard } from "../../src/renderer/proxy-fallback-run";

describe("proxy fallback run guard", () => {
  it("invalidates stale polling after a newer run begins", () => {
    const guard = createProxyFallbackRunGuard();
    const firstIsCurrent = guard.begin();
    const secondIsCurrent = guard.begin();

    expect(firstIsCurrent()).toBe(false);
    expect(secondIsCurrent()).toBe(true);
  });

  it("invalidates a run when the viewer is disposed or manually retried", () => {
    const guard = createProxyFallbackRunGuard();
    const isCurrent = guard.begin();

    guard.invalidate();

    expect(isCurrent()).toBe(false);
  });
});
