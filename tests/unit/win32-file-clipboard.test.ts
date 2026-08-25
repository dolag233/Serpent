// Serpent 新工单4: Windows CF_HDROP 剪贴板 — PureRef 等外部应用可粘贴。
// Electron writeBuffer('CF_HDROP') 注册的是同名自定义格式，Explorer/PureRef
// 读标准 CF_HDROP(ID 15) 读不到；win32-file-clipboard 用 koffi 直调 Win32 API。
// 本测试用 PowerShell Get-Clipboard -Format FileDropList 验证（与 Explorer
// 相同的读取路径），非 Windows 平台跳过。
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { writeWin32FileClipboard } from "../../src/main/win32-file-clipboard";

describe("win32-file-clipboard", () => {
  it.skipIf(process.platform !== "win32")(
    "writes a standard CF_HDROP readable by PowerShell FileDropList",
    () => {
      const root = mkdtempSync(path.join(tmpdir(), "serpent-clip-"));
      const file = path.join(root, "复制测试.txt");
      writeFileSync(file, "probe");

      expect(writeWin32FileClipboard([file])).toBe(true);

      // Windows PowerShell 5 can emit its console output in the active OEM
      // code page, which corrupts CJK paths even when CF_HDROP itself is
      // correct. Ask PowerShell for a UTF-16LE base64 payload so this test
      // validates the clipboard data without depending on console encoding.
      const encoded = execFileSync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          "$value = (Get-Clipboard -Format FileDropList | ForEach-Object { $_.FullName }) -join ';'; [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($value))",
        ],
        { encoding: "utf8" },
      ).trim();
      const out = Buffer.from(encoded, "base64").toString("utf16le");
      expect(out).toContain(file);
    },
  );
});
