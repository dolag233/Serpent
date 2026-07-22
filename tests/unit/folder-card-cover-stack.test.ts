import { describe, expect, it } from "vitest";

import {
  FOLDER_COVER_STACK_MAX,
  folderCoverStackSlots,
  folderCoverStackStyle,
} from "../../src/renderer/folder-card-cover-stack";

describe("folderCoverStackSlots (Serpent-l67w)", () => {
  it("returns no slots for empty covers", () => {
    expect(folderCoverStackSlots(0)).toEqual([]);
    expect(folderCoverStackSlots(-1)).toEqual([]);
  });

  it("deck-stacks 1–3 photos without fan rotation", () => {
    expect(folderCoverStackSlots(1)).toHaveLength(1);
    expect(folderCoverStackSlots(2)).toHaveLength(2);
    expect(folderCoverStackSlots(3)).toHaveLength(3);
    expect(folderCoverStackSlots(FOLDER_COVER_STACK_MAX + 5)).toHaveLength(
      FOLDER_COVER_STACK_MAX,
    );

    const three = folderCoverStackSlots(3);
    expect(three.map((s) => s.zIndex)).toEqual([1, 2, 3]);
    for (const slot of three) {
      expect(slot.rotateDeg).toBe(0);
    }
    // Back layers peek up-left / down-left like Inspector multi-select.
    expect(three[0]!.translateXPct).toBeLessThan(three[1]!.translateXPct);
    expect(three[1]!.translateXPct).toBeLessThan(three[2]!.translateXPct);
    expect(three[2]!.translateXPct).toBe(0);
    expect(three[2]!.translateYPct).toBe(0);
  });

  it("emits transform styles for stacked photos", () => {
    const [slot] = folderCoverStackSlots(2);
    expect(slot).toBeDefined();
    const style = folderCoverStackStyle(slot!);
    expect(style.transform).toContain("translate(");
    expect(style.transform).not.toContain("rotate(");
    expect(style.zIndex).toBe(slot!.zIndex);
  });
});
