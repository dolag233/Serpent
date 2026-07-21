/**
 * Viewer presentation policy for REQ-VIEW-002.
 *
 * Opening the viewer must present a playable source (or ready cached preview)
 * immediately. Derivative generation must not own the primary surface as a
 * blocking "正在生成预览" gate.
 */

import {
  needsDirectPlaybackGate,
  type PreviewPollSnapshot,
} from "./preview-poll";

export type ViewerPrimarySurface =
  | "loading"
  | "media"
  | "unsupported"
  | "waiting"
  | "unavailable";

/**
 * Whether the resolution already has a URL the viewer can mount.
 * Source-video direct-play gating is advisory: callers may present optimistically
 * and fall back on real playback errors.
 */
export function canPresentPreviewMedia(
  resolution: PreviewPollSnapshot | null,
  options: { readonly requireDirectApproval?: boolean; readonly directApproved?: boolean } = {},
): boolean {
  if (!resolution?.url) return false;
  if (resolution.status !== "ready") {
    // Keep showing a previously resolved URL while a quiet upgrade is pending.
    return true;
  }
  if (
    options.requireDirectApproval &&
    needsDirectPlaybackGate(resolution) &&
    !options.directApproved
  ) {
    return false;
  }
  return true;
}

/**
 * Blocking wait is only for formats with no playable URL yet (e.g. EXR / AVI
 * still generating). Never block when media can already be presented.
 */
export function shouldBlockOnPreviewGeneration(
  resolution: PreviewPollSnapshot | null,
  canPresent: boolean,
): boolean {
  if (canPresent) return false;
  if (!resolution) return false;
  return resolution.status === "pending";
}

export function resolveViewerPrimarySurface(input: {
  readonly loading: boolean;
  readonly resolution: PreviewPollSnapshot | null;
  readonly directApproved: boolean;
  readonly requireDirectApproval?: boolean;
  /** Ready thumbnail available for mip-style first paint (Serpent-eh07). */
  readonly hasPlaceholder?: boolean;
}): ViewerPrimarySurface {
  const { loading, resolution, directApproved } = input;
  const requireDirectApproval = input.requireDirectApproval ?? false;
  const canPresent = canPresentPreviewMedia(resolution, {
    requireDirectApproval,
    directApproved,
  });

  if (canPresent) return "media";
  // Image navigation: show thumbnail immediately while full source resolves.
  if (input.hasPlaceholder) return "media";
  if (loading && !resolution) return "loading";
  if (
    resolution?.mediaType === "other" ||
    resolution?.errorCode === "UNSUPPORTED_FORMAT"
  ) {
    return "unsupported";
  }
  if (shouldBlockOnPreviewGeneration(resolution, canPresent)) {
    return "waiting";
  }
  if (loading) return "loading";
  return "unavailable";
}
