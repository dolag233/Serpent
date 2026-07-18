import { expect, test } from "vitest";

import {
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
