/**
 * GIF display-name helper for viewer / inspector routing.
 *
 * Viewer GIFs autoplay via native animated `<img>` (ZoomableImage).
 * Pause / frame-step chrome was removed (Serpent-1zj / VIEW-010 withdrawn).
 */

import { fileExtensionLabel } from "./asset-card-badges";

export function isGifDisplayName(displayName: string): boolean {
  return fileExtensionLabel(displayName) === "GIF";
}
