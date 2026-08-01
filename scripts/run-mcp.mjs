#!/usr/bin/env node
/**
 * Dev launcher for Serpent MCP.
 *
 * Default mode attaches to the current visible Desktop. `--headless` preserves
 * the original process-local MCP host for CI and explicit library workflows.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function usage() {
  process.stderr.write(
    'Usage: node scripts/run-mcp.mjs [--headless] [--library <absolute-library-path> | --unbound] [--write-access] [--user-data <dir>]\n',
  );
  process.exit(2);
}

const args = process.argv.slice(2);
let headless = false;
let libraryPath = process.env.SERPENT_MCP_LIBRARY_PATH ?? '';
let writeAccess = process.env.SERPENT_MCP_WRITE_ACCESS === '1';
let userData = process.env.SERPENT_MCP_USER_DATA_PATH ?? '';
let allowUnbound = process.env.SERPENT_MCP_ALLOW_UNBOUND === '1';

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === '--headless') {
    headless = true;
  } else if (arg === '--library') {
    libraryPath = args[index + 1] ?? '';
    index += 1;
  } else if (arg === '--write-access') {
    writeAccess = true;
  } else if (arg === '--unbound') {
    allowUnbound = true;
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

if (libraryPath && !path.isAbsolute(libraryPath)) {
  process.stderr.write('SERPENT_MCP_LIBRARY_PATH / --library must be an absolute path.\n');
  usage();
}

const env = { ...process.env };
const commandArgs = [];
if (headless) {
  env.SERPENT_MCP = '1';
  env.SERPENT_MCP_WRITE_ACCESS = writeAccess ? '1' : '0';
  if (libraryPath) env.SERPENT_MCP_LIBRARY_PATH = libraryPath;
  if (allowUnbound) env.SERPENT_MCP_ALLOW_UNBOUND = '1';
  if (userData) env.SERPENT_MCP_USER_DATA_PATH = path.resolve(userData);
  commandArgs.push('electron-forge', 'start');
} else {
  commandArgs.push(
    process.execPath,
    path.join(projectRoot, 'scripts', 'desktop-attached-mcp-proxy.mjs'),
  );
  if (writeAccess) commandArgs.push('--write-access');
  if (libraryPath) commandArgs.push('--library', libraryPath);
  if (allowUnbound) commandArgs.push('--unbound');
  if (userData) commandArgs.push('--user-data', path.resolve(userData));
}

process.stderr.write(
  headless
    ? '[serpent-mcp] launching Electron headless MCP host…\n'
    : '[serpent-mcp] attaching to Serpent Desktop…\n',
);

const child = spawn(
  process.platform === 'win32' && headless ? 'npx.cmd' : headless ? 'npx' : process.execPath,
  headless ? commandArgs : commandArgs.slice(1),
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
