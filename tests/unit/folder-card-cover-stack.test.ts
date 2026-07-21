import { describe, expect, it } from "vitest";

import {
  FOLDER_COVER_STACK_MAX,
  folderCoverStackSlots,
  folderCoverStackStyle,
} from "../../src/renderer/folder-card-cover-stack";

describe("folderCoverStackSlots (Serpent-7ms)", () => {
  it("returns no slots for empty covers", () => {
    expect(folderCoverStackSlots(0)).toEqual([]);
    expect(folderCoverStackSlots(-1)).toEqual([]);
  });

  it("fans 1–3 photos with increasing z-index toward the front", () => {
    expect(folderCoverStackSlots(1)).toHaveLength(1);
    expect(folderCoverStackSlots(2)).toHaveLength(2);
    expect(folderCoverStackSlots(3)).toHaveLength(3);
    expect(folderCoverStackSlots(FOLDER_COVER_STACK_MAX + 5)).toHaveLength(
      FOLDER_COVER_STACK_MAX,
    );

    const three = folderCoverStackSlots(3);
    expect(three.map((s) => s.zIndex)).toEqual([1, 2, 3]);
    expect(three[0]!.rotateDeg).toBeLessThan(0);
    expect(three[2]!.rotateDeg).toBeGreaterThan(0);
  });

  it("emits transform styles for stacked photos", () => {
    const [slot] = folderCoverStackSlots(1);
    expect(slot).toBeDefined();
    const style = folderCoverStackStyle(slot!);
    expect(style.transform).toContain("rotate(");
    expect(style.transform).toContain("translate(");
    expect(style.zIndex).toBe(slot!.zIndex);
  });
});
