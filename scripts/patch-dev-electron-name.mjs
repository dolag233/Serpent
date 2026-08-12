#!/usr/bin/env node
// Serpent-tluf/q0b1: in dev mode macOS shows "Electron" in the Dock and the
// application menu's first item, because the OS reads the name from the
// prebuilt Electron.app's Info.plist — app.setName() only changes the
// internal name. Patch the dev bundle's plist (superset's approach) and
// re-register with LaunchServices so dev shows "Serpent" everywhere.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronRoot = path.join(repoRoot, 'node_modules', 'electron', 'dist');
const appBundle = path.join(electronRoot, 'Electron.app');
const plistPath = path.join(appBundle, 'Contents', 'Info.plist');

if (process.platform !== 'darwin') process.exit(0);
if (!existsSync(plistPath)) {
  console.warn('[patch-dev-electron-name] Electron.app not found; skipping.');
  process.exit(0);
}

function plistValue(key) {
  const out = spawnSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plistPath], {
    encoding: 'utf8',
  });
  return out.status === 0 ? out.stdout.trim() : undefined;
}

const currentDisplay = plistValue('CFBundleDisplayName') ?? plistValue('CFBundleName');
if (currentDisplay === 'Serpent') {
  process.exit(0);
}

const plistArgs = [
  '-c', 'Delete :CFBundleDisplayName',
  '-c', `Add :CFBundleDisplayName string Serpent`,
  '-c', 'Delete :CFBundleName',
  '-c', `Add :CFBundleName string Serpent`,
  plistPath,
];
const result = spawnSync('/usr/libexec/PlistBuddy', plistArgs, { encoding: 'utf8' });
if (result.status !== 0) {
  console.warn(`[patch-dev-electron-name] PlistBuddy failed: ${result.stderr?.trim()}`);
  process.exit(1);
}
// Re-register so the Dock and menu bar pick up the new name.
spawnSync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', [
  '-f', appBundle,
], { stdio: 'ignore' });
console.log('[patch-dev-electron-name] Dev Electron.app renamed to Serpent (Dock + menu bar).');
