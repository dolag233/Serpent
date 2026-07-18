import { expect, test } from "vitest";

import { resolveRovingTargetIndex } from "../../src/renderer/roving-list-keyboard";

test("resolveRovingTargetIndex wraps Arrow keys and jumps Home/End", () => {
  expect(resolveRovingTargetIndex("ArrowDown", -1, 3)).toBe(0);
  expect(resolveRovingTargetIndex("ArrowDown", 0, 3)).toBe(1);
  expect(resolveRovingTargetIndex("ArrowDown", 2, 3)).toBe(0);
  expect(resolveRovingTargetIndex("ArrowUp", -1, 3)).toBe(2);
  expect(resolveRovingTargetIndex("ArrowUp", 0, 3)).toBe(2);
  expect(resolveRovingTargetIndex("ArrowUp", 2, 3)).toBe(1);
  expect(resolveRovingTargetIndex("Home", 2, 3)).toBe(0);
  expect(resolveRovingTargetIndex("End", 0, 3)).toBe(2);
  expect(resolveRovingTargetIndex("ArrowDown", 0, 0)).toBe(-1);
});
