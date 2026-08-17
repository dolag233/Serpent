import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveAppIconCandidates } from "../../src/main/app-icon-paths";

describe("resolveAppIconCandidates", () => {
  it("prefers the padded Dock PNG for macOS in development", () => {
    expect(
      resolveAppIconCandidates({
        cwd: "/workspace/Serpent",
        isPackaged: false,
        platform: "darwin",
        resourcesPath: "/unused/resources",
      }),
    ).toEqual([
      path.join("/workspace/Serpent", "assets/icons/app-dock.png"),
      path.join("/workspace/Serpent", "assets/icons/app.png"),
    ]);
  });

  it("prefers the packaged padded Dock PNG on macOS", () => {
    expect(
      resolveAppIconCandidates({
        cwd: "/unused/project",
        isPackaged: true,
        platform: "darwin",
        resourcesPath: "/Applications/Serpent.app/Contents/Resources",
      }),
    ).toEqual([
      path.join("/Applications/Serpent.app/Contents/Resources", "app-dock.png"),
      path.join("/Applications/Serpent.app/Contents/Resources", "app.png"),
    ]);
  });

  it("keeps Windows PNG/ICO fallback ordering", () => {
    expect(
      resolveAppIconCandidates({
        cwd: "/workspace/Serpent",
        isPackaged: true,
        platform: "win32",
        resourcesPath: "C:\\Serpent\\resources",
      }),
    ).toEqual([
      path.join("C:\\Serpent\\resources", "app.png"),
      path.join("C:\\Serpent\\resources", "app.ico"),
    ]);
  });
});
