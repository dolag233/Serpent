import { describe, expect, it } from 'vitest';

import { canonicalizePluginArchiveEntryPath } from '../../src/main/plugin-package-archive';

describe('canonicalizePluginArchiveEntryPath', () => {
  it('keeps relative POSIX package paths', () => {
    expect(canonicalizePluginArchiveEntryPath('serpent-plugin.json')).toEqual({
      ok: true,
      path: 'serpent-plugin.json',
    });
    expect(canonicalizePluginArchiveEntryPath('entry/main.js')).toEqual({
      ok: true,
      path: 'entry/main.js',
    });
  });

  it('strips Windows tar ./ prefixes without treating them as traversal', () => {
    expect(canonicalizePluginArchiveEntryPath('./')).toEqual({ ok: true, skip: true });
    expect(canonicalizePluginArchiveEntryPath('./LICENSE')).toEqual({
      ok: true,
      path: 'LICENSE',
    });
    expect(canonicalizePluginArchiveEntryPath('./runtime/bin/win32-x64/upscayl-bin.exe')).toEqual({
      ok: true,
      path: 'runtime/bin/win32-x64/upscayl-bin.exe',
    });
  });

  it('converts Compress-Archive backslashes to POSIX segments', () => {
    expect(canonicalizePluginArchiveEntryPath('entry\\main.js')).toEqual({
      ok: true,
      path: 'entry/main.js',
    });
    expect(canonicalizePluginArchiveEntryPath('.\\serpent-plugin.json')).toEqual({
      ok: true,
      path: 'serpent-plugin.json',
    });
  });

  it('still rejects absolute and parent-traversing names', () => {
    expect(canonicalizePluginArchiveEntryPath('../escape.txt')).toEqual({ ok: false });
    expect(canonicalizePluginArchiveEntryPath('foo/../escape.txt')).toEqual({ ok: false });
    expect(canonicalizePluginArchiveEntryPath('foo\\..\\escape.txt')).toEqual({ ok: false });
    expect(canonicalizePluginArchiveEntryPath('/tmp/escape.txt')).toEqual({ ok: false });
    expect(canonicalizePluginArchiveEntryPath('C:\\escape.txt')).toEqual({ ok: false });
  });
});
