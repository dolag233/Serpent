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
});
