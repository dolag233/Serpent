import { describe, expect, it } from "vitest";

import {
  clampViewerVolume,
  matchViewerVolumeKey,
  stepViewerVolumeLevel,
  volumeAfterWheelSteps,
  VIEWER_VOLUME_STEP,
} from "../../src/renderer/viewer-volume-preferences";

describe("viewer volume preferences (Serpent-8w6x)", () => {
  it("steps volume up and down in fixed increments", () => {
    expect(stepViewerVolumeLevel(0.5, "up")).toBeCloseTo(0.5 + VIEWER_VOLUME_STEP);
    expect(stepViewerVolumeLevel(0.02, "down")).toBe(0);
    expect(stepViewerVolumeLevel(1, "up")).toBe(1);
  });

  it("clamps volume into 0..1", () => {
    expect(clampViewerVolume(1.5)).toBe(1);
    expect(clampViewerVolume(-0.2)).toBe(0);
  });

  it("maps ArrowUp/ArrowDown when not typing", () => {
    const base = {
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      target: { tagName: "DIV" },
    };
    expect(matchViewerVolumeKey({ ...base, key: "ArrowUp" })).toBe("up");
    expect(matchViewerVolumeKey({ ...base, key: "ArrowDown" })).toBe("down");
    expect(
      matchViewerVolumeKey({
        ...base,
        key: "ArrowUp",
        target: { tagName: "TEXTAREA" },
      }),
    ).toBeNull();
  });

  it("raises volume when the wheel steps upward", () => {
    expect(volumeAfterWheelSteps(0.5, -1)).toBeCloseTo(0.5 + VIEWER_VOLUME_STEP);
    expect(volumeAfterWheelSteps(0.5, 1)).toBeCloseTo(0.5 - VIEWER_VOLUME_STEP);
    expect(volumeAfterWheelSteps(0, 2)).toBe(0);
  });

  it("ignores system key-repeat events", () => {
    expect(matchViewerVolumeKey({
      key: "ArrowUp",
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      repeat: true,
      target: { tagName: "DIV" },
    })).toBeNull();
  });
});
