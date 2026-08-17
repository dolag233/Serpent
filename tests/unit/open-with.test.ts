import { describe, expect, it, vi } from "vitest";

import {
  detectOpenWithPlatform,
  openPathWithOtherApplication,
  type OpenWithDeps,
} from "../../src/main/open-with";

function makeDeps(
  overrides: Partial<OpenWithDeps> & Pick<OpenWithDeps, "platform">,
): OpenWithDeps {
  return {
    locale: "zh-CN",
    getParentWindow: () => null,
    showOpenDialog: vi.fn(async () => ({
      canceled: true,
      filePaths: [],
    })),
    execFile: vi.fn(async () => ({ stdout: "", stderr: "" })),
    ...overrides,
  };
}

describe("open-with platform helper (Serpent-w29)", () => {
  it("detects darwin / win32 / other", () => {
    expect(detectOpenWithPlatform("darwin")).toBe("darwin");
    expect(detectOpenWithPlatform("win32")).toBe("win32");
    expect(detectOpenWithPlatform("linux")).toBe("other");
  });

  it("macOS: cancelled picker is a quiet no-op", async () => {
    const showOpenDialog = vi.fn(async () => ({
      canceled: true,
      filePaths: [] as string[],
    }));
    const execFile = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const outcome = await openPathWithOtherApplication(
      "/tmp/sample.png",
      makeDeps({ platform: "darwin", showOpenDialog, execFile }),
    );
    expect(outcome).toBe("cancelled");
    expect(execFile).not.toHaveBeenCalled();
  });

  it("macOS: picks an .app then runs open -a", async () => {
    const showOpenDialog = vi.fn(async () => ({
      canceled: false,
      filePaths: ["/Applications/Preview.app"],
    }));
    const execFile = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const outcome = await openPathWithOtherApplication(
      "/Library/Assets/a.png",
      makeDeps({ platform: "darwin", showOpenDialog, execFile }),
    );
    expect(outcome).toBe("opened");
    expect(showOpenDialog).toHaveBeenCalledOnce();
    const dialogCall = showOpenDialog.mock.calls[0] as
      | [unknown, { title?: string; filters?: Array<{ extensions: string[] }> }]
      | undefined;
    const options = dialogCall?.[1];
    expect(options?.title).toBe("选择应用");
    expect(options?.filters?.[0]?.extensions).toEqual(["app"]);
    expect(execFile).toHaveBeenCalledWith("open", [
      "-a",
      "/Applications/Preview.app",
      "/Library/Assets/a.png",
    ]);
  });

  it("Windows: invokes OpenAs_RunDLL with the absolute path", async () => {
    const execFile = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const outcome = await openPathWithOtherApplication(
      "C:\\Library\\Assets\\a.png",
      makeDeps({ platform: "win32", execFile }),
    );
    expect(outcome).toBe("opened");
    expect(execFile).toHaveBeenCalledWith("rundll32.exe", [
      "shell32.dll,OpenAs_RunDLL",
      "C:\\Library\\Assets\\a.png",
    ]);
  });

  it("unsupported platform fails without spawning", async () => {
    const execFile = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const outcome = await openPathWithOtherApplication(
      "/tmp/a.png",
      makeDeps({ platform: "other", execFile }),
    );
    expect(outcome).toBe("failed");
    expect(execFile).not.toHaveBeenCalled();
  });

  it("exec failure maps to failed", async () => {
    const execFile = vi.fn(async () => {
      throw new Error("spawn failed");
    });
    const outcome = await openPathWithOtherApplication(
      "C:\\a.png",
      makeDeps({ platform: "win32", execFile }),
    );
    expect(outcome).toBe("failed");
  });
});
