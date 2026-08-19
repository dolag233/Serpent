import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(repoRoot, '.beads', 'hooks');
const targetDir = path.join(repoRoot, '.git', 'hooks');

const hookNames = [
  'pre-commit',
  'prepare-commit-msg',
  'post-merge',
  'post-checkout',
  'pre-push',
];

if (!fs.existsSync(sourceDir)) {
  console.error(`[install-git-hooks] missing ${sourceDir}`);
  process.exit(1);
}

if (!fs.existsSync(targetDir)) {
  console.error(`[install-git-hooks] not a git repo: ${targetDir} missing`);
  process.exit(1);
}

for (const name of hookNames) {
  const source = path.join(sourceDir, name);
  const target = path.join(targetDir, name);
  if (!fs.existsSync(source)) {
    console.error(`[install-git-hooks] missing hook template: ${source}`);
    process.exit(1);
  }
  fs.copyFileSync(source, target);
  try {
    fs.chmodSync(target, 0o755);
  } catch {
    // Windows may ignore chmod; Git Bash still runs the hook.
  }
  console.log(`[install-git-hooks] installed ${name}`);
}

console.log('[install-git-hooks] done — ticket JSONL hooks only; do not re-enable bd export hooks.');
