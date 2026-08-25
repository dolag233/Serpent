import { mkdtempSync, writeFileSync, readdirSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  MAX_SESSION_LOGS,
  chooseUniqueSessionLogPath,
  formatSessionTimestamp,
  pruneSessionLogs,
  sessionLogPathFor,
} from '../../src/main/session-log';

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'serpent-session-log-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('formatSessionTimestamp (Serpent-wgmy)', () => {
  it('formats local time to the second, zero-padded', () => {
    // 本地时间字段：2026-08-16T22:14:12
    const d = new Date(2026, 7, 16, 22, 14, 12);
    expect(formatSessionTimestamp(d)).toBe('20260816T221412');
  });

  it('pads single-digit month/day/hour/minute/second', () => {
    const d = new Date(2026, 0, 5, 3, 4, 7);
    expect(formatSessionTimestamp(d)).toBe('20260105T030407');
  });
});

describe('sessionLogPathFor', () => {
  it('builds the plain snake/underscore-free session path', () => {
    const d = new Date(2026, 7, 16, 22, 14, 12);
    expect(sessionLogPathFor('/tmp/logs', d)).toBe(
      path.join('/tmp/logs', 'serpent-20260816T221412.log'),
    );
  });
});

describe('chooseUniqueSessionLogPath', () => {
  it('returns the second-precision path when free', () => {
    const d = new Date(2026, 7, 16, 22, 14, 12);
    const exists = () => false;
    expect(chooseUniqueSessionLogPath('/tmp/logs', d, exists, 42)).toBe(
      path.join('/tmp/logs', 'serpent-20260816T221412.log'),
    );
  });

  it('falls back to millisecond precision on a same-second collision', () => {
    const d = new Date(2026, 7, 16, 22, 14, 12, 345);
    const exists = (filePath: string) =>
      filePath === path.join('/tmp/logs', 'serpent-20260816T221412.log');
    expect(chooseUniqueSessionLogPath('/tmp/logs', d, exists, 42)).toBe(
      path.join('/tmp/logs', 'serpent-20260816T221412345.log'),
    );
  });

  it('falls back to pid when the millisecond file also collides', () => {
    const d = new Date(2026, 7, 16, 22, 14, 12, 345);
    const exists = (filePath: string) =>
      filePath === path.join('/tmp/logs', 'serpent-20260816T221412.log') ||
      filePath === path.join('/tmp/logs', 'serpent-20260816T221412345.log');
    expect(chooseUniqueSessionLogPath('/tmp/logs', d, exists, 99)).toBe(
      path.join('/tmp/logs', 'serpent-20260816T221412-99.log'),
    );
  });
});

describe('pruneSessionLogs', () => {
  it('keeps at most MAX_SESSION_LOGS newest files and removes the rest', () => {
    const dir = tempDir();
    // 创建 103 个会话日志，mtime 递增（越晚创建的越新）。
    for (let i = 0; i < MAX_SESSION_LOGS + 3; i += 1) {
      const name = `serpent-20260816T${String(100000 + i * 7).padStart(6, '0')}.log`;
      const filePath = path.join(dir, name);
      writeFileSync(filePath, 'entry');
      utimesSync(filePath, new Date(2026, 7, 16, 0, 0, i), new Date(2026, 7, 16, 0, 0, i));
    }
    // 最旧的一个，必然被先删。
    writeFileSync(path.join(dir, 'serpent-20260815T000000.log'), 'oldest');

    const files = readdirSync(dir).filter((n) => n.startsWith('serpent-') && n.endsWith('.log'));
    expect(files).toHaveLength(MAX_SESSION_LOGS + 4);

    const removed = pruneSessionLogs(dir);
    // 超出的 4 个（103 会话 + 1 最旧 - 100 保留）应被删除。
    expect(removed.length).toBe(4);
    const remaining = readdirSync(dir).filter((n) => n.startsWith('serpent-') && n.endsWith('.log'));
    expect(remaining).toHaveLength(MAX_SESSION_LOGS);
  });

  it('leaves non-session logs and the legacy serpent.log untouched', () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'serpent.log'), 'legacy');
    writeFileSync(path.join(dir, 'other.txt'), 'other');
    writeFileSync(path.join(dir, 'serpent-20260816T000000.log'), 'one');
    writeFileSync(path.join(dir, 'serpent-20260816T000001.log'), 'two');
    // Filesystem directory order is not a recency signal on Windows; make the
    // intended survivor explicit through mtime so the pruning contract is
    // deterministic across platforms.
    utimesSync(
      path.join(dir, 'serpent-20260816T000000.log'),
      new Date(2026, 7, 16, 0, 0, 0),
      new Date(2026, 7, 16, 0, 0, 0),
    );
    utimesSync(
      path.join(dir, 'serpent-20260816T000001.log'),
      new Date(2026, 7, 16, 0, 0, 1),
      new Date(2026, 7, 16, 0, 0, 1),
    );
    const removed = pruneSessionLogs(dir, 1);
    expect(removed).toHaveLength(1);
    const remaining = readdirSync(dir).sort();
    expect(remaining).toContain('serpent.log');
    expect(remaining).toContain('other.txt');
    expect(remaining).toContain('serpent-20260816T000001.log');
    expect(remaining).not.toContain('serpent-20260816T000000.log');
  });

  it('returns nothing for a missing directory', () => {
    expect(pruneSessionLogs(path.join(tmpdir(), 'definitely-missing-xyz'))).toEqual([]);
  });
});
