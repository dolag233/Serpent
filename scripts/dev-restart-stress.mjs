#!/usr/bin/env node
/**
 * Dev restart stress test — verifies Electron actually mounted the UI, not just
 * that Vite answers HTTP (the earlier false-positive check).
 *
 * Pass per round:
 *   - serpent.log contains main.window.mount-verified
 *   - no main.window.mount-failed / ERR_CONNECTION_REFUSED
 *   - after SIGINT, Serpent Electron exits (no orphan)
 */
import { execSync, spawn } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { killStaleSerpentDevProcesses } from "./kill-stale-dev.mjs";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rounds = Number(process.argv[2] || 5);
const port = Number(process.env.SERPENT_VITE_PORT || 5173);
const electronLog = path.join(homedir(), "Library/Logs/Electron/serpent.log");
const electronApp =
  process.platform === "win32"
    ? "node_modules\\electron\\dist\\electron.exe"
    : "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron";

function serpentElectronRunning() {
  if (process.platform === "win32") return false;
  try {
    execSync(`pgrep -f "${projectRoot}/${electronApp}"`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function logByteOffset() {
  try {
    return statSync(electronLog).size;
  } catch {
    return 0;
  }
}

function readNewLog(fromOffset) {
  try {
    return readFileSync(electronLog, "utf8").slice(fromOffset);
  } catch {
    return "";
  }
}

async function waitForMountVerified(fromOffset, deadlineMs = 90_000) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    const chunk = readNewLog(fromOffset);
    if (chunk.includes("main.window.mount-failed")) {
      return { ok: false, reason: "mount-failed", chunk };
    }
    if (chunk.includes("ERR_CONNECTION_REFUSED")) {
      return { ok: false, reason: "connection-refused", chunk };
    }
    if (chunk.includes("main.window.mount-verified")) {
      return { ok: true, chunk };
    }
    await sleep(400);
  }
  return { ok: false, reason: "timeout", chunk: readNewLog(fromOffset) };
}

function startNpmStart() {
  return spawn("npm", ["start"], {
    cwd: projectRoot,
    env: { ...process.env, SERPENT_VITE_PORT: String(port) },
    stdio: "ignore",
  });
}

async function stopNpmStartLikeUser(child) {
  child.kill("SIGINT");
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    await sleep(200);
  }
  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await sleep(500);
  }
  killStaleSerpentDevProcesses(projectRoot);
  await sleep(800);
}

async function runRound() {
  killStaleSerpentDevProcesses(projectRoot);
  await sleep(600);

  const logOffset = logByteOffset();
  const child = startNpmStart();

  try {
    const mount = await waitForMountVerified(logOffset);
    const electronAlive = serpentElectronRunning();
    return {
      ok: mount.ok && electronAlive,
      mount,
      electronAlive,
    };
  } finally {
    await stopNpmStartLikeUser(child);
  }
}

const results = [];
for (let i = 1; i <= rounds; i += 1) {
  process.stdout.write(`[stress] round ${i}/${rounds}… `);
  try {
    const result = await runRound();
    results.push({ round: i, ...result });
    console.log(result.ok ? "PASS" : "FAIL", {
      reason: result.mount.reason,
      electronAlive: result.electronAlive,
    });
  } catch (error) {
    results.push({ round: i, ok: false, error: String(error) });
    console.log("FAIL", error);
    killStaleSerpentDevProcesses(projectRoot);
    await sleep(800);
  }
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n[stress] ${passed}/${rounds} passed (Electron mount-verified)`);
if (passed < rounds) process.exitCode = 1;
