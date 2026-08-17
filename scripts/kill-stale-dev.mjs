#!/usr/bin/env node
/**
 * Terminate orphaned Serpent dev processes (Electron + Forge) for this repo.
 * Ctrl+C on `npm start` often leaves Electron alive while Vite dies → next
 * `npm start` hits single-instance focus on a dead renderer (black screen).
 */
import { execSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function killStaleSerpentDevProcesses(root = projectRoot) {
  if (process.platform === "win32") {
    try {
      execSync(
        `wmic process where "CommandLine like '%${root.replaceAll("\\", "\\\\")}%electron%'" call terminate`,
        { stdio: "ignore" },
      );
    } catch {
      // No matching processes.
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

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  killStaleSerpentDevProcesses();
}
