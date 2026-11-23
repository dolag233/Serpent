export type E2eRenderingEnvironment = Partial<Pick<
  NodeJS.ProcessEnv,
  | "SERPENT_E2E"
  | "SERPENT_E2E_ENABLE_SWIFTSHADER"
  | "SERPENT_E2E_PERF_OFFSCREEN"
  | "SERPENT_E2E_RENDERING_MODE"
  | "SERPENT_SOFTWARE_GL"
>>;

export type E2eRenderingPolicy = {
  nativeGpu: boolean;
  softwareGlEnabled: boolean;
  disableHardwareAcceleration: boolean;
  offscreen: boolean;
  disableBackgroundThrottling: boolean;
};

/** Resolve E2E-only rendering switches without changing platform defaults. */
export function resolveE2eRenderingPolicy(
  environment: E2eRenderingEnvironment,
  isPackaged: boolean,
): E2eRenderingPolicy {
  const e2e = environment.SERPENT_E2E === "1";
  const nativeGpu = !isPackaged
    && e2e
    && environment.SERPENT_E2E_RENDERING_MODE === "native-gpu";
  const softwareGlEnabled = (e2e && environment.SERPENT_E2E_ENABLE_SWIFTSHADER === "1")
    || environment.SERPENT_SOFTWARE_GL === "1";
  const perfOffscreen = e2e && environment.SERPENT_E2E_PERF_OFFSCREEN === "1";

  return {
    nativeGpu,
    softwareGlEnabled,
    disableHardwareAcceleration: e2e
      && environment.SERPENT_E2E_ENABLE_SWIFTSHADER !== "1"
      && !nativeGpu,
    offscreen: perfOffscreen && !nativeGpu,
    disableBackgroundThrottling: nativeGpu || perfOffscreen,
  };
}
