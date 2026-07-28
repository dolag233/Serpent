#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import packageJson from '../../package.json';
import { AppLogger } from '../main/app-logger';
import { CLI_HELP, CliUsageError, parseCliArgv } from './argv';
import { executeCliInvocation, humanOutput } from './run';
import { CliWorkerClient } from './worker-client';

const EXIT_USAGE = 2;
const EXIT_LIBRARY = 3;
const EXIT_OPERATION = 4;

function logPath(): string {
  if (process.env.SERPENT_CLI_LOG_PATH) return process.env.SERPENT_CLI_LOG_PATH;
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Logs', 'Serpent', 'serpent-cli.log');
  }
  if (process.platform === 'win32') {
    return path.join(
      process.env.LOCALAPPDATA ?? os.homedir(),
      'Serpent',
      'Logs',
      'serpent-cli.log',
    );
  }
  return path.join(
    process.env.XDG_STATE_HOME ?? path.join(os.homedir(), '.local', 'state'),
    'serpent',
    'serpent-cli.log',
  );
}

function workerPath(): string {
  return fileURLToPath(new URL('../cli-worker/cli-worker.mjs', import.meta.url));
}

function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = error.code;
    if (typeof code === 'string') return code;
  }
  return 'CLI_INTERNAL_ERROR';
}

function exitCodeFor(error: unknown): number {
  if (error instanceof CliUsageError) return EXIT_USAGE;
  const code = errorCode(error);
  if (
    code === 'LIBRARY_NOT_FOUND'
    || code === 'NOT_A_LIBRARY'
    || code === 'LIBRARY_CORRUPT'
    || code === 'LIBRARY_VERSION_TOO_NEW'
  ) return EXIT_LIBRARY;
  return EXIT_OPERATION;
}

async function main(): Promise<void> {
  const logger = new AppLogger(logPath());
  let invocation;
  try {
    invocation = parseCliArgv(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CliUsageError && error.message === 'HELP') {
      process.stdout.write(`${CLI_HELP}\n`);
      return;
    }
    const message = error instanceof Error ? error.message : '参数无效。';
    process.stderr.write(`${message}\n\n${CLI_HELP}\n`);
    process.exitCode = EXIT_USAGE;
    return;
  }

  let client: CliWorkerClient | undefined;
  try {
    if (!['version', 'commands'].includes(invocation.commandId)) {
      client = new CliWorkerClient(workerPath(), logger);
    }
    const value = await executeCliInvocation(invocation, {
      version: packageJson.version,
      request: (command) => {
        if (!client) throw new Error('CLI Worker is not available for this command.');
        return client.request(command);
      },
    });
    process.stdout.write(
      invocation.input.json
        ? `${JSON.stringify({ ok: true, command: invocation.commandId, value })}\n`
        : `${humanOutput(invocation.commandId, value)}\n`,
    );
  } catch (error) {
    const logId = randomUUID();
    logger.error('cli.command', error, {
      logId,
      commandId: invocation.commandId,
      libraryPath: invocation.input.libraryPath,
    });
    const code = errorCode(error);
    const message = error instanceof Error ? error.message : 'Serpent CLI 无法完成命令。';
    const failure = { ok: false, error: { code, message, logId } };
    process.stderr.write(
      invocation.input.json
        ? `${JSON.stringify(failure)}\n`
        : `${message}\n错误码：${code}\n日志编号：${logId}\n`,
    );
    process.exitCode = exitCodeFor(error);
  } finally {
    await client?.close();
  }
}

void main();
