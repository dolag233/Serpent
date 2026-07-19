import { expect, test } from "vitest";

import {
  AUDIO_EXTENSION_NAMES,
  audioMimeForExtension,
  isAudioFileName,
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
