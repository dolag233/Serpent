import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("zoomable image decode failure fallback", () => {
  it("uses the themed broken-file surface instead of native broken-image UI", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/renderer/zoomable-preview-image.tsx"),
      "utf8",
    );
    const styles = readFileSync(
      resolve(process.cwd(), "src/renderer/styles.css"),
      "utf8",
    );

    expect(source).toContain('className="preview-image-error"');
    expect(source).toContain('<Icon name="broken-file" size={42} />');
    expect(source).toContain("onError={handleImageError}");
    // The viewer must keep one full-source decoder on the critical path. A
    // second fetch + ImageBitmap middle layer doubled reads and decode memory
    // for every placeholder-to-original upgrade.
    expect(source).not.toContain("createImageBitmap");
    expect(source).not.toContain("fetch(src");
    expect(source).not.toContain("preview-image-middle");
    expect(source).toContain('decoding="async"');
    expect(styles).toMatch(
      /\.preview-image-error\s*\{[\s\S]*?color:\s*var\(--tertiary\);/,
    );
  });
});
