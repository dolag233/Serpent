import { describe, expect, it } from 'vitest';

import {
  admitArtifactJob,
  artifactKey,
  artifactIdentityForPersistedRow,
  artifactRoleForKind,
  artifactKindForJob,
  artifactPolicyForMediaType,
  artifactRoleForJob,
  shouldGeneratePlaybackProxy,
} from '../../src/worker/artifact-policy';

describe('artifact policy', () => {
  it('maps product roles to the durable artifact kinds without mixing audio and video', () => {
    expect(artifactRoleForJob('generate_thumbnail', 'video')).toBe('video-poster');
    expect(artifactKindForJob('generate_thumbnail', 'video')).toBe('video_poster');
    expect(artifactRoleForJob('generate_audio_proxy', 'audio')).toBe('playback-proxy');
    expect(artifactKindForJob('generate_audio_proxy', 'audio')).toBe('audio_proxy');
    expect(artifactRoleForJob('generate_audio_proxy', 'video')).toBeNull();
    expect(artifactRoleForJob('extract_metadata', 'image')).toBe('technical-metadata');
    expect(artifactKindForJob('extract_metadata', 'image')).toBe('extracted_metadata');
    expect(artifactRoleForJob('extract_palette', 'audio')).toBeNull();
  });

  it('keeps source-direct playback and palette eligibility separate', () => {
    expect(artifactPolicyForMediaType('video')).toMatchObject({
      sourceMode: 'direct-with-fallback',
      paletteEligible: true,
    });
    expect(artifactPolicyForMediaType('audio')).toMatchObject({
      sourceMode: 'direct-with-fallback',
      paletteEligible: false,
    });
    expect(shouldGeneratePlaybackProxy('video', false)).toBe(false);
    expect(shouldGeneratePlaybackProxy('video', true)).toBe(true);
    expect(shouldGeneratePlaybackProxy('audio', true)).toBe(true);
    expect(shouldGeneratePlaybackProxy('image', true)).toBe(false);
  });

  it('includes every identity component and remains delimiter-safe', () => {
    const base = {
      assetId: 'asset|1',
      revisionId: 'revision\u00001',
      role: 'card-thumbnail' as const,
      generatorId: 'sharp',
      generatorVersion: '1',
      settingsHash: 'size=512',
    };
    expect(artifactKey(base)).toContain('asset|1');
    expect(artifactKey(base)).not.toBe(artifactKey({ ...base, generatorVersion: '2' }));
    expect(artifactKey(base)).not.toBe(artifactKey({ ...base, settingsHash: 'size=1024' }));
    expect(artifactKey(base)).not.toBe(artifactKey({ ...base, revisionId: 'revision-2' }));
  });

  it('rejects stale, ignored, unsupported and duplicate work before durable insertion', () => {
    const base = {
      assetId: 'asset-1',
      revisionId: 'revision-2',
      currentRevisionId: 'revision-2',
      mediaType: 'video' as const,
      jobKind: 'generate_thumbnail' as const,
      availability: 'available' as const,
    };
    expect(admitArtifactJob(base)).toMatchObject({ admitted: true, reason: 'admitted' });
    expect(admitArtifactJob({ ...base, currentRevisionId: 'revision-1' })).toMatchObject({ admitted: false, reason: 'stale-revision' });
    expect(admitArtifactJob({ ...base, ignored: true })).toMatchObject({ admitted: false, reason: 'ignored' });
    expect(admitArtifactJob({ ...base, mediaType: 'text' })).toMatchObject({ admitted: false, reason: 'unsupported-media' });
    expect(admitArtifactJob({ ...base, activeJob: true })).toMatchObject({ admitted: false, reason: 'single-flight' });
    expect(admitArtifactJob({ ...base, readyArtifact: true })).toMatchObject({ admitted: false, reason: 'already-ready' });
    expect(admitArtifactJob({ ...base, failedArtifact: true })).toMatchObject({ admitted: false, reason: 'terminal-failed' });
    expect(admitArtifactJob({ ...base, failedArtifact: true, retryFailed: true })).toMatchObject({ admitted: true, reason: 'admitted' });
  });

  it('requires an explicit source-decode fallback before queuing a playback proxy', () => {
    const base = {
      assetId: 'asset-1',
      revisionId: 'revision-1',
      currentRevisionId: 'revision-1',
      mediaType: 'video' as const,
      jobKind: 'generate_webm_proxy' as const,
      availability: 'available' as const,
    };
    expect(admitArtifactJob(base)).toMatchObject({ admitted: false, reason: 'source-direct' });
    expect(admitArtifactJob({ ...base, explicitRequest: true })).toMatchObject({ admitted: true, reason: 'admitted' });
  });

  it('does not admit a derived image thumbnail when the source is bounded', () => {
    expect(admitArtifactJob({
      assetId: 'asset-1',
      revisionId: 'revision-1',
      currentRevisionId: 'revision-1',
      mediaType: 'image',
      jobKind: 'generate_thumbnail',
      availability: 'available',
      sourceDirect: true,
    })).toMatchObject({ admitted: false, reason: 'source-direct' });
  });

  it('derives one durable identity for legacy generator declarations', () => {
    expect(artifactRoleForKind('viewer_image')).toBe('viewer-image');
    expect(artifactRoleForKind('model_glb')).toBe('model-viewer');
    expect(artifactIdentityForPersistedRow({
      assetId: 'asset-1',
      revisionId: 'revision-1',
      kind: 'thumbnail',
      generatorVersion: 'oiio@3.1;colorspace=srgb;subimage=2',
    })).toMatchObject({
      role: 'card-thumbnail',
      generatorId: 'oiio@3.1',
      settingsHash: 'colorspace=srgb;subimage=2',
      key: expect.stringContaining('card-thumbnail'),
    });
    expect(artifactIdentityForPersistedRow({
      assetId: 'asset-1',
      revisionId: 'revision-1',
      kind: 'thumbnail',
      generatorVersion: 'sharp@1',
    })).toMatchObject({
      generatorId: 'sharp@1',
      settingsHash: 'default',
    });
  });
});
