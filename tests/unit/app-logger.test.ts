import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'vitest';

import { AppLogger } from '../../src/main/app-logger';
import {
  appLogFileNameSchema,
  parseReadAppLogRequest,
} from '../../src/shared/app-log';

test('persists an error and its cause as structured JSON lines', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-log-test-'));
  try {
    const logPath = path.join(root, 'serpent.log');
    const logger = new AppLogger(logPath);
    const cause = Object.assign(new Error('source read failed'), { code: 'EACCES' });
    logger.error('test.import', new Error('import failed', { cause }), { operation: 'import' });

    const entry = JSON.parse(readFileSync(logPath, 'utf8')) as Record<string, unknown>;
    expect(entry).toMatchObject({ level: 'error', scope: 'test.import' });
    expect(JSON.stringify(entry)).toContain('EACCES');
    expect(JSON.stringify(entry)).toContain('source read failed');
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('reads recent entries and redacts credentials from messages and context', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-log-read-test-'));
  try {
    const logPath = path.join(root, 'serpent.log');
    const logger = new AppLogger(logPath);
    logger.info(
      'ai.request.failed',
      'HTTP 401 from https://example.test/v1?api_key=sk-secret-value',
      { apiKey: 'sk-secret-value', reason: 'AI_AUTH' },
    );

    const entries = logger.readRecent();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      level: 'info',
      scope: 'ai.request.failed',
      context: { apiKey: '[REDACTED]', reason: 'AI_AUTH' },
    });
    expect(JSON.stringify(entries[0])).not.toContain('sk-secret-value');
    expect(JSON.stringify(entries[0])).toContain('AI_AUTH');
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('does not persist authorization credentials or an environment object from structured diagnostics', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-log-sensitive-context-test-'));
  try {
    const logPath = path.join(root, 'serpent.log');
    const logger = new AppLogger(logPath);
    logger.error(
      'automation.runtime.failed',
      new Error('Authorization: Bearer runtime-secret-token'),
      {
        authorization: 'Basic local-secret-value',
        environment: { SERPENT_API_KEY: 'environment-secret-value' },
      },
    );

    const persisted = readFileSync(logPath, 'utf8');
    expect(persisted).not.toContain('runtime-secret-token');
    expect(persisted).not.toContain('local-secret-value');
    expect(persisted).not.toContain('environment-secret-value');
    expect(logger.readRecent().at(-1)).toMatchObject({
      context: { authorization: '[REDACTED]', environment: '[REDACTED]' },
    });
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('normalizes structured Worker diagnostics so AI causes are readable in the viewer', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-log-worker-test-'));
  try {
    const logPath = path.join(root, 'serpent.log');
    const logger = new AppLogger(logPath);
    logger.worker(
      'stderr',
      JSON.stringify({
        scope: 'worker.ai.queue.analysis',
        context: { errorCode: 'AI_AUTH', jobId: 'job-1' },
        error: {
          name: 'Error',
          message: 'AI queue analysis failed.',
          cause: { message: 'Provider failure category: AI_AUTH; kind=auth; httpStatus=401' },
        },
      }),
    );

    const entries = logger.readRecent();
    expect(entries[0]).toMatchObject({
      level: 'error',
      scope: 'worker.ai.queue.analysis',
      context: { errorCode: 'AI_AUTH', jobId: 'job-1' },
    });
    expect(JSON.stringify(entries[0])).toContain('httpStatus=401');
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('redacts local filesystem paths only for the in-app view', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-log-path-test-'));
  try {
    const logPath = path.join(root, 'serpent.log');
    const logger = new AppLogger(logPath);
    logger.error('media.failed', new Error(`Could not open ${root}/source.mp4`));

    // 解析 JSON 后断言（Windows 下 JSON.stringify 会转义反斜杠，不能对
    // 序列化文本做 toContain(root)）。
    const raw = JSON.parse(JSON.stringify(logger.readRecent())) as Array<{
      error?: { message?: string };
    }>;
    expect(raw[0]?.error?.message).toContain(root);
    const redacted = JSON.stringify(logger.readRecent(500, { redactPaths: true }));
    expect(redacted).not.toContain(root);
    expect(redacted).toContain('[PATH_REDACTED]');
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('filters diagnostics by an automation execution or log correlation ID', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-log-automation-filter-test-'));
  try {
    const logPath = path.join(root, 'serpent.log');
    const logger = new AppLogger(logPath);
    logger.info('automation.execution.created', 'First automation run.', {
      executionId: 'execution-first',
      logId: 'log-first',
    });
    logger.error('automation.execution.command', new Error('Second automation run failed.'), {
      executionId: 'execution-second',
      logId: 'log-second',
    });
    logger.info('worker.ai.queue.analysis', 'An unrelated background task.', { jobId: 'job-1' });

    expect(logger.readRecent(500, { automationCorrelationId: 'execution-second' })).toMatchObject([
      {
        scope: 'automation.execution.command',
        context: { executionId: 'execution-second', logId: 'log-second' },
      },
    ]);
    expect(logger.readRecent(500, { automationCorrelationId: 'log-first' })).toMatchObject([
      {
        scope: 'automation.execution.created',
        context: { executionId: 'execution-first', logId: 'log-first' },
      },
    ]);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('accepts only an opaque automation correlation identifier over the diagnostics IPC boundary', () => {
  expect(parseReadAppLogRequest(undefined)).toEqual({});
  expect(parseReadAppLogRequest({ automationCorrelationId: 'execution-abc_123' })).toEqual({
    automationCorrelationId: 'execution-abc_123',
  });
  expect(parseReadAppLogRequest({ automationCorrelationId: '/Users/artist/private-library' })).toBeNull();
  expect(parseReadAppLogRequest({ automationCorrelationId: 'log id with spaces' })).toBeNull();
  expect(parseReadAppLogRequest({ automationCorrelationId: 'log-123', unsupported: true })).toBeNull();
});

test('accepts legacy and session-scoped application log basenames', () => {
  expect(appLogFileNameSchema.safeParse('serpent.log').success).toBe(true);
  expect(appLogFileNameSchema.safeParse('serpent-20260825T120000.log').success).toBe(true);
  expect(appLogFileNameSchema.safeParse('/tmp/serpent.log').success).toBe(false);
  expect(appLogFileNameSchema.safeParse('other.log').success).toBe(false);
});
