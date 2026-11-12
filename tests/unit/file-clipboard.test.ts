import { describe, expect, it, vi } from "vitest";

import {
  buildCfHdrop,
  buildNsFilenamesPlist,
  detectFileClipboardPlatform,
  escapePlistString,
  parseCfHdrop,
  parseNsFilenamesPlist,
  readFilePathsFromClipboard,
  readFileClipboard,
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
    ...overrides,
    platform: overrides.platform,
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

  it("Windows write uses CF_HDROP (native unavailable → Electron fallback)", () => {
    const deps = makeDeps({ platform: "win32", writeNativeWin32: () => false });
    const target = "C:\\Library\\Assets\\Folder";
    expect(writeFilePathsToClipboard([target], deps)).toBe(true);
    expect(deps.hasFormat("CF_HDROP")).toBe(true);
    expect(deps.hasFormat("FileNameW")).toBe(true);
    expect(readFilePathsFromClipboard(deps)).toEqual([target]);
  });

  it("Windows write prefers the native CF_HDROP writer", () => {
    const native = vi.fn(() => true);
    const deps = makeDeps({ platform: "win32", writeNativeWin32: native });
    const target = "C:\\Library\\Assets\\Folder";
    expect(writeFilePathsToClipboard([target], deps)).toBe(true);
    expect(native).toHaveBeenCalledWith([target], "copy");
    // Electron fallback formats are not written when the native path succeeds.
    expect(deps.hasFormat("CF_HDROP")).toBe(false);
    expect(deps.hasFormat("FileNameW")).toBe(false);
  });

  it("rejects empty path lists", () => {
    const writeBuffer = vi.fn();
    const deps = makeDeps({ platform: "darwin", writeBuffer });
    expect(writeFilePathsToClipboard([], deps)).toBe(false);
    expect(writeBuffer).not.toHaveBeenCalled();
  });
});

it('reads every native Explorer file before considering FileNameW, including move intent', () => {
  const deps = makeDeps({ platform: 'win32', readNativeWin32: () => ({ paths: ['C:\\a.png', 'C:\\b.png'], operation: 'cut', sequence: 42 }) });
  deps.buffers.set('FileNameW', Buffer.from('C:\\a.png\0', 'utf16le'));
  expect(readFilePathsFromClipboard(deps)).toEqual(['C:\\a.png', 'C:\\b.png']);
  expect(readFileClipboard(deps)).toEqual({ paths: ['C:\\a.png', 'C:\\b.png'], operation: 'cut', sequence: 42 });
});

it('writes Preferred DropEffect for cut and copy in the compatibility path', () => {
  const deps = makeDeps({ platform: 'win32' });
  expect(writeFilePathsToClipboard(['C:\\a.png', 'C:\\b.png'], deps, 'cut')).toBe(true);
  expect(readFileClipboard(deps).operation).toBe('cut');
  expect(readFileClipboard(deps).paths).toHaveLength(2);
  expect(writeFilePathsToClipboard(['C:\\a.png'], deps, 'copy')).toBe(true);
  expect(readFileClipboard(deps).operation).toBe('copy');
});

it('does not silently import only FileNameW when the native clipboard is busy', () => {
  const deps = makeDeps({ platform: 'win32', readNativeWin32: () => null });
  deps.buffers.set('FileNameW', Buffer.from('C:\\first-only.png\0', 'utf16le'));
  expect(readFilePathsFromClipboard(deps)).toEqual([]);
});
