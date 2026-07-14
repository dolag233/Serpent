export type DirectPlayContainer = 'mp4' | 'mov' | 'webm' | 'avi' | 'wmv' | 'unknown';

export interface DirectPlayMediaDescriptor {
  container: DirectPlayContainer;
  /** RFC 6838 media type without codec parameters, for example video/mp4. */
  mimeType: string | null;
  /** RFC 6381 codec identifiers, for example avc1.640028 and mp4a.40.2. */
  codecs: readonly string[];
}

export interface DirectPlayRuntime {
  platform: string;
  arch: string;
}

export interface DirectLoadProbeInput {
  cacheKey: string;
  canPlayTypeQuery: string;
  media: DirectPlayMediaDescriptor;
  runtime: DirectPlayRuntime;
  sourceUrl?: string;
}

export type DirectLoadProbe = (input: DirectLoadProbeInput) => Promise<boolean>;

export interface DirectPlayCapabilityDependencies {
  runtime: DirectPlayRuntime;
  canPlayType(query: string): '' | 'maybe' | 'probably';
  probeDirectLoad: DirectLoadProbe;
  /** May be shared by multiple service instances in the same Renderer lifetime. */
  cache?: DirectPlayCapabilityCache;
}

export type DirectPlayCapabilityCache = Map<string, boolean | Promise<boolean>>;

export interface DirectPlayDecision {
  mode: 'direct' | 'proxy';
  reason:
    | 'container_requires_proxy'
    | 'media_capability_unknown'
    | 'can_play_type_rejected'
    | 'real_load_supported'
    | 'real_load_rejected';
  cacheKey?: string;
  canPlayTypeQuery?: string;
}

export interface ProxyFallbackDecision {
  mode: 'proxy';
  reason: 'direct_playback_failed';
  /** True only for the first failure reported for this asset revision key. */
  shouldRequestProxy: boolean;
}

const DIRECT_PLAY_CANDIDATES = new Set<DirectPlayContainer>(['mp4', 'mov', 'webm']);

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeMedia(media: DirectPlayMediaDescriptor): DirectPlayMediaDescriptor {
  return {
    container: media.container,
    mimeType: media.mimeType ? normalized(media.mimeType) : null,
    codecs: media.codecs.map(normalized).filter(Boolean).sort(),
  };
}

function canPlayTypeQuery(media: DirectPlayMediaDescriptor): string | null {
  if (!media.mimeType || media.codecs.length === 0) return null;
  return `${media.mimeType}; codecs="${media.codecs.join(', ')}"`;
}

function capabilityCacheKey(runtime: DirectPlayRuntime, media: DirectPlayMediaDescriptor): string {
  return [
    normalized(runtime.platform),
    normalized(runtime.arch),
    media.container,
    media.mimeType,
    media.codecs.join(','),
  ].join('|');
}

/**
 * Renderer-side direct-play policy and capability cache.
 *
 * The caller supplies browser-specific canPlayType and real-load probes, so this
 * module remains deterministic in tests and does not create media elements by
 * itself. A future IPC integration can pass an asset's opaque source URL only to
 * the injected probe without exposing it to the capability policy.
 */
export class DirectPlayCapabilityService {
  private readonly cache: DirectPlayCapabilityCache;
  private readonly fallbackClaims = new Set<string>();

  constructor(private readonly dependencies: DirectPlayCapabilityDependencies) {
    this.cache = dependencies.cache ?? new Map();
  }

  async decide(input: DirectPlayMediaDescriptor, sourceUrl?: string): Promise<DirectPlayDecision> {
    const media = normalizeMedia(input);
    if (!DIRECT_PLAY_CANDIDATES.has(media.container)) {
      return { mode: 'proxy', reason: 'container_requires_proxy' };
    }

    const query = canPlayTypeQuery(media);
    if (!query) return { mode: 'proxy', reason: 'media_capability_unknown' };

    const cacheKey = capabilityCacheKey(this.dependencies.runtime, media);
    if (this.dependencies.canPlayType(query) === '') {
      this.cache.set(cacheKey, false);
      return {
        mode: 'proxy',
        reason: 'can_play_type_rejected',
        cacheKey,
        canPlayTypeQuery: query,
      };
    }

    let cached = this.cache.get(cacheKey);
    if (cached === undefined) {
      cached = this.dependencies.probeDirectLoad({
        cacheKey,
        canPlayTypeQuery: query,
        media,
        runtime: this.dependencies.runtime,
        sourceUrl,
      }).then(
        (supported) => {
          if (supported) this.cache.set(cacheKey, true);
          else this.cache.delete(cacheKey);
          return supported;
        },
        () => {
          this.cache.delete(cacheKey);
          return false;
        },
      );
      // Cache the in-flight probe so concurrent preview requests do not create
      // duplicate media elements or network reads.
      this.cache.set(cacheKey, cached);
    }

    const supported = await cached;
    return {
      mode: supported ? 'direct' : 'proxy',
      reason: supported ? 'real_load_supported' : 'real_load_rejected',
      cacheKey,
      canPlayTypeQuery: query,
    };
  }

  /**
   * Claim the one allowed direct-to-proxy fallback for an asset revision.
   * Use a stable opaque key such as `${assetId}:${revisionId}`. The proxy request
   * is issued only when shouldRequestProxy is true.
   */
  claimProxyFallback(playbackKey: string): ProxyFallbackDecision {
    const normalizedKey = playbackKey.trim();
    if (!normalizedKey) throw new Error('playbackKey must not be empty.');
    const shouldRequestProxy = !this.fallbackClaims.has(normalizedKey);
    this.fallbackClaims.add(normalizedKey);
    return { mode: 'proxy', reason: 'direct_playback_failed', shouldRequestProxy };
  }

  /** Explicitly release state after the asset revision is no longer addressable. */
  forgetPlayback(playbackKey: string): void {
    this.fallbackClaims.delete(playbackKey.trim());
  }
}
