import { describe, expect, it } from "vitest";
import {
  workspaceTabOutlineFillPath,
  workspaceTabOutlinePath,
} from "../../src/renderer/workspace-tab-outline-path";

describe("workspaceTabOutlinePath", () => {
  it("emits an open path with concave scoop arcs and top radii", () => {
    const d = workspaceTabOutlinePath(120, 40, 18, 14);
    expect(d.startsWith("M ")).toBe(true);
    expect(d.includes("Z")).toBe(false);
    expect(d).toContain("M -18 40");
    expect(d).toContain("A 18 18 0 0 0 0 22");
    expect(d).toContain("A 14 14 0 0 1 14 0");
    expect(d).toContain("A 14 14 0 0 1 120 14");
    expect(d).toContain("A 18 18 0 0 0 138 40");
  });

  it("clamps radius when the tab is narrow", () => {
    const d = workspaceTabOutlinePath(20, 40, 18, 14);
    expect(d).toContain("A 10 10 0 0 1 10 0");
  });

  it("uses concave scoop centers (not bulbous alternate centers)", () => {
    const d = workspaceTabOutlinePath(100, 36, 18, 12);
    expect(d).toMatch(/M -18 36 A 18 18 0 0 0 0 18/);
    expect(d).toMatch(/L 100 18 A 18 18 0 0 0 118 36/);
  });

  it("insets path so centered 1px stroke outer edge matches CSS silhouette", () => {
    const d = workspaceTabOutlinePath(120, 40, 18, 14, 0.5);
    expect(d).toContain("M -17.5 40");
    expect(d).toContain("A 17.5 17.5 0 0 0 0.5 22.5");
    expect(d).toContain("A 13.5 13.5 0 0 1 13.5 0.5");
    expect(d).toContain("A 13.5 13.5 0 0 1 119.5 13.5");
    expect(d).toContain("A 17.5 17.5 0 0 0 137.5 40");
    expect(d.includes("Z")).toBe(false);
  });

  it("keeps the same stroke inset and tip alignment for square tabs", () => {
    const d = workspaceTabOutlinePath(120, 40, 18, 0, 0.5);
    expect(d).toContain("M -17.5 40");
    expect(d).toContain("L 0.5 0.5 L 119.5 0.5");
    expect(d).toContain("A 17.5 17.5 0 0 0 137.5 40");
    const fill = workspaceTabOutlineFillPath(120, 40, 18, 0, 0.5, 1);
    expect(fill).toContain("M -17.5 41");
    expect(fill).toContain("L 0.5 0.5 L 119.5 0.5");
  });
});

describe("workspaceTabOutlineFillPath", () => {
  it("closes below tips so fill covers the panel border row", () => {
    const d = workspaceTabOutlineFillPath(120, 40, 18, 14, 0.5, 1);
    expect(d.startsWith("M -17.5 41")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    expect(d).toContain("L -17.5 40");
    expect(d).toContain("A 17.5 17.5 0 0 0 137.5 40");
    expect(d).toContain("L 137.5 41");
  });
});
