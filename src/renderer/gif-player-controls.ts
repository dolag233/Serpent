/**
 * Pure helpers for GIF viewer play/pause and frame stepping (CU-D8).
 *
 * Browser `<img>` has no frame API. Practical path:
 * - Space / button toggles play vs freeze (canvas snapshot of current paint)
 * - When Chromium ImageDecoder is available, prev/next can step frames
 */

import {
  isEditableKeyboardTarget,
  nextPlaybackIntent,
  type KeyboardTargetLike,
  type PlaybackIntent,
} from "./video-player-controls";
import { fileExtensionLabel } from "./asset-card-badges";

export { nextPlaybackIntent };
export type { PlaybackIntent };

export function isGifDisplayName(displayName: string): boolean {
  return fileExtensionLabel(displayName) === "GIF";
}

function isFocusedChromeControl(
  target: KeyboardTargetLike | EventTarget | null,
): boolean {
  if (target == null || typeof target !== "object") return false;
  const el = target as KeyboardTargetLike & object;
  const tag = el.tagName?.toUpperCase();
  if (tag === "BUTTON" || tag === "A" || tag === "INPUT") return true;
  if (
    typeof el.closest === "function" &&
    el.closest(
      'button, a, input, [role="button"], [role="menuitem"], [role="option"], [role="slider"]',
    )
  ) {
    return true;
  }
  return false;
}

/** Space toggles GIF play/pause (same gate as video; F remains fit). */
export function shouldHandleGifSpaceKey(event: {
  key: string;
  code?: string;
  repeat: boolean;
  target: KeyboardTargetLike | EventTarget | null;
}): boolean {
  if (event.repeat) return false;
  if (event.key !== " " && event.code !== "Space") return false;
  if (isEditableKeyboardTarget(event.target)) return false;
  if (isFocusedChromeControl(event.target)) return false;
  return true;
}

export function clampGifFrameIndex(index: number, frameCount: number): number {
  if (!Number.isFinite(frameCount) || frameCount <= 0) return 0;
  const max = Math.floor(frameCount) - 1;
  if (!Number.isFinite(index)) return 0;
  return Math.min(max, Math.max(0, Math.floor(index)));
}

export function stepGifFrameIndex(
  current: number,
  frameCount: number,
  delta: -1 | 1,
): number {
  if (!Number.isFinite(frameCount) || frameCount <= 0) return 0;
  const max = Math.floor(frameCount) - 1;
  const next = Math.floor(current) + delta;
  if (next < 0) return max;
  if (next > max) return 0;
  return next;
}

/** Capture the currently painted frame of an animated GIF `<img>` (Chromium). */
export function captureImageElementFrame(
  image: HTMLImageElement,
): string | null {
  if (!image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) {
    return null;
  }
  try {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

export type ImageDecoderLike = {
  tracks: { ready: Promise<unknown>; selectedTrack?: { frameCount: number } };
  decode(options: {
    frameIndex: number;
  }): Promise<{ image: CanvasImageSource & { close(): void; displayWidth?: number; displayHeight?: number; codedWidth?: number; codedHeight?: number } }>;
  close(): void;
};

export function imageDecoderSupported(): boolean {
  return typeof globalThis.ImageDecoder === "function";
}
