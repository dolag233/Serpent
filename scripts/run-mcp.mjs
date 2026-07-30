#!/usr/bin/env node
/**
 * Dev launcher for the local Serpent MCP stdio adapter (0023 Phase C).
 *
 * Usage:
 *   node scripts/run-mcp.mjs --library /absolute/path/to/Library.serpentlibrary
 *
 * Optional:
 *   --write-access   expose Registry write tools (still needs journal grants)
 *   --user-data DIR   isolate Electron userData
 *
 * This is a protocol launcher only — no general CLI subcommands.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function usage(): never {
  process.stderr.write(
    'Usage: node scripts/run-mcp.mjs --library <absolute-library-path> [--write-access] [--user-data <dir>]\n',
  );
  process.exit(2);
}

const args = process.argv.slice(2);
let libraryPath = process.env.SERPENT_MCP_LIBRARY_PATH ?? '';
let writeAccess = process.env.SERPENT_MCP_WRITE_ACCESS === '1';
let userData = process.env.SERPENT_MCP_USER_DATA_PATH ?? '';

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === '--library') {
    libraryPath = args[index + 1] ?? '';
    index += 1;
  } else if (arg === '--write-access') {
    writeAccess = true;
  } else if (arg === '--user-data') {
    userData = args[index + 1] ?? '';
    index += 1;
  } else if (arg === '--help' || arg === '-h') {
    usage();
  } else {
    process.stderr.write(`Unknown argument: ${arg}\n`);
    usage();
  }
}

if (!libraryPath || !path.isAbsolute(libraryPath)) {
  process.stderr.write('SERPENT_MCP_LIBRARY_PATH / --library must be an absolute path.\n');
  usage();
}

const env = {
  ...process.env,
  SERPENT_MCP: '1',
  SERPENT_MCP_LIBRARY_PATH: libraryPath,
  SERPENT_MCP_WRITE_ACCESS: writeAccess ? '1' : '0',
};

if (userData) {
  env.SERPENT_MCP_USER_DATA_PATH = path.resolve(userData);
}

process.stderr.write('[serpent-mcp] launching Electron headless MCP host…\n');

const child = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['electron-forge', 'start'],
  {
    cwd: projectRoot,
    env,
    stdio: 'inherit',
  },
);

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
