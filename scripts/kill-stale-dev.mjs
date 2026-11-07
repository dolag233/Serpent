#!/usr/bin/env node
/**
 * Terminate orphaned Serpent dev processes (Electron + Forge) for this repo.
 * Ctrl+C on `npm start` often leaves Electron alive while Vite dies → next
 * `npm start` hits single-instance focus on a dead renderer (black screen).
 */
import { execFileSync, execSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function killStaleSerpentDevProcesses(root = projectRoot) {
  if (process.platform === "win32") {
    try {
      const output = execFileSync("powershell.exe", [
        "-NoProfile", "-NonInteractive", "-Command",
        "Get-CimInstance Win32_Process -Filter \"Name = 'electron.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress",
      ], { encoding: "utf8", windowsHide: true });
      const parsed = JSON.parse(output || "null");
      for (const entry of parsed === null ? [] : Array.isArray(parsed) ? parsed : [parsed]) {
        if (!isSerpentDevElectronCommand(entry.CommandLine, root)) continue;
        try { process.kill(entry.ProcessId, "SIGKILL"); } catch { /* Already exited. */ }
      }
    } catch {
      // Process enumeration can fail under restricted Windows accounts.
    }
    return;
  }

  const patterns = [
    `${root}/node_modules/electron/dist/Electron.app`,
    `${root}.*electron-forge start`,
    `${root}/node_modules/.bin/electron-forge`,
  ];
  for (const pattern of patterns) {
    try {
      execSync(`pkill -f "${pattern}"`, { stdio: "ignore" });
    } catch {
      // pkill exits 1 when nothing matched.
    }
  }
}

/** Match this checkout's Electron binary, never another Electron application. */
export function isSerpentDevElectronCommand(commandLine, root = projectRoot, platform = process.platform) {
  if (typeof commandLine !== "string") return false;
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const executable = pathApi.join(root, "node_modules", "electron", "dist",
    platform === "win32" ? "electron.exe"
      : platform === "darwin" ? "Electron.app/Contents/MacOS/Electron" : "electron");
  const command = platform === "win32" ? commandLine.toLowerCase() : commandLine;
  const expected = platform === "win32" ? executable.toLowerCase() : executable;
  return command.startsWith(`"${expected}"`)
    || (command.startsWith(expected) && /^\s|$/.test(command.slice(expected.length, expected.length + 1)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  killStaleSerpentDevProcesses();
}
