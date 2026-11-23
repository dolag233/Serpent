import { describe, expect, it } from "vitest";

import { resolveE2eRenderingPolicy } from "../../src/main/e2e-rendering-policy";

describe("E2E rendering policy", () => {
  it("ignores the native-gpu mode in production", () => {
    expect(resolveE2eRenderingPolicy({ SERPENT_E2E_RENDERING_MODE: "native-gpu" }, true)).toEqual({
      nativeGpu: false,
      softwareGlEnabled: false,
      disableHardwareAcceleration: false,
      offscreen: false,
      disableBackgroundThrottling: false,
    });
  });

  it("ignores native-gpu without the E2E flag", () => {
    const policy = resolveE2eRenderingPolicy({ SERPENT_E2E_RENDERING_MODE: "native-gpu" }, false);

    expect(policy.nativeGpu).toBe(false);
    expect(policy.disableHardwareAcceleration).toBe(false);
    expect(policy.offscreen).toBe(false);
    expect(policy.disableBackgroundThrottling).toBe(false);
  });

  it("keeps ordinary E2E rendering defaults", () => {
    expect(resolveE2eRenderingPolicy({ SERPENT_E2E: "1" }, false)).toEqual({
      nativeGpu: false,
      softwareGlEnabled: false,
      disableHardwareAcceleration: true,
      offscreen: false,
      disableBackgroundThrottling: false,
    });
  });

  it("keeps the explicit SwiftShader opt-in", () => {
    const policy = resolveE2eRenderingPolicy({
      SERPENT_E2E: "1",
      SERPENT_E2E_ENABLE_SWIFTSHADER: "1",
    }, false);

    expect(policy.disableHardwareAcceleration).toBe(false);
    expect(policy.softwareGlEnabled).toBe(true);
    expect(policy.nativeGpu).toBe(false);
  });

  it("keeps ordinary performance E2E offscreen", () => {
    expect(resolveE2eRenderingPolicy({
      SERPENT_E2E: "1",
      SERPENT_E2E_PERF_OFFSCREEN: "1",
    }, false)).toEqual({
      nativeGpu: false,
      softwareGlEnabled: false,
      disableHardwareAcceleration: true,
      offscreen: true,
      disableBackgroundThrottling: true,
    });
  });

  it("uses a hidden native window with hardware acceleration and no background throttling", () => {
    const policy = resolveE2eRenderingPolicy({
      SERPENT_E2E: "1",
      SERPENT_E2E_RENDERING_MODE: "native-gpu",
    }, false);

    expect(policy).toEqual({
      nativeGpu: true,
      softwareGlEnabled: false,
      disableHardwareAcceleration: false,
      offscreen: false,
      disableBackgroundThrottling: true,
    });
  });

  it("keeps native-gpu non-offscreen when PERF_OFFSCREEN is also set", () => {
    const policy = resolveE2eRenderingPolicy({
      SERPENT_E2E: "1",
      SERPENT_E2E_PERF_OFFSCREEN: "1",
      SERPENT_E2E_RENDERING_MODE: "native-gpu",
    }, false);

    expect(policy.nativeGpu).toBe(true);
    expect(policy.offscreen).toBe(false);
    expect(policy.disableBackgroundThrottling).toBe(true);
    expect(policy.disableHardwareAcceleration).toBe(false);
  });

  it("falls back for an unknown rendering mode", () => {
    const policy = resolveE2eRenderingPolicy({
      SERPENT_E2E: "1",
      SERPENT_E2E_PERF_OFFSCREEN: "1",
      SERPENT_E2E_RENDERING_MODE: "unknown-mode",
    }, false);

    expect(policy.nativeGpu).toBe(false);
    expect(policy.offscreen).toBe(true);
    expect(policy.disableHardwareAcceleration).toBe(true);
  });

  it("marks SwiftShader and software GL as incompatible with native-gpu", () => {
    expect(resolveE2eRenderingPolicy({
      SERPENT_E2E: "1",
      SERPENT_E2E_RENDERING_MODE: "native-gpu",
      SERPENT_E2E_ENABLE_SWIFTSHADER: "1",
    }, false).softwareGlEnabled).toBe(true);
    expect(resolveE2eRenderingPolicy({
      SERPENT_E2E: "1",
      SERPENT_E2E_RENDERING_MODE: "native-gpu",
      SERPENT_SOFTWARE_GL: "1",
    }, false).softwareGlEnabled).toBe(true);
  });
});
