import { describe, expect, it } from "vitest";

import {
  audioGridThumbnailNeedsRebuild,
  AUDIO_FORCED_WAVEFORM_GENERATOR_MARK,
  AUDIO_WAVEFORM_COVER_GENERATOR_TAG,
} from "../../src/shared/audio-media";
import {
  AUDIO_PREVIEW_PREFERENCES_KEY,
  loadAudioPreviewPreferences,
  saveAudioPreviewPreferences,
  type AudioPreviewPreferencesStorage,
} from "../../src/renderer/audio-preview-preferences";

function memoryStorage(): AudioPreviewPreferencesStorage & { raw: Map<string, string> } {
  const raw = new Map<string, string>();
  return {
    raw,
    getItem: (key) => raw.get(key) ?? null,
    setItem: (key, value) => {
      raw.set(key, value);
    },
  };
}

describe("audio preview preference", () => {
  it("defaults to preferring cover art", () => {
    expect(loadAudioPreviewPreferences(memoryStorage()).preferCover).toBe(true);
  });

  it("round-trips the checkbox", () => {
    const storage = memoryStorage();
    saveAudioPreviewPreferences({ version: 1, preferCover: false }, storage);
    expect(loadAudioPreviewPreferences(storage)).toEqual({
      version: 1,
      preferCover: false,
    });
    expect(storage.raw.get(AUDIO_PREVIEW_PREFERENCES_KEY)).toContain("false");
  });

  it("rebuilds only thumbnails that would change", () => {
    const cover = {
      mimeType: "image/jpeg",
      width: 32,
      height: 24,
      generatorVersion: `ffmpeg@test+${AUDIO_WAVEFORM_COVER_GENERATOR_TAG}`,
    };
    const waveform = {
      mimeType: "image/png",
      width: 640,
      height: 480,
      generatorVersion: `ffmpeg@test+${AUDIO_WAVEFORM_COVER_GENERATOR_TAG}`,
    };
    const forced = {
      ...waveform,
      generatorVersion: `${waveform.generatorVersion}+${AUDIO_FORCED_WAVEFORM_GENERATOR_MARK}`,
    };
    expect(audioGridThumbnailNeedsRebuild({ preferCover: false, ...cover })).toBe(true);
    expect(audioGridThumbnailNeedsRebuild({ preferCover: false, ...waveform })).toBe(false);
    expect(audioGridThumbnailNeedsRebuild({ preferCover: false, ...forced })).toBe(false);
    expect(audioGridThumbnailNeedsRebuild({ preferCover: true, ...cover })).toBe(false);
    expect(audioGridThumbnailNeedsRebuild({ preferCover: true, ...waveform })).toBe(false);
    expect(audioGridThumbnailNeedsRebuild({ preferCover: true, ...forced })).toBe(true);
  });
});
