#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function defaultUserDataPath() {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Serpent');
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'Serpent');
  }
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'Serpent');
}

function usage() {
  process.stderr.write(
    'Usage: node scripts/run-mcp.mjs [--headless] [--write-access] [--user-data <dir>] [--library <absolute-path>]\n',
  );
  process.exit(2);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    headless: false,
    libraryPath: process.env.SERPENT_MCP_LIBRARY_PATH ?? '',
    writeAccess: process.env.SERPENT_MCP_WRITE_ACCESS === '1',
    userData: process.env.SERPENT_MCP_USER_DATA_PATH ?? defaultUserDataPath(),
    allowUnbound: process.env.SERPENT_MCP_ALLOW_UNBOUND === '1',
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--headless') options.headless = true;
    else if (arg === '--write-access') options.writeAccess = true;
    else if (arg === '--unbound') options.allowUnbound = true;
    else if (arg === '--library') {
      options.libraryPath = args[index + 1] ?? '';
      index += 1;
    } else if (arg === '--user-data') {
      options.userData = path.resolve(args[index + 1] ?? '');
      index += 1;
    } else if (arg === '--help' || arg === '-h') usage();
    else {
      process.stderr.write(`Unknown argument: ${arg}\n`);
      usage();
    }
  }
  if (options.libraryPath && !path.isAbsolute(options.libraryPath)) {
    process.stderr.write('--library must be an absolute path.\n');
    usage();
  }
  return options;
}

function launchHeadless(options) {
  const env = {
    ...process.env,
    SERPENT_MCP: '1',
    SERPENT_MCP_WRITE_ACCESS: options.writeAccess ? '1' : '0',
    SERPENT_MCP_USER_DATA_PATH: options.userData,
  };
  if (options.libraryPath) env.SERPENT_MCP_LIBRARY_PATH = options.libraryPath;
  if (options.allowUnbound) env.SERPENT_MCP_ALLOW_UNBOUND = '1';
  process.stderr.write('[serpent-mcp] launching Electron headless MCP host…\n');
  const child = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['electron-forge', 'start'],
    { cwd: projectRoot, env, stdio: 'inherit' },
  );
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 1);
  });
}

function launchVisibleDesktop(options) {
  const env = {
    ...process.env,
    SERPENT_MCP_ATTACH_BOOTSTRAP: '1',
    SERPENT_MCP_USER_DATA_PATH: options.userData,
  };
  process.stderr.write('[serpent-mcp] launching visible Serpent Desktop for attachment…\n');
  return spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['electron-forge', 'start'],
    { cwd: projectRoot, env, stdio: ['ignore', 'ignore', 'inherit'] },
  );
}

function readDesktopControlEndpoint(userData) {
  const metadataPath = path.join(userData, 'desktop-control.json');
  if (!existsSync(metadataPath)) return null;
  try {
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
    const validLoopbackEndpoint = metadata.endpoint
      && typeof metadata.endpoint === 'object'
      && metadata.endpoint.host === '127.0.0.1'
      && Number.isInteger(metadata.endpoint.port)
      && metadata.endpoint.port > 0;
    if (
      (typeof metadata.endpoint !== 'string' && !validLoopbackEndpoint)
      || typeof metadata.nonce !== 'string'
    ) return null;
    return { endpoint: metadata.endpoint, nonce: metadata.nonce };
  } catch {
    return null;
  }
}

function connectSocket(endpoint, nonce, requestWriteAccess) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    socket.setEncoding('utf8');
    let buffer = '';
    let settled = false;
    const settleReject = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const settleResolve = (value) => {
      if (settled) return;
      settled = true;
      resolve({ socket, hello: value });
    };
    socket.once('error', settleReject);
    socket.on('data', (chunk) => {
      buffer += chunk;
      for (;;) {
        const newline = buffer.indexOf('\n');
        if (newline < 0) return;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          settleReject(new Error('Desktop control returned malformed JSON.'));
          socket.destroy();
          return;
        }
        if (message.type === 'hello.result') {
          if (!message.ok) {
            settleReject(new Error(message.message ?? 'Desktop attachment failed.'));
            socket.destroy();
            return;
          }
          settleResolve(message);
          return;
        }
      }
    });
    socket.once('close', () => {
      if (!settled) settleReject(new Error('Desktop control closed during attachment.'));
    });
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({
        type: 'hello',
        protocolVersion: 1,
        nonce,
        clientName: 'serpent-mcp',
        requestWriteAccess,
      })}\n`);
    });
  });
}

async function waitForEndpoint(userData, spawnDesktop) {
  const deadline = Date.now() + 30_000;
  let child = null;
  let launched = false;
  for (;;) {
    const endpoint = readDesktopControlEndpoint(userData);
    if (endpoint) {
      try {
        const connection = await connectSocket(endpoint.endpoint, endpoint.nonce, spawnDesktop.writeAccess);
        return { ...connection, child };
      } catch (error) {
        if (Date.now() >= deadline) throw error;
      }
    } else if (!launched) {
      child = launchVisibleDesktop(spawnDesktop);
      launched = true;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function runAttached(options) {
  const connection = await waitForEndpoint(options.userData, options);
  const socket = connection.socket;
  let requestCounter = 0;
  const pending = new Map();
  let buffer = '';

  socket.on('data', (chunk) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      if (message.type !== 'mcp.response') continue;
      const waiter = pending.get(message.requestId);
      if (!waiter) continue;
      pending.delete(message.requestId);
      if (message.ok) waiter.resolve(message.result);
      else waiter.reject(new Error(message.error?.message ?? 'Desktop MCP request failed.'));
    }
  });
  socket.on('close', () => {
    for (const waiter of pending.values()) waiter.reject(new Error('Attached Serpent Desktop closed.'));
    pending.clear();
  });

  function request(method, params) {
    const requestId = `proxy-${++requestCounter}`;
    return new Promise((resolve, reject) => {
      pending.set(requestId, { resolve, reject });
      socket.write(`${JSON.stringify({
        type: 'mcp.request',
        requestId,
        method,
        params,
      })}\n`);
    });
  }

  const server = new Server(
    { name: 'serpent-mcp', version: '1' },
    { capabilities: { tools: {}, logging: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => request('tools/list', {}));
  server.setRequestHandler(CallToolRequestSchema, async (requestInput) => (
    request('tools/call', {
      name: requestInput.params.name,
      arguments: requestInput.params.arguments ?? {},
    })
  ));
  await server.connect(new StdioServerTransport());
}

const options = parseArgs();
if (options.headless) {
  launchHeadless(options);
} else {
  runAttached(options).catch((error) => {
    process.stderr.write(`[serpent-mcp] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
