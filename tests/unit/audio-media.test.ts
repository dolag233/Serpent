import { expect, test } from "vitest";

import {
  AUDIO_EXTENSION_NAMES,
  AUDIO_WAVEFORM_COVER_BACKGROUND,
  AUDIO_WAVEFORM_COVER_GENERATOR_TAG,
  AUDIO_WAVEFORM_COVER_HEIGHT,
  AUDIO_WAVEFORM_COVER_WIDTH,
  AUDIO_WAVEFORM_VIEWER_HEIGHT,
  AUDIO_WAVEFORM_VIEWER_WIDTH,
  LIGHT_CANVAS_BACKGROUND,
  audioMimeForExtension,
  audioWaveformCoverAspectRatio,
  contrastsWithLightCanvas,
  isAudioFileName,
  isLightFriendlyWaveformCoverBackground,
  isNearFourByThreeAspect,
  rgbChannelDistance,
} from "../../src/shared/audio-media";

test("isAudioFileName recognizes common audio extensions", () => {
  expect(isAudioFileName("clip.WAV")).toBe(true);
  expect(isAudioFileName("song.mp3")).toBe(true);
  expect(isAudioFileName("stem.flac")).toBe(true);
  expect(isAudioFileName("photo.png")).toBe(false);
  expect(isAudioFileName("clip.mp4")).toBe(false);
});

test("audioMimeForExtension maps Chromium-playable MIME types", () => {
  expect(audioMimeForExtension(".mp3")).toBe("audio/mpeg");
  expect(audioMimeForExtension(".wav")).toBe("audio/wav");
  expect(audioMimeForExtension(".m4a")).toBe("audio/mp4");
  expect(audioMimeForExtension(".txt")).toBeNull();
});

test("AUDIO_EXTENSION_NAMES lists enqueue tokens without dots", () => {
  expect(AUDIO_EXTENSION_NAMES).toContain("wav");
  expect(AUDIO_EXTENSION_NAMES).toContain("mp3");
  expect(AUDIO_EXTENSION_NAMES.every((name) => !name.includes("."))).toBe(true);
});

test("waveform cover geometry is approximately 4:3 (Serpent-dxk)", () => {
  expect(AUDIO_WAVEFORM_COVER_WIDTH).toBe(640);
  expect(AUDIO_WAVEFORM_COVER_HEIGHT).toBe(480);
  expect(audioWaveformCoverAspectRatio()).toBeCloseTo(4 / 3, 5);
  expect(
    isNearFourByThreeAspect(
      AUDIO_WAVEFORM_COVER_WIDTH,
      AUDIO_WAVEFORM_COVER_HEIGHT,
    ),
  ).toBe(true);
  expect(isNearFourByThreeAspect(640, 160)).toBe(false);
  expect(isNearFourByThreeAspect(160, 640)).toBe(false);
  expect(AUDIO_WAVEFORM_COVER_GENERATOR_TAG).toBe("waveform-cover6");
});

test("viewer waveform strip is wide (not 4:3 grid cover)", () => {
  expect(AUDIO_WAVEFORM_VIEWER_WIDTH).toBe(1280);
  expect(AUDIO_WAVEFORM_VIEWER_HEIGHT).toBe(220);
  expect(
    AUDIO_WAVEFORM_VIEWER_WIDTH / AUDIO_WAVEFORM_VIEWER_HEIGHT,
  ).toBeGreaterThan(4);
  expect(
    isNearFourByThreeAspect(
      AUDIO_WAVEFORM_VIEWER_WIDTH,
      AUDIO_WAVEFORM_VIEWER_HEIGHT,
    ),
  ).toBe(false);
});

test("waveform cover stage is charcoal grey-black (Serpent-vlx)", () => {
  expect(
    isLightFriendlyWaveformCoverBackground(AUDIO_WAVEFORM_COVER_BACKGROUND),
  ).toBe(true);
  expect(
    isLightFriendlyWaveformCoverBackground({ r: 0x1a, g: 0x20, b: 0x30 }),
  ).toBe(true);
  expect(
    isLightFriendlyWaveformCoverBackground({ r: 0xff, g: 0xff, b: 0xff }),
  ).toBe(false);
  expect(
    isLightFriendlyWaveformCoverBackground({ r: 0, g: 0, b: 0 }),
  ).toBe(false);
});

test("waveform cover stage contrasts with light canvas (Serpent-muc)", () => {
  expect(LIGHT_CANVAS_BACKGROUND).toEqual({ r: 0xe8, g: 0xea, b: 0xe7 });
  expect(contrastsWithLightCanvas(AUDIO_WAVEFORM_COVER_BACKGROUND)).toBe(true);
  expect(contrastsWithLightCanvas(LIGHT_CANVAS_BACKGROUND)).toBe(false);
  expect(
    rgbChannelDistance(
      AUDIO_WAVEFORM_COVER_BACKGROUND,
      LIGHT_CANVAS_BACKGROUND,
    ),
  ).toBeGreaterThanOrEqual(24);
  // Near-canvas gray must fail the contrast gate.
  expect(
    contrastsWithLightCanvas({ r: 0xe8, g: 0xea, b: 0xe7 }),
  ).toBe(false);
});
