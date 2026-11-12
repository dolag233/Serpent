import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const css = readFileSync(
  resolve(__dirname, "../../src/renderer/workspace-tabs.css"),
  "utf8",
);

describe("workspace tab chrome", () => {
  it("uses a single SVG path for active-tab fill (no CSS scoop feet)", () => {
    expect(css).toContain(".workspace-tab-outline-path");
    expect(css).toContain("fill: var(--island-tab-fill, var(--canvas))");
    expect(css).toContain(".workspace-tab.is-active::before");
    expect(css).toContain("content: none");
    // No radial scoop fills competing with the SVG silhouette.
    expect(css).not.toMatch(
      /\.workspace-tab\.is-active::before\s*\{[^}]*radial-gradient/s,
    );
  });

  it("does not paint a hairline between adjacent tabs", () => {
    expect(css).not.toContain(".workspace-tab:not(.is-active)::after");
  });

  it("keeps the add button outside the scrolling viewport", () => {
    expect(css).toContain(
      "margin-inline-start: var(--ui-space-1)",
    );
    expect(css).not.toContain("margin-inline-start: calc(-1 * var(--workspace-tab-scoop)");
  });

  it("measures the tab width budget in the tab's own font size", () => {
    expect(css).toContain("--workspace-tab-chrome: 82px");
    // Shortest a tab may read: a two-character title plus the chrome.
    expect(css).toContain(
      "--workspace-tab-min-width: calc(2em + var(--workspace-tab-chrome))",
    );
    // Longest a tab may read: an eight-character title plus the chrome.
    expect(css).toContain(
      "--workspace-tab-width-budget: calc(8em + var(--workspace-tab-chrome))",
    );
    expect(css).toContain("--workspace-tab-font-size: calc(12.5px * var(--ui-font-scale))");
    expect(css).toContain("min-width: var(--workspace-tab-min-width)");
    expect(css).toContain("font-size: var(--workspace-tab-font-size)");
  });
});
