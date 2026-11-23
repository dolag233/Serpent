import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("asset-card media fallback layout", () => {
  it("centers a fallback icon inside the preview frame", () => {
    const styles = readFileSync(
      resolve(process.cwd(), "src/renderer/styles.css"),
      "utf8",
    );

    expect(styles).toMatch(
      /\.asset-card-media\s*\{[\s\S]*?display:\s*grid;[\s\S]*?place-items:\s*center;/,
    );
  });

  it("uses a thin pill progress bar for hover scrub", () => {
    const styles = readFileSync(
      resolve(process.cwd(), "src/renderer/styles.css"),
      "utf8",
    );
    expect(styles).toMatch(
      /\.asset-card-hover-progress\s*\{[\s\S]*?height:\s*3px;[\s\S]*?background:\s*rgb\(0 0 0 \/ 22%\);/,
    );
    expect(styles).toMatch(
      /\.asset-card-hover-progress-fill\s*\{[\s\S]*?background:\s*var\(--accent\);/,
    );
    expect(styles).not.toMatch(/\.asset-card-hover-playhead\s*\{/);
  });

  it("uses the pointing-hand cursor on browse cards", () => {
    const styles = readFileSync(
      resolve(process.cwd(), "src/renderer/styles.css"),
      "utf8",
    );
    expect(styles).toMatch(/\.asset-card\s*\{[\s\S]*?cursor:\s*pointer;/);
    expect(styles).toMatch(
      /\.asset-card\[draggable="true"\]\s*\{[\s\S]*?cursor:\s*pointer;/,
    );
  });
});
