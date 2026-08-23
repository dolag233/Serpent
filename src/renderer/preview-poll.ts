/**
 * Preview resolution polling helpers (BUG-VIEWER-001).
 *
 * The viewer used to poll requestPreview every 1.5s even after ready, and each
 * poll re-ran setDirectApproved(false) for direct-play videos. That unmounted
 * the <video> element (~every poll interval) so a multi-second clip appeared to
 * "loop" after ~1.5–2s.
 */

export type PreviewPollStatus =
  | 'ready'
  | 'pending'
  | 'failed'
  | 'missing'
  | string;

export type PreviewPollSnapshot = {
  readonly status: PreviewPollStatus;
  readonly url?: string;
  readonly kind?: string;
  readonly playbackMode?: string;
  readonly playbackToken?: string;
  readonly posterUrl?: string;
  readonly errorCode?: string;
  readonly mediaType?: string;
  readonly sourceCodecs?: readonly string[];
  readonly colorSpacePending?: boolean;
};

export function needsDirectPlaybackGate(
  resolution: PreviewPollSnapshot,
): boolean {
  return (
    resolution.mediaType === 'video' &&
    resolution.playbackMode === 'source' &&
    Boolean(resolution.sourceCodecs?.length)
  );
}

export function previewPlaybackIdentity(
  resolution: PreviewPollSnapshot,
): string {
  return [
    resolution.playbackMode ?? '',
    resolution.playbackToken ?? '',
    resolution.url ?? '',
    resolution.kind ?? '',
  ].join('|');
}

export function samePreviewPlayback(
  left: PreviewPollSnapshot,
  right: PreviewPollSnapshot,
): boolean {
  return (
    left.status === right.status &&
    left.url === right.url &&
    left.kind === right.kind &&
    left.playbackMode === right.playbackMode &&
    left.playbackToken === right.playbackToken &&
    left.posterUrl === right.posterUrl &&
    left.errorCode === right.errorCode &&
    left.mediaType === right.mediaType
  );
}

/**
 * Keep polling only while artifacts are still settling or direct-play gate is
 * unresolved. Stop once the viewer has a playable ready URL.
 */
export function shouldContinuePreviewPolling(
  resolution: PreviewPollSnapshot | null,
  directApproved: boolean,
): boolean {
  if (!resolution) return true;
  if (resolution.colorSpacePending) return true;
  if (resolution.status === 'pending') return true;
  if (resolution.status !== 'ready') return false;
  if (!resolution.url) return true;
  if (needsDirectPlaybackGate(resolution) && !directApproved) return true;
  return false;
}

export function nextDirectApprovedState(input: {
  readonly resolution: PreviewPollSnapshot;
  readonly previousIdentity: string | null;
  readonly previousApproved: boolean;
}): { readonly approved: boolean; readonly identity: string } {
  const identity = previewPlaybackIdentity(input.resolution);
  if (!needsDirectPlaybackGate(input.resolution)) {
    return { approved: true, identity };
  }
  if (
    input.previousIdentity === identity &&
    input.previousApproved
  ) {
    return { approved: true, identity };
  }
  if (input.previousIdentity === identity) {
    return { approved: input.previousApproved, identity };
  }
  return { approved: false, identity };
}
