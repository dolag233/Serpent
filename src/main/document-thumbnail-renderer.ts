/**
 * Offscreen HTML document thumbnail renderer (Serpent-8ca259).
 *
 * Main owns a short-lived offscreen BrowserWindow that loads the HTML source
 * via serpent://source and captures a screenshot with webContents.capturePage().
 * The PNG bytes return to the Worker, which persists the artifact row.
 *
 * Security: the window is created sandboxed (no preload, no Node integration,
 * default webSecurity) so page JS executes like a browser opening a local file.
 * Navigation is restricted to the requested URL; popups and new windows are
 * suppressed.
 */

import { BrowserWindow } from 'electron';

import {
  DOCUMENT_THUMBNAIL_WIDTH,
  type DocumentThumbnailRenderRequest,
  type DocumentThumbnailRenderResponse,
} from '../shared/document-thumbnail-protocol';
import type { AppLogger } from './app-logger';

function isPng(buffer: Buffer): boolean {
  return buffer.length > 8
    && buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47;
}

/**
 * Render one HTML document thumbnail. Each request uses a fresh offscreen
 * window (HTML pages may keep timers/state; a shared window would leak across
 * assets). The window is destroyed in all paths.
 */
export async function renderDocumentThumbnail(
  request: DocumentThumbnailRenderRequest,
  logger: AppLogger,
): Promise<DocumentThumbnailRenderResponse['result']> {
  let window: BrowserWindow | null = null;
  try {
    window = new BrowserWindow({
      width: request.width,
      height: 800,
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        // No preload: the page must not receive any extra capability.
        webSecurity: true,
      },
    });
    // Suppress popups / new windows and block navigation away from the source.
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => {
      if (url !== request.url) event.preventDefault();
    });
    await window.loadURL(request.url);
    // Wait for the page's own layout/font readiness instead of guessing that
    // every document settles within a fixed wall-clock window. `loadURL`
    // already waits for the document load event; `document.fonts.ready` and
    // two animation frames cover late font/layout commits without imposing a
    // deadline on a large or slow local HTML asset.
    await window.webContents.executeJavaScript(`
      (async () => {
        if (document.fonts?.ready) await document.fonts.ready;
        await new Promise((resolve) => requestAnimationFrame(() => resolve()));
        await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      })()
    `, true);
    if (window.isDestroyed()) {
      return {
        status: 'failed',
        errorCode: 'DOCUMENT_WINDOW_FAILED',
        reason: 'offscreen window destroyed before capture',
      };
    }
    const image = await window.webContents.capturePage();
    if (image.isEmpty()) {
      return {
        status: 'failed',
        errorCode: 'DOCUMENT_BLANK_FRAME',
        reason: 'captured frame is empty',
      };
    }
    const png = image.toPNG();
    if (!isPng(png) || png.length === 0) {
      return {
        status: 'failed',
        errorCode: 'DOCUMENT_FRAME_INVALID',
        reason: 'captured frame is not a PNG',
      };
    }
    return {
      status: 'ok',
      png: new Uint8Array(png),
      width: image.getSize().width,
      height: image.getSize().height,
    };
  } catch (error) {
    logger.error('document-thumbnail.render', error, {
      url: request.url,
    });
    return {
      status: 'failed',
      errorCode: 'DOCUMENT_LOAD_FAILED',
      reason: error instanceof Error ? error.message : 'document load failed',
    };
  } finally {
    try {
      window?.destroy();
    } catch {
      // Already destroyed.
    }
  }
}

/** The window options helper keeps the constructor testable. */
export function documentThumbnailWindowWidth(): number {
  return DOCUMENT_THUMBNAIL_WIDTH;
}
