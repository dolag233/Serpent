import { describe, expect, it, vi } from "vitest";

import {
  buildCfHdrop,
  buildNsFilenamesPlist,
  detectFileClipboardPlatform,
  escapePlistString,
  parseCfHdrop,
  parseNsFilenamesPlist,
  readFilePathsFromClipboard,
  writeFilePathsToClipboard,
  type FileClipboardDeps,
} from "../../src/main/file-clipboard";

function makeDeps(
  overrides: Partial<FileClipboardDeps> & Pick<FileClipboardDeps, "platform">,
): FileClipboardDeps & {
  buffers: Map<string, Buffer>;
  text: string;
} {
  const buffers = new Map<string, Buffer>();
  let text = "";
  return {
    buffers,
    get text() {
      return text;
    },
    platform: overrides.platform,
    writeBuffer:
      overrides.writeBuffer ??
      ((format, buffer) => {
        buffers.set(format, Buffer.from(buffer));
      }),
    readBuffer:
      overrides.readBuffer ??
      ((format) => buffers.get(format) ?? Buffer.alloc(0)),
    hasFormat:
      overrides.hasFormat ?? ((format) => buffers.has(format)),
    clear:
      overrides.clear ??
      (() => {
        buffers.clear();
        text = "";
      }),
    writeText:
      overrides.writeText ??
      ((value) => {
        text = value;
      }),
  };
}

describe("file-clipboard (Serpent-vgp)", () => {
  it("detects darwin / win32 / other", () => {
    expect(detectFileClipboardPlatform("darwin")).toBe("darwin");
    expect(detectFileClipboardPlatform("win32")).toBe("win32");
    expect(detectFileClipboardPlatform("linux")).toBe("other");
  });

  it("escapes plist special characters", () => {
    expect(escapePlistString('a&b<c>"d')).toBe("a&amp;b&lt;c&gt;&quot;d");
  });

  it("round-trips NSFilenamesPboardType plist", () => {
    const paths = ["/Users/me/Library/Assets/Hero", "/tmp/a & b.png"];
    const parsed = parseNsFilenamesPlist(buildNsFilenamesPlist(paths));
    expect(parsed).toEqual(paths);
  });

  it("round-trips CF_HDROP buffers", () => {
    const paths = ["C:\\Library\\Assets\\Hero", "D:\\shots\\a.png"];
    expect(parseCfHdrop(buildCfHdrop(paths))).toEqual(paths);
  });

  it("macOS write uses NSFilenamesPboardType without clobbering text write", () => {
    const deps = makeDeps({ platform: "darwin" });
    expect(
      writeFilePathsToClipboard(["/Users/me/Assets/Folder"], deps),
    ).toBe(true);
    expect(deps.hasFormat("NSFilenamesPboardType")).toBe(true);
    expect(deps.hasFormat("public.file-url")).toBe(true);
    expect(deps.text).toBe("");
    expect(readFilePathsFromClipboard(deps)).toEqual([
      "/Users/me/Assets/Folder",
    ]);
  });

  it("Windows write uses CF_HDROP", () => {
    const deps = makeDeps({ platform: "win32" });
    const target = "C:\\Library\\Assets\\Folder";
    expect(writeFilePathsToClipboard([target], deps)).toBe(true);
    expect(deps.hasFormat("CF_HDROP")).toBe(true);
    expect(deps.hasFormat("FileNameW")).toBe(true);
    expect(readFilePathsFromClipboard(deps)).toEqual([target]);
  });

  it("rejects empty path lists", () => {
    const writeBuffer = vi.fn();
    const deps = makeDeps({ platform: "darwin", writeBuffer });
    expect(writeFilePathsToClipboard([], deps)).toBe(false);
    expect(writeBuffer).not.toHaveBeenCalled();
  });
});
