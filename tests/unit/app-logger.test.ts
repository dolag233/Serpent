import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'vitest';

import { AppLogger } from '../../src/main/app-logger';

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
