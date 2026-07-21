/**
 * OS file-path clipboard for Finder / Explorer interoperability (clarification #5).
 *
 * Electron 43 has no clipboard.writeFilePaths; we write/read platform pasteboard
 * formats so copied folders/files can paste outside Serpent and vice versa.
 *
 * Renderer never sees absolute paths (REQ-COMMAND-003): Main only.
 */

import path from "node:path";

export type FileClipboardPlatform = "darwin" | "win32" | "other";

export type FileClipboardDeps = {
  readonly platform: FileClipboardPlatform;
  readonly writeBuffer: (format: string, buffer: Buffer) => void;
  readonly readBuffer: (format: string) => Buffer;
  readonly hasFormat: (format: string) => boolean;
  readonly clear: () => void;
  /** Optional text fallback (path list) for apps that only paste text. */
  readonly writeText: (text: string) => void;
};

export function detectFileClipboardPlatform(
  nodePlatform: NodeJS.Platform = process.platform,
): FileClipboardPlatform {
  if (nodePlatform === "darwin") return "darwin";
  if (nodePlatform === "win32") return "win32";
  return "other";
}

export function createFileClipboardDeps(): FileClipboardDeps {
  // Lazy-require so unit tests inject deps without loading Electron.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { clipboard } = require("electron") as {
    clipboard: {
      writeBuffer: (format: string, buffer: Buffer) => void;
      readBuffer: (format: string) => Buffer;
      has: (format: string) => boolean;
      clear: () => void;
      writeText: (text: string) => void;
    };
  };
  return {
    platform: detectFileClipboardPlatform(),
    writeBuffer: (format, buffer) => clipboard.writeBuffer(format, buffer),
    readBuffer: (format) => clipboard.readBuffer(format),
    hasFormat: (format) => clipboard.has(format),
    clear: () => clipboard.clear(),
    writeText: (text) => clipboard.writeText(text),
  };
}

/** Escape a path for inclusion in a minimal XML plist string array. */
export function escapePlistString(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Build NSFilenamesPboardType / public.utf8-plain-text-compatible plist. */
export function buildNsFilenamesPlist(filePaths: readonly string[]): Buffer {
  const items = filePaths
    .map((filePath) => `  <string>${escapePlistString(filePath)}</string>`)
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<array>
${items}
</array>
</plist>
`;
  return Buffer.from(xml, "utf8");
}

/** Parse a string-array plist produced by Finder or {@link buildNsFilenamesPlist}. */
export function parseNsFilenamesPlist(buffer: Buffer): string[] {
  const xml = buffer.toString("utf8");
  const matches = [...xml.matchAll(/<string>([\s\S]*?)<\/string>/g)];
  return matches.map((match) =>
    match[1]!
      .replaceAll("&quot;", '"')
      .replaceAll("&gt;", ">")
      .replaceAll("&lt;", "<")
      .replaceAll("&amp;", "&"),
  );
}

/**
 * CF_HDROP DROPFILES + double-null-terminated UTF-16LE path list.
 * @see https://learn.microsoft.com/windows/win32/shell/clipboard#cf_hdrop
 */
export function buildCfHdrop(filePaths: readonly string[]): Buffer {
  // DROPFILES: pFiles(4) + pt.x(4) + pt.y(4) + fNC(4) + fWide(4) = 20
  const headerSize = 20;
  const pathPayload = `${filePaths.join("\0")}\0\0`;
  const pathBytes = Buffer.from(pathPayload, "utf16le");
  const buffer = Buffer.alloc(headerSize + pathBytes.length);
  buffer.writeUInt32LE(headerSize, 0); // pFiles
  buffer.writeInt32LE(0, 4); // pt.x
  buffer.writeInt32LE(0, 8); // pt.y
  buffer.writeUInt32LE(0, 12); // fNC
  buffer.writeUInt32LE(1, 16); // fWide = TRUE
  pathBytes.copy(buffer, headerSize);
  return buffer;
}

export function parseCfHdrop(buffer: Buffer): string[] {
  if (buffer.length < 20) return [];
  const pFiles = buffer.readUInt32LE(0);
  const fWide = buffer.readUInt32LE(16) !== 0;
  if (pFiles >= buffer.length) return [];
  const payload = buffer.subarray(pFiles);
  const text = fWide
    ? payload.toString("utf16le")
    : payload.toString("latin1");
  return text.split("\0").filter((entry) => entry.length > 0);
}

export function writeFilePathsToClipboard(
  filePaths: readonly string[],
  deps: FileClipboardDeps,
): boolean {
  const absolute = filePaths
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      // Preserve Windows drive-letter paths even when Main runs on darwin
      // (unit tests / cross-compile). path.resolve would otherwise treat
      // `C:\…` as a relative segment under the cwd.
      if (path.win32.isAbsolute(entry) || path.posix.isAbsolute(entry)) {
        return entry;
      }
      return path.resolve(entry);
    })
    .filter((entry) => entry.length > 0);
  if (absolute.length === 0) return false;

  try {
    deps.clear();
    if (deps.platform === "darwin") {
      const plist = buildNsFilenamesPlist(absolute);
      deps.writeBuffer("NSFilenamesPboardType", plist);
      // Single-file URL helps some targets; multi stays on NSFilenames.
      if (absolute.length === 1) {
        const fileUrl = pathToFileUrl(absolute[0]!);
        deps.writeBuffer(
          "public.file-url",
          Buffer.from(fileUrl, "utf8"),
        );
      }
      deps.writeText(absolute.join("\n"));
      return true;
    }
    if (deps.platform === "win32") {
      deps.writeBuffer("CF_HDROP", buildCfHdrop(absolute));
      // FileNameW: first path, UCS-2, double-null terminated.
      const first = `${absolute[0]!}\0\0`;
      deps.writeBuffer("FileNameW", Buffer.from(first, "ucs2"));
      deps.writeText(absolute.join("\r\n"));
      return true;
    }
    // Unsupported platform: text-only fallback so paste-in-app can still work
    // via explicit path list in E2E / rare Linux hosts.
    deps.writeText(absolute.join("\n"));
    return true;
  } catch {
    return false;
  }
}

export function readFilePathsFromClipboard(deps: FileClipboardDeps): string[] {
  try {
    const isAbs = (entry: string) =>
      path.win32.isAbsolute(entry) || path.posix.isAbsolute(entry);
    if (deps.platform === "darwin") {
      if (deps.hasFormat("NSFilenamesPboardType")) {
        return parseNsFilenamesPlist(
          deps.readBuffer("NSFilenamesPboardType"),
        ).filter(isAbs);
      }
      if (deps.hasFormat("public.file-url")) {
        const raw = deps.readBuffer("public.file-url").toString("utf8").trim();
        const filePath = fileUrlToPath(raw);
        return filePath && isAbs(filePath) ? [filePath] : [];
      }
      return [];
    }
    if (deps.platform === "win32") {
      if (deps.hasFormat("CF_HDROP")) {
        return parseCfHdrop(deps.readBuffer("CF_HDROP")).filter(isAbs);
      }
      if (deps.hasFormat("FileNameW")) {
        const raw = deps
          .readBuffer("FileNameW")
          .toString("ucs2")
          .replace(/\0+$/, "");
        return raw && isAbs(raw) ? [raw] : [];
      }
      return [];
    }
    return [];
  } catch {
    return [];
  }
}

function pathToFileUrl(absolutePath: string): string {
  const normalized = absolutePath.replaceAll("\\", "/");
  const withLeading =
    normalized.startsWith("/") ? normalized : `/${normalized}`;
  return `file://${encodeURI(withLeading)}`;
}

function fileUrlToPath(fileUrl: string): string | null {
  if (!fileUrl.startsWith("file://")) return null;
  try {
    const url = new URL(fileUrl);
    if (url.protocol !== "file:") return null;
    return decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
}
