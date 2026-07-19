import { expect, test } from "vitest";

import {
  playheadLeftPercent,
  playheadRatioFromTime,
  seekRatioFromWaveformClientX,
  seekTimeFromWaveformRatio,
} from "../../src/renderer/audio-waveform-timeline";

test("playheadRatioFromTime maps time into 0..1", () => {
  expect(playheadRatioFromTime(0, 10)).toBe(0);
  expect(playheadRatioFromTime(5, 10)).toBe(0.5);
  expect(playheadRatioFromTime(10, 10)).toBe(1);
  expect(playheadRatioFromTime(12, 10)).toBe(1);
  expect(playheadRatioFromTime(3, 0)).toBe(0);
});

test("playheadLeftPercent converts ratio to CSS percent", () => {
  expect(playheadLeftPercent(0)).toBe(0);
  expect(playheadLeftPercent(0.25)).toBe(25);
  expect(playheadLeftPercent(1)).toBe(100);
  expect(playheadLeftPercent(1.5)).toBe(100);
  expect(playheadLeftPercent(Number.NaN)).toBe(0);
});

test("waveform seek helpers clamp pointer geometry to duration", () => {
  expect(
    seekRatioFromWaveformClientX(150, { left: 100, width: 200 }),
  ).toBe(0.25);
  expect(seekTimeFromWaveformRatio(0.25, 40)).toBe(10);
  expect(seekTimeFromWaveformRatio(-1, 40)).toBe(0);
  expect(seekTimeFromWaveformRatio(2, 40)).toBe(40);
});
