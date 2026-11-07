import type { BrowserWindow } from "electron";

import type { AppLogger } from "./app-logger";

type RendererWindow = Pick<BrowserWindow, "loadURL"> & {
  webContents: Pick<BrowserWindow["webContents"], "executeJavaScript">;
};

type LoadOptions = {
  serverWaitMs?: number;
  mountWaitMs?: number;
  pollMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  fetchUrl?: (url: string) => Promise<{ ok: boolean }>;
  onNavigated?: () => void;
};

const DEFAULT_SERVER_WAIT_MS = 60_000;
const DEFAULT_MOUNT_WAIT_MS = 120_000;
const DEFAULT_POLL_MS = 250;
const LOAD_ATTEMPTS = 4;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const defaultFetch = (url: string): Promise<Response> =>
  fetch(url, { signal: AbortSignal.timeout(2_000) });

async function waitForDevServer(
  url: string,
  options: Required<Pick<LoadOptions, "serverWaitMs" | "pollMs" | "now" | "sleep" | "fetchUrl">>,
): Promise<void> {
  const deadline = options.now() + options.serverWaitMs;
  while (options.now() < deadline) {
    try {
      if ((await options.fetchUrl(url)).ok) return;
    } catch {
      // Vite may still be binding or optimizing dependencies.
    }
    await options.sleep(options.pollMs);
  }
  throw new Error(`Renderer dev server did not become reachable within ${options.serverWaitMs}ms: ${url}`);
}

async function isRendererMounted(webContents: RendererWindow["webContents"]): Promise<boolean> {
  try {
    return Boolean(await webContents.executeJavaScript("Boolean(document.querySelector('#root .app-shell'))"));
  } catch {
    return false;
  }
}

async function waitForRendererMounted(
  webContents: RendererWindow["webContents"],
  options: Required<Pick<LoadOptions, "mountWaitMs" | "pollMs" | "now" | "sleep">>,
  logger?: Pick<AppLogger, "info" | "error">,
): Promise<boolean> {
  const deadline = options.now() + options.mountWaitMs;
  const entryRetryAt = options.now() + 20_000;
  let entryRetried = false;
  while (options.now() < deadline) {
    if (await isRendererMounted(webContents)) return true;
    if (!entryRetried && options.now() >= entryRetryAt) {
      entryRetried = true;
      // Vite can finish serving the page and its imports while Chromium never
      // evaluates the initial static module script. Re-import the same module
      // after the graph settles, without discarding the page or its requests.
      logger?.info("main.window.entry-retry", "Retrying the Renderer entry module without navigation.");
      void webContents.executeJavaScript("import('/src/renderer/main.tsx').then(() => true)").then(
        () => logger?.info("main.window.entry-retry-complete", "Renderer entry module evaluated."),
        (error: unknown) => logger?.error("main.window.entry-retry-failed", error),
      );
    }
    await options.sleep(options.pollMs);
  }
  return isRendererMounted(webContents);
}

async function rendererLoadState(webContents: RendererWindow["webContents"]): Promise<string> {
  try {
    return String(await webContents.executeJavaScript(`(() => {
      const root = document.querySelector('#root');
      const resources = performance.getEntriesByType('resource');
      return 'document=' + document.readyState
        + ', root=' + (root ? root.childElementCount : 'missing')
        + ', resources=' + resources.length
        + ', mainModule=' + resources.some((entry) => entry.name.includes('/src/renderer/main.tsx'))
        + ', viteError=' + Boolean(document.querySelector('vite-error-overlay'));
    })()`));
  } catch {
    return "renderer unavailable";
  }
}

/** A successful navigation must be allowed to finish its first module graph. */
export async function loadRendererDevUrl(
  window: RendererWindow,
  url: string,
  logger?: Pick<AppLogger, "info" | "error">,
  config: LoadOptions = {},
): Promise<void> {
  const options = {
    serverWaitMs: config.serverWaitMs ?? DEFAULT_SERVER_WAIT_MS,
    mountWaitMs: config.mountWaitMs ?? DEFAULT_MOUNT_WAIT_MS,
    pollMs: config.pollMs ?? DEFAULT_POLL_MS,
    now: config.now ?? Date.now,
    sleep: config.sleep ?? defaultSleep,
    fetchUrl: config.fetchUrl ?? defaultFetch,
  };
  await waitForDevServer(url, options);
  let lastLoadError: unknown;
  for (let attempt = 1; attempt <= LOAD_ATTEMPTS; attempt += 1) {
    try {
      await window.loadURL(url);
    } catch (error) {
      lastLoadError = error;
      logger?.error("main.window.load-attempt", error, { attempt, url });
      if (attempt < LOAD_ATTEMPTS) await options.sleep(400 * attempt);
      continue;
    }

    config.onNavigated?.();

    logger?.info("main.window.mount-wait", "Waiting for the first Renderer mount.", { attempt, url });
    if (await waitForRendererMounted(window.webContents, options, logger)) {
      logger?.info("main.window.mount-verified", "Renderer shell visible.", { attempt, url });
      return;
    }

    // A successful loadURL can still be fetching/transforming the Vite module
    // graph. Reloading here cancels that work and can prevent a cold start from
    // ever completing. Only navigation failures above warrant another loadURL.
    const state = await rendererLoadState(window.webContents);
    const error = new Error(`Renderer did not mount within ${options.mountWaitMs}ms: ${state}`);
    logger?.error("main.window.mount-failed", error, { url, state });
    throw error;
  }
  throw lastLoadError instanceof Error ? lastLoadError : new Error(`Renderer failed to load: ${url}`);
}
