import type { BrowserWindowConstructorOptions } from 'electron';

import {
  criticalConfirmationDecisionSchema,
  criticalConfirmationPayloadSchema,
  type CriticalConfirmationPayload,
} from '../shared/critical-confirmation';
import {
  CRITICAL_CONFIRMATION_DECIDE_CHANNEL,
  CRITICAL_CONFIRMATION_GET_CHANNEL,
} from '../shared/protocol/channels';

const CRITICAL_CONFIRMATION_PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>Serpent</title>
<style>
:root {
  color-scheme: dark light;
  --ui-font-scale: 1;
  --ui-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --ui-font-weight-bold: 700;
  font-family: var(--ui-font-family);
  background: #17191c;
  color: #f4f5f6;
}
* { box-sizing: border-box; }
body { margin: 0; background: #17191c; }
main { display: flex; flex-direction: column; padding: 22px 26px 18px; }
h1 { margin: 0 0 14px; font-size: calc(20px * var(--ui-font-scale)); line-height: 1.3; }
.message { margin: 0 0 10px; font-size: calc(14px * var(--ui-font-scale)); line-height: 1.55; }
.detail { margin: 0; color: #b9bec5; font-size: calc(12px * var(--ui-font-scale)); line-height: 1.55; white-space: pre-wrap; }
.actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
button { min-width: 96px; min-height: 36px; padding: 7px 16px; border: 1px solid #555b63; border-radius: 7px; color: #f4f5f6; background: #292d32; font: inherit; font-size: calc(13px * var(--ui-font-scale)); cursor: pointer; }
button:focus-visible { outline: 2px solid #7eb5ff; outline-offset: 2px; }
button.confirm { border-color: #ff5c5c; background: #c73737; color: white; font-weight: var(--ui-font-weight-bold); }
button.confirm:hover { background: #dc4545; }
button:disabled { cursor: default; opacity: .65; }
@media (prefers-color-scheme: light) {
  :root, body { background: #f7f8fa; color: #1d2024; }
  .detail { color: #59616c; }
  button { border-color: #c7cbd1; color: #1d2024; background: #fff; }
}
</style>
</head>
<body>
<main aria-labelledby="critical-heading" role="dialog" aria-modal="true">
  <h1 id="critical-heading">正在加载…</h1>
  <p class="message" id="critical-message"></p>
  <p class="detail" id="critical-detail"></p>
  <div class="actions">
    <button id="critical-cancel" type="button">取消</button>
    <button class="confirm" id="critical-confirm" type="button">确认</button>
  </div>
</main>
<script>
(async () => {
  const api = window.serpentCriticalConfirmation;
  const heading = document.getElementById('critical-heading');
  const message = document.getElementById('critical-message');
  const detail = document.getElementById('critical-detail');
  const cancel = document.getElementById('critical-cancel');
  const confirm = document.getElementById('critical-confirm');
  const cancelAndClose = () => { void api.decide('cancel'); };
  try {
    const request = await api.getRequest();
    document.title = request.title;
    heading.textContent = request.heading;
    message.textContent = request.message;
    detail.textContent = request.detail;
    cancel.textContent = request.cancelLabel;
    confirm.textContent = request.confirmLabel;
    document.body.dataset.criticalConfirmationReady = 'true';
    cancel.addEventListener('click', cancelAndClose);
    confirm.addEventListener('click', () => { void api.decide('confirm'); });
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelAndClose();
      }
    });
    cancel.focus();
  } catch {
    cancelAndClose();
  }
})();
</script>
</body>
</html>`;

const CRITICAL_CONFIRMATION_WIDTH = 540;
const CRITICAL_CONFIRMATION_MIN_HEIGHT = 220;
const CRITICAL_CONFIRMATION_MAX_HEIGHT = 560;
const CRITICAL_CONFIRMATION_SIZE_POLL_INTERVAL_MS = 16;
const CRITICAL_CONFIRMATION_SIZE_POLL_ATTEMPTS = 60;
const CRITICAL_CONFIRMATION_FONT_SCALES = [0.94, 1, 1.06] as const;
const CRITICAL_CONFIRMATION_DEFAULT_FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const CRITICAL_CONFIRMATION_MAX_FONT_FAMILY_LENGTH = 512;

export interface CriticalConfirmationWindowLike {
  readonly id: number;
  readonly webContents: {
    readonly id: number;
    isDestroyed(): boolean;
    setWindowOpenHandler(handler: () => { action: 'deny' }): void;
    on(event: 'will-navigate', listener: (event: { preventDefault(): void }) => void): void;
    executeJavaScript(code: string): Promise<unknown>;
  };
  loadURL(url: string): Promise<void>;
  show(): void;
  focus(): void;
  close(): void;
  isDestroyed(): boolean;
  setContentSize(width: number, height: number): void;
  on(event: 'closed' | 'ready-to-show', listener: () => void): void;
  once(event: 'ready-to-show', listener: () => void): void;
  removeListener(event: 'closed' | 'ready-to-show', listener: () => void): void;
}

export interface CriticalConfirmationIpcHost {
  handle(
    channel: string,
    listener: (event: { sender: { id: number } }, input?: unknown) => unknown,
  ): void;
  removeHandler(channel: string): void;
}

export interface CriticalConfirmationLogger {
  error(scope: string, error: unknown, context?: Record<string, unknown>): void;
  info?(scope: string, message: string, context?: Record<string, unknown>): void;
}

export interface CriticalConfirmationWindowManagerOptions {
  getParentWindow(): CriticalConfirmationWindowLike | null;
  createWindow(options: BrowserWindowConstructorOptions): CriticalConfirmationWindowLike;
  ipcMain: CriticalConfirmationIpcHost;
  preloadPath: string;
  logger?: CriticalConfirmationLogger;
}

type PendingRequest = {
  payload: CriticalConfirmationPayload;
  parent: CriticalConfirmationWindowLike;
  resolve: (confirmed: boolean) => void;
};

type ActiveRequest = PendingRequest & {
  window: CriticalConfirmationWindowLike;
  settled: boolean;
  onParentClosed: () => void;
  onWindowClosed: () => void;
};

export function criticalConfirmationPageUrl(): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(CRITICAL_CONFIRMATION_PAGE)}`;
}

export function criticalConfirmationWindowOptions(input: {
  parent: CriticalConfirmationWindowLike;
  preloadPath: string;
}): BrowserWindowConstructorOptions {
  return {
    width: CRITICAL_CONFIRMATION_WIDTH,
    height: CRITICAL_CONFIRMATION_MIN_HEIGHT,
    minWidth: 460,
    minHeight: CRITICAL_CONFIRMATION_MIN_HEIGHT,
    maxWidth: 760,
    maxHeight: CRITICAL_CONFIRMATION_MAX_HEIGHT,
    show: false,
    modal: true,
    parent: input.parent as unknown as BrowserWindowConstructorOptions['parent'],
    resizable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    backgroundColor: '#17191c',
    title: 'Serpent',
    webPreferences: {
      preload: input.preloadPath,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  };
}

/**
 * Main-owned critical confirmation window. It serializes low-frequency
 * destructive prompts and fails closed when either the owner or child closes.
 * The child receives only a validated display payload and a two-value decision
 * API; it has no application preload or filesystem capability.
 */
export class CriticalConfirmationWindowManager {
  readonly #options: CriticalConfirmationWindowManagerOptions;
  readonly #queue: PendingRequest[] = [];
  #active: ActiveRequest | undefined;
  #disposed = false;

  public constructor(options: CriticalConfirmationWindowManagerOptions) {
    this.#options = options;
    options.ipcMain.handle(CRITICAL_CONFIRMATION_GET_CHANNEL, (event) => {
      const active = this.#active;
      if (active === undefined || active.window.webContents.id !== event.sender.id) {
        throw new Error('Critical confirmation request is unavailable.');
      }
      return active.payload;
    });
    options.ipcMain.handle(CRITICAL_CONFIRMATION_DECIDE_CHANNEL, (event, input) => {
      const active = this.#active;
      const parsed = criticalConfirmationDecisionSchema.safeParse(input);
      if (active === undefined || active.window.webContents.id !== event.sender.id || !parsed.success) {
        return false;
      }
      this.#finish(active, parsed.data === 'confirm');
      return true;
    });
  }

  public request(payload: CriticalConfirmationPayload): Promise<boolean> {
    const parsed = criticalConfirmationPayloadSchema.safeParse(payload);
    if (!parsed.success || this.#disposed) return Promise.resolve(false);
    const parent = this.#options.getParentWindow();
    if (parent === null || parent.isDestroyed()) return Promise.resolve(false);
    this.#options.logger?.info?.(
      'critical-confirmation.request',
      'Queued a critical confirmation window.',
      { title: parsed.data.title },
    );
    return new Promise((resolve) => {
      this.#queue.push({ payload: parsed.data, parent, resolve });
      this.#startNext();
    });
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const active = this.#active;
    if (active !== undefined) this.#finish(active, false);
    for (const pending of this.#queue.splice(0)) pending.resolve(false);
    this.#options.ipcMain.removeHandler(CRITICAL_CONFIRMATION_GET_CHANNEL);
    this.#options.ipcMain.removeHandler(CRITICAL_CONFIRMATION_DECIDE_CHANNEL);
  }

  #startNext(): void {
    if (this.#active !== undefined || this.#disposed) return;
    const pending = this.#queue.shift();
    if (pending === undefined) return;
    if (pending.parent.isDestroyed()) {
      pending.resolve(false);
      this.#startNext();
      return;
    }
    let window: CriticalConfirmationWindowLike;
    try {
      window = this.#options.createWindow(criticalConfirmationWindowOptions({
        parent: pending.parent,
        preloadPath: this.#options.preloadPath,
      }));
    } catch (error) {
      this.#options.logger?.error('critical-confirmation.window-create', error);
      pending.resolve(false);
      this.#startNext();
      return;
    }
    const onParentClosed = (): void => {
      if (this.#active !== undefined && this.#active.window === window) this.#finish(this.#active, false);
    };
    const onWindowClosed = (): void => {
      if (this.#active !== undefined && this.#active.window === window) this.#finish(this.#active, false);
    };
    this.#active = { ...pending, window, settled: false, onParentClosed, onWindowClosed };
    let readyToShow = false;
    let contentSizeSet = false;
    const showWhenReady = (): void => {
      if (!readyToShow || !contentSizeSet || this.#active?.window !== window || window.isDestroyed()) return;
      window.show();
      window.focus();
    };
    this.#options.logger?.info?.(
      'critical-confirmation.window-created',
      'Created a critical confirmation window.',
      { title: pending.payload.title, windowId: window.id },
    );
    pending.parent.on('closed', onParentClosed);
    window.on('closed', onWindowClosed);
    window.once('ready-to-show', () => {
      readyToShow = true;
      showWhenReady();
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    void window.loadURL(criticalConfirmationPageUrl()).then(async () => {
      // The confirmation page is a separate data URL, so it cannot read the
      // renderer's localStorage. Copy only the validated scale from the
      // parent before measuring the page; this keeps the modal typography in
      // step with the main window without expanding its preload surface.
      let fontScale = 1;
      let fontFamily = CRITICAL_CONFIRMATION_DEFAULT_FONT_FAMILY;
      try {
        const value = await pending.parent.webContents.executeJavaScript(
          "getComputedStyle(document.documentElement).getPropertyValue('--ui-font-scale')",
        );
        const parsed = Number(value);
        const matched = CRITICAL_CONFIRMATION_FONT_SCALES.find(
          (candidate) => Math.abs(candidate - parsed) < 0.001,
        );
        if (matched !== undefined) fontScale = matched;
      } catch {
        // Default typography is safe if the parent is navigating or closing.
      }
      try {
        const value = await pending.parent.webContents.executeJavaScript(
          'getComputedStyle(document.documentElement).fontFamily',
        );
        if (
          typeof value === 'string' &&
          value.length > 0 &&
          value.length <= CRITICAL_CONFIRMATION_MAX_FONT_FAMILY_LENGTH &&
          /^[\w\s,'"-]+$/.test(value)
        ) {
          fontFamily = value;
        }
      } catch {
        // Keep the platform-neutral fallback if the parent is unavailable.
      }
      try {
        await window.webContents.executeJavaScript(
          `(() => {
            const root = document.documentElement;
            root.style.setProperty('--ui-font-scale', '${fontScale}');
            root.style.setProperty('--ui-font-family', ${JSON.stringify(fontFamily)});
          })()`,
        );
      } catch {
        // The size poll below will still use the page's default scale.
      }
      // The request arrives through a preload IPC call after the page loads.
      // Wait until the page has rendered that payload before measuring; a
      // one-shot measurement can otherwise size the window to the loading
      // placeholder and leave the real content in a badly sized window.
      const sizeToContent = (attempt: number): void => {
        if (this.#active?.window !== window || window.isDestroyed()) return;
        void window.webContents.executeJavaScript(
          `(() => {
            const main = document.querySelector('main');
            return {
              ready: document.body.dataset.criticalConfirmationReady === 'true',
              height: main instanceof HTMLElement ? main.scrollHeight : 0,
            };
          })()`,
        ).then((value) => {
          if (this.#active?.window !== window || window.isDestroyed()) return;
          const metrics = value as { ready?: unknown; height?: unknown };
          if (metrics.ready !== true && attempt < CRITICAL_CONFIRMATION_SIZE_POLL_ATTEMPTS) {
            setTimeout(
              () => sizeToContent(attempt + 1),
              CRITICAL_CONFIRMATION_SIZE_POLL_INTERVAL_MS,
            );
            return;
          }
          const measuredHeight = Number(metrics.height);
          const contentHeight = Number.isFinite(measuredHeight)
            ? Math.max(CRITICAL_CONFIRMATION_MIN_HEIGHT, Math.min(CRITICAL_CONFIRMATION_MAX_HEIGHT, Math.ceil(measuredHeight)))
            : CRITICAL_CONFIRMATION_MIN_HEIGHT;
          window.setContentSize(CRITICAL_CONFIRMATION_WIDTH, contentHeight);
          contentSizeSet = true;
          showWhenReady();
        }).catch(() => {
          if (this.#active?.window === window && !window.isDestroyed()) {
            window.setContentSize(CRITICAL_CONFIRMATION_WIDTH, CRITICAL_CONFIRMATION_MIN_HEIGHT);
            contentSizeSet = true;
            showWhenReady();
          }
        });
      };
      sizeToContent(0);
    }).catch((error) => {
      this.#options.logger?.error('critical-confirmation.window-load', error);
      if (this.#active?.window === window) this.#finish(this.#active, false);
    });
  }

  #finish(active: ActiveRequest, confirmed: boolean): void {
    if (active.settled) return;
    active.settled = true;
    if (this.#active === active) this.#active = undefined;
    active.parent.removeListener('closed', active.onParentClosed);
    active.window.removeListener('closed', active.onWindowClosed);
    active.resolve(confirmed);
    if (!active.window.isDestroyed()) {
      try {
        active.window.close();
      } catch (error) {
        this.#options.logger?.error('critical-confirmation.window-close', error);
      }
    }
    queueMicrotask(() => this.#startNext());
  }
}
