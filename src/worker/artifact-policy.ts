/**
 * Pure policy for derived media artifacts.
 *
 * The durable queue stores implementation-oriented job kinds while the
 * product talks about roles (card thumbnail, poster, playback proxy, ...).
 * Keeping that mapping and the admission rules pure makes it possible to
 * prove the expensive boundary without starting Sharp/FFmpeg or opening a
 * library database. The Library Worker still owns the final database checks;
 * this module is deliberately not an authorization layer.
 */

export type ArtifactMediaType =
  | 'image'
  | 'video'
  | 'audio'
  | 'text'
  | 'model'
  | 'document'
  | 'other';

export type ArtifactJobKind =
  | 'generate_thumbnail'
  | 'generate_video_poster'
  | 'generate_contact_sheet'
  | 'generate_webm_proxy'
  | 'generate_audio_proxy'
  | 'extract_metadata'
  | 'extract_palette';

export type ArtifactRole =
  | 'card-thumbnail'
  | 'viewer-placeholder'
  | 'viewer-image'
  | 'model-viewer'
  | 'video-poster'
  | 'playback-proxy'
  | 'contact-sheet'
  | 'audio-waveform'
  | 'technical-metadata'
  | 'palette';

export type ArtifactKind =
  | 'thumbnail'
  | 'viewer_image'
  | 'video_poster'
  | 'contact_sheet'
  | 'webm_proxy'
  | 'audio_proxy'
  | 'extracted_metadata'
  | 'extracted_palette';

export type ArtifactAdmissionReason =
  | 'admitted'
  | 'unsupported-media'
  | 'deleted'
  | 'ignored'
  | 'unavailable'
  | 'missing-revision'
  | 'stale-revision'
  | 'source-direct'
  | 'already-ready'
  | 'terminal-failed'
  | 'single-flight';

export type ArtifactPolicy = Readonly<{
  mediaType: ArtifactMediaType;
  primaryRole: ArtifactRole | null;
  primaryJobKind: ArtifactJobKind | null;
  primaryArtifactKind: ArtifactKind | null;
  sourceMode: 'direct' | 'direct-with-fallback' | 'derived' | 'unsupported';
  paletteEligible: boolean;
}>;

export type ArtifactKeyInput = Readonly<{
  assetId: string;
  revisionId: string;
  role: ArtifactRole;
  generatorId: string;
  generatorVersion: string;
  settingsHash: string;
}>;

export type ArtifactAdmissionInput = Readonly<{
  assetId: string;
  revisionId: string;
  currentRevisionId: string | null;
  mediaType: ArtifactMediaType;
  jobKind: ArtifactJobKind;
  availability: 'available' | 'missing';
  deleted?: boolean;
  ignored?: boolean;
  /** Proxy jobs are valid only when a real source-decode failure requested them. */
  explicitRequest?: boolean;
  readyArtifact?: boolean;
  failedArtifact?: boolean;
  activeJob?: boolean;
  /** Small native raster cards use the authorized source URL instead. */
  sourceDirect?: boolean;
  retryFailed?: boolean;
  generatorId?: string;
  generatorVersion?: string;
  settingsHash?: string;
}>;

export type ArtifactAdmissionDecision = Readonly<{
  admitted: boolean;
  reason: ArtifactAdmissionReason;
  role: ArtifactRole | null;
  artifactKind: ArtifactKind | null;
  key: string | null;
}>;

/** Durable intent marker for an on-demand playback fallback job. */
export const EXPLICIT_PROXY_FALLBACK_MARKER = 'EXPLICIT_PROXY_FALLBACK';

const PROXY_JOB_KINDS = new Set<ArtifactJobKind>([
  'generate_webm_proxy',
  'generate_audio_proxy',
]);

const VISUAL_MEDIA_TYPES = new Set<ArtifactMediaType>([
  'image',
  'video',
  'model',
  'document',
]);

/** Map a durable job to the user-visible artifact role it produces. */
export function artifactRoleForJob(
  jobKind: ArtifactJobKind,
  mediaType: ArtifactMediaType,
): ArtifactRole | null {
  switch (jobKind) {
    case 'generate_thumbnail':
      return mediaType === 'video' ? 'video-poster' : [
        'image', 'audio', 'model', 'document',
      ].includes(mediaType)
        ? 'card-thumbnail'
        : null;
    case 'generate_video_poster':
      return mediaType === 'video' ? 'video-poster' : null;
    case 'generate_contact_sheet':
      return mediaType === 'video' ? 'contact-sheet' : null;
    case 'generate_webm_proxy':
      return mediaType === 'video' ? 'playback-proxy' : null;
    case 'generate_audio_proxy':
      return mediaType === 'audio' ? 'playback-proxy' : null;
    case 'extract_metadata':
      return mediaType === 'video' ? 'technical-metadata' : null;
    case 'extract_palette':
      return VISUAL_MEDIA_TYPES.has(mediaType) ? 'palette' : null;
  }
}

/** Map a durable job to the current revision_artifacts kind it owns. */
export function artifactKindForJob(
  jobKind: ArtifactJobKind,
  mediaType: ArtifactMediaType,
): ArtifactKind | null {
  switch (jobKind) {
    case 'generate_thumbnail':
      return mediaType === 'video' ? 'video_poster' : [
        'image', 'audio', 'model', 'document',
      ].includes(mediaType)
        ? 'thumbnail'
        : null;
    case 'generate_video_poster': return mediaType === 'video' ? 'video_poster' : null;
    case 'generate_contact_sheet': return mediaType === 'video' ? 'contact_sheet' : null;
    case 'generate_webm_proxy': return mediaType === 'video' ? 'webm_proxy' : null;
    case 'generate_audio_proxy': return mediaType === 'audio' ? 'audio_proxy' : null;
    case 'extract_metadata': return mediaType === 'video' ? 'extracted_metadata' : null;
    case 'extract_palette': return VISUAL_MEDIA_TYPES.has(mediaType) ? 'extracted_palette' : null;
  }
}

/** Map a persisted artifact kind to its stable product role. */
export function artifactRoleForKind(kind: string): ArtifactRole | null {
  switch (kind) {
    case 'thumbnail': return 'card-thumbnail';
    case 'viewer_image': return 'viewer-image';
    case 'video_poster': return 'video-poster';
    case 'contact_sheet': return 'contact-sheet';
    case 'webm_proxy':
    case 'audio_proxy': return 'playback-proxy';
    case 'extracted_metadata': return 'technical-metadata';
    case 'extracted_palette': return 'palette';
    case 'model_glb': return 'model-viewer';
    default: return null;
  }
}

/**
 * Split the generator declaration into the stable implementation id and its
 * settings token. Existing generator strings predate this schema and use a
 * semicolon to append settings; declarations without one remain valid and
 * receive the explicit `default` settings token.
 */
export function artifactGeneratorIdentity(generatorVersion: string): {
  generatorId: string;
  settingsHash: string;
} {
  const separator = generatorVersion.indexOf(';');
  if (separator < 0) {
    return { generatorId: generatorVersion, settingsHash: 'default' };
  }
  return {
    generatorId: generatorVersion.slice(0, separator),
    settingsHash: generatorVersion.slice(separator + 1) || 'default',
  };
}

/**
 * Build the persisted identity for an already-written artifact row. The
 * database migration uses the same rules in SQL for old rows and the insert
 * trigger applies them to legacy write sites that still provide only the
 * original artifact columns.
 */
export function artifactIdentityForPersistedRow(input: {
  assetId: string;
  revisionId: string;
  kind: string;
  generatorVersion: string;
}): {
  role: ArtifactRole;
  generatorId: string;
  generatorVersion: string;
  settingsHash: string;
  key: string;
} | null {
  const role = artifactRoleForKind(input.kind);
  if (!role) return null;
  const { generatorId, settingsHash } = artifactGeneratorIdentity(input.generatorVersion);
  return {
    role,
    generatorId,
    generatorVersion: input.generatorVersion,
    settingsHash,
    key: artifactKey({
      assetId: input.assetId,
      revisionId: input.revisionId,
      role,
      generatorId,
      generatorVersion: input.generatorVersion,
      settingsHash,
    }),
  };
}

/** Return the complete role and source policy for one media category. */
export function artifactPolicyForMediaType(mediaType: ArtifactMediaType): ArtifactPolicy {
  switch (mediaType) {
    case 'image':
      return {
        mediaType,
        primaryRole: 'card-thumbnail',
        primaryJobKind: 'generate_thumbnail',
        primaryArtifactKind: 'thumbnail',
        sourceMode: 'derived',
        paletteEligible: true,
      };
    case 'video':
      return {
        mediaType,
        primaryRole: 'video-poster',
        primaryJobKind: 'generate_thumbnail',
        primaryArtifactKind: 'video_poster',
        sourceMode: 'direct-with-fallback',
        paletteEligible: true,
      };
    case 'audio':
      return {
        mediaType,
        primaryRole: 'card-thumbnail',
        primaryJobKind: 'generate_thumbnail',
        primaryArtifactKind: 'thumbnail',
        sourceMode: 'direct-with-fallback',
        paletteEligible: false,
      };
    case 'model':
      return {
        mediaType,
        primaryRole: 'card-thumbnail',
        primaryJobKind: 'generate_thumbnail',
        primaryArtifactKind: 'thumbnail',
        sourceMode: 'direct',
        paletteEligible: true,
      };
    case 'document':
      return {
        mediaType,
        primaryRole: 'card-thumbnail',
        primaryJobKind: 'generate_thumbnail',
        primaryArtifactKind: 'thumbnail',
        sourceMode: 'direct',
        paletteEligible: true,
      };
    case 'text':
      return {
        mediaType,
        primaryRole: null,
        primaryJobKind: null,
        primaryArtifactKind: null,
        sourceMode: 'direct',
        paletteEligible: false,
      };
    case 'other':
      return {
        mediaType,
        primaryRole: null,
        primaryJobKind: null,
        primaryArtifactKind: null,
        sourceMode: 'unsupported',
        paletteEligible: false,
      };
  }
}

/** A playback proxy is never an automatic import/open derivative. */
export function shouldGeneratePlaybackProxy(
  mediaType: ArtifactMediaType,
  explicitRequest: boolean,
): boolean {
  return (mediaType === 'video' || mediaType === 'audio') && explicitRequest;
}

/**
 * Stable, delimiter-safe artifact identity. Length-prefixing prevents an ID or
 * settings value from colliding with a neighbouring field; generator changes
 * and source revision changes therefore address a new artifact by construction.
 */
export function artifactKey(input: ArtifactKeyInput): string {
  const parts = [
    input.assetId,
    input.revisionId,
    input.role,
    input.generatorId,
    input.generatorVersion,
    input.settingsHash,
  ];
  return parts.map((part) => `${part.length}:${part}`).join('|');
}

/**
 * Pure admission gate used both before durable insertion and again at claim.
 * The second check is intentional: an asset can be ignored, deleted, or
 * re-revised between enqueue and decoder claim.
 */
export function admitArtifactJob(input: ArtifactAdmissionInput): ArtifactAdmissionDecision {
  const role = artifactRoleForJob(input.jobKind, input.mediaType);
  const artifactKind = artifactKindForJob(input.jobKind, input.mediaType);
  const key = role
    ? artifactKey({
      assetId: input.assetId,
      revisionId: input.revisionId,
      role,
      generatorId: input.generatorId ?? input.jobKind,
      generatorVersion: input.generatorVersion ?? 'policy-v1',
      settingsHash: input.settingsHash ?? '-',
    })
    : null;
  const decision = (reason: ArtifactAdmissionReason, admitted: boolean): ArtifactAdmissionDecision => ({
    admitted,
    reason,
    role,
    artifactKind,
    key,
  });

  if (!role || !artifactKind) return decision('unsupported-media', false);
  if (input.deleted) return decision('deleted', false);
  if (input.ignored) return decision('ignored', false);
  if (input.availability !== 'available') return decision('unavailable', false);
  if (!input.currentRevisionId) return decision('missing-revision', false);
  if (input.currentRevisionId !== input.revisionId) return decision('stale-revision', false);
  if (input.sourceDirect && input.jobKind === 'generate_thumbnail' && input.mediaType === 'image') {
    return decision('source-direct', false);
  }
  if (PROXY_JOB_KINDS.has(input.jobKind) && !shouldGeneratePlaybackProxy(input.mediaType, input.explicitRequest === true)) {
    return decision('source-direct', false);
  }
  if (input.activeJob) return decision('single-flight', false);
  if (input.readyArtifact) return decision('already-ready', false);
  if (input.failedArtifact && !input.retryFailed) return decision('terminal-failed', false);
  return decision('admitted', true);
}
