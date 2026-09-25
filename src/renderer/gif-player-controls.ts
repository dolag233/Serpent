/**
 * GIF display-name helper for viewer / inspector routing.
 *
 * Animated GIFs in the viewer use GifViewerPlayer (video transport).
 * Cards, hover, and Inspector keep native `<img>` autoplay.
 * Preloaded viewer surfaces stay on ZoomableImage until promoted.
 */

import { fileExtensionLabel } from "./asset-card-badges";

export function isGifDisplayName(displayName: string): boolean {
  return fileExtensionLabel(displayName) === "GIF";
}
