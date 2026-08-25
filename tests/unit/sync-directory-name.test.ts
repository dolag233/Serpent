import { describe, expect, it } from 'vitest';

import { sanitizeSyncDirectoryName } from '../../src/shared/sync-paths';

describe('sanitizeSyncDirectoryName (Serpent-xffq)', () => {
  it('keeps ordinary names unchanged', () => {
    expect(sanitizeSyncDirectoryName('测试资源库', 'lib-1')).toBe('测试资源库');
    expect(sanitizeSyncDirectoryName('My Library', 'lib-2')).toBe('My Library');
  });

  it('replaces path separators and reserved characters', () => {
    expect(sanitizeSyncDirectoryName('a/b\\c', 'lib-3')).toBe('a_b_c');
    // 相邻非法字符折叠为单个下划线。
    expect(sanitizeSyncDirectoryName('a:b*c?"d<e>|f', 'lib-4')).toBe('a_b_c_d_e_f');
    expect(sanitizeSyncDirectoryName('A\u0000B', 'lib-5')).toBe('A_B');
  });

  it('collapses repeated separators and trims leading/trailing dots and spaces', () => {
    expect(sanitizeSyncDirectoryName('a//b', 'lib-6')).toBe('a_b');
    expect(sanitizeSyncDirectoryName('  name  ', 'lib-7')).toBe('name');
    expect(sanitizeSyncDirectoryName('...hidden...', 'lib-8')).toBe('hidden');
  });

  it('prefixes Windows reserved device names', () => {
    expect(sanitizeSyncDirectoryName('CON', 'lib-9')).toBe('_CON');
    expect(sanitizeSyncDirectoryName('lpt3', 'lib-10')).toBe('_lpt3');
    expect(sanitizeSyncDirectoryName('Com1', 'lib-11')).toBe('_Com1');
  });

  it('falls back to library id prefix when the sanitized name is empty', () => {
    expect(sanitizeSyncDirectoryName('///', 'abcdef12345678')).toBe('library-abcdef12');
    expect(sanitizeSyncDirectoryName('', 'abcdef12345678')).toBe('library-abcdef12');
  });

  it('caps the directory name length at 128 characters', () => {
    const long = 'x'.repeat(200);
    const result = sanitizeSyncDirectoryName(long, 'lib-12');
    expect(result.length).toBeLessThanOrEqual(128);
  });
});
