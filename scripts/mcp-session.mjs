#!/usr/bin/env node
/**
 * Persistent Attached MCP session for Agent multi-step workflows.
 *
 * start  — attach once (may show Desktop confirm), then listen on a local socket
 * call   — tools/call over the existing session (no re-attach)
 * list   — tools/list
 * status — whether the daemon is alive
 * stop   — close session + daemon
 *
 * Default socket: <userData>/agent-mcp-session.sock
 */
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

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

function parseGlobalOptions(argv) {
  const options = {
    userData: process.env.SERPENT_MCP_USER_DATA_PATH ?? defaultUserDataPath(),
    writeAccess: process.env.SERPENT_MCP_WRITE_ACCESS === '1',
    args: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--user-data') {
      options.userData = path.resolve(argv[++i] ?? '');
    } else if (arg === '--write-access') {
      options.writeAccess = true;
    } else {
      options.args.push(arg);
    }
  }
  return options;
}

function pathsFor(userData) {
  mkdirSync(userData, { recursive: true });
  return {
    socketPath: path.join(userData, 'agent-mcp-session.sock'),
    pidPath: path.join(userData, 'agent-mcp-session.pid'),
    logPath: path.join(userData, 'agent-mcp-session.log'),
  };
}

function readEnvelope(response) {
  const textPart = response?.content?.find(
    (part) => part?.type === 'text' && typeof part.text === 'string',
  );
  if (!textPart) throw new Error('MCP tool response did not contain text content.');
  return JSON.parse(textPart.text);
}

function isAlive(pidPath) {
  if (!existsSync(pidPath)) return false;
  const pid = Number(readFileSync(pidPath, 'utf8').trim());
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function request(socketPath, message, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new Error('MCP session request timed out.'));
    }, timeoutMs);
    socket.setEncoding('utf8');
    socket.on('connect', () => {
      socket.write(`${JSON.stringify(message)}\n`);
    });
    socket.on('data', (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      const line = buffer.slice(0, newline);
      clearTimeout(timer);
      settled = true;
      socket.end();
      try {
        resolve(JSON.parse(line));
      } catch (error) {
        reject(error);
      }
    });
    socket.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function runDaemon(options) {
  const { socketPath, pidPath, logPath } = pathsFor(options.userData);
  const log = (line) => {
    const text = `[${new Date().toISOString()}] ${line}\n`;
    try {
      writeFileSync(logPath, text, { flag: 'a' });
    } catch {
      // ignore
    }
    process.stderr.write(text);
  };

  if (existsSync(socketPath)) {
    try {
      unlinkSync(socketPath);
    } catch {
      // ignore
    }
  }

  const proxyArgs = [
    path.join(projectRoot, 'scripts', 'desktop-attached-mcp-proxy.mjs'),
    '--user-data',
    options.userData,
  ];
  if (options.writeAccess) proxyArgs.push('--write-access');

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: proxyArgs,
    cwd: projectRoot,
    env: { ...process.env },
    stderr: 'pipe',
  });
  if (transport.stderr) {
    transport.stderr.on('data', (chunk) => log(String(chunk).trimEnd()));
  }

  const client = new Client({ name: 'serpent-agent-session', version: '0.1.0' });
  log('attaching to Desktop…');
  await client.connect(transport);
  log('attached');
  writeFileSync(pidPath, `${process.pid}\n`);

  const server = net.createServer((socket) => {
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', async (chunk) => {
      buffer += chunk;
      for (;;) {
        const newline = buffer.indexOf('\n');
        if (newline < 0) break;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          socket.write(`${JSON.stringify({ ok: false, error: 'invalid_json' })}\n`);
          continue;
        }
        try {
          if (message.method === 'ping') {
            socket.write(`${JSON.stringify({ ok: true, result: { pid: process.pid } })}\n`);
            continue;
          }
          if (message.method === 'tools/list') {
            const listed = await client.listTools();
            socket.write(`${JSON.stringify({
              ok: true,
              result: listed.tools.map((tool) => tool.name),
            })}\n`);
            continue;
          }
          if (message.method === 'tools/call') {
            const response = await client.callTool({
              name: message.params?.name,
              arguments: message.params?.arguments ?? {},
            });
            socket.write(`${JSON.stringify({
              ok: true,
              result: readEnvelope(response),
            })}\n`);
            continue;
          }
          if (message.method === 'shutdown') {
            socket.write(`${JSON.stringify({ ok: true, result: { stopping: true } })}\n`);
            socket.end();
            server.close();
            await client.close().catch(() => undefined);
            try {
              unlinkSync(pidPath);
            } catch {
              // ignore
            }
            process.exit(0);
          }
          socket.write(`${JSON.stringify({ ok: false, error: 'unknown_method' })}\n`);
        } catch (error) {
          socket.write(`${JSON.stringify({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          })}\n`);
        }
      }
    });
  });

  server.listen(socketPath, () => {
    log(`listening on ${socketPath}`);
  });

  const shutdown = async () => {
    server.close();
    await client.close().catch(() => undefined);
    try {
      unlinkSync(pidPath);
    } catch {
      // ignore
    }
    try {
      unlinkSync(socketPath);
    } catch {
      // ignore
    }
    process.exit(0);
  };
  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });
}

async function main() {
  const options = parseGlobalOptions(process.argv.slice(2));
  const [command, ...rest] = options.args;
  const { socketPath, pidPath } = pathsFor(options.userData);

  if (command === '--daemon') {
    await runDaemon(options);
    return;
  }

  if (command === 'start') {
    if (isAlive(pidPath)) {
      const ping = await request(socketPath, { method: 'ping' }).catch(() => null);
      if (ping?.ok) {
        process.stdout.write(`${JSON.stringify({ ok: true, alreadyRunning: true, pid: ping.result.pid })}\n`);
        return;
      }
    }
    const child = spawn(
      process.execPath,
      [
        path.join(projectRoot, 'scripts', 'mcp-session.mjs'),
        '--daemon',
        '--user-data',
        options.userData,
        ...(options.writeAccess ? ['--write-access'] : []),
      ],
      {
        cwd: projectRoot,
        detached: true,
        stdio: 'ignore',
        env: process.env,
      },
    );
    child.unref();
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (isAlive(pidPath) && existsSync(socketPath)) {
        try {
          const ping = await request(socketPath, { method: 'ping' }, 2_000);
          if (ping.ok) {
            process.stdout.write(`${JSON.stringify({
              ok: true,
              started: true,
              pid: ping.result.pid,
              socketPath,
            })}\n`);
            return;
          }
        } catch {
          // keep waiting for attach confirm
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    process.stderr.write('Timed out waiting for MCP session attach.\n');
    process.exit(1);
  }

  if (command === 'status') {
    const alive = isAlive(pidPath);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      alive,
      socketPath,
      pid: alive ? Number(readFileSync(pidPath, 'utf8').trim()) : null,
    })}\n`);
    return;
  }

  if (command === 'stop') {
    if (!existsSync(socketPath)) {
      process.stdout.write(`${JSON.stringify({ ok: true, stopped: false, reason: 'not_running' })}\n`);
      return;
    }
    const result = await request(socketPath, { method: 'shutdown' }).catch((error) => ({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }

  if (command === 'list') {
    const result = await request(socketPath, { method: 'tools/list' });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exit(1);
    return;
  }

  if (command === 'call') {
    const toolName = rest[0];
    const argsJson = rest[1] ?? '{}';
    if (!toolName) {
      process.stderr.write('Usage: node scripts/mcp-session.mjs call <tool> [json-args]\n');
      process.exit(2);
    }
    const result = await request(socketPath, {
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: JSON.parse(argsJson),
      },
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exit(1);
    return;
  }

  process.stderr.write(
    'Usage: node scripts/mcp-session.mjs [--user-data <dir>] [--write-access] <start|call|list|status|stop> ...\n',
  );
  process.exit(2);
}

await main();
