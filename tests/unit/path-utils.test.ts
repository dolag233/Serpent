import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { pathIsWithin } from '../../src/worker/path-utils';

describe('pathIsWithin', () => {
  const root = path.resolve(path.sep, 'serpent-path-root');

  it('accepts the root itself and direct or nested children', () => {
    expect(pathIsWithin(root, root)).toBe(true);
    expect(pathIsWithin(root, path.join(root, 'child'))).toBe(true);
    expect(pathIsWithin(root, path.join(root, 'child', 'grand'))).toBe(true);
  });

  it('rejects siblings, parents, and prefix-colliding directories', () => {
    expect(pathIsWithin(root, path.dirname(root))).toBe(false);
    expect(pathIsWithin(root, path.resolve(path.sep))).toBe(false);
    // 'serpent-path-root-other' shares a string prefix but is a sibling.
    expect(pathIsWithin(root, `${root}-other`)).toBe(false);
    expect(pathIsWithin(root, path.join(path.dirname(root), 'serpent-path-root-other'))).toBe(false);
  });

  it('does not treat a child whose name starts with ".." as an escape', () => {
    expect(pathIsWithin(root, path.join(root, '..dotty'))).toBe(true);
  });

  it.runIf(process.platform === 'win32')(
    'rejects destinations on a different drive letter (path.relative yields an absolute path)',
    () => {
      // Regression for Serpent-59f: exporting a library on E: to
      // C:\Users\...\Downloads was rejected as "inside the library" because
      // path.relative across drives returns the absolute target.
      expect(pathIsWithin('E:\\Libraries\\Foo', 'C:\\Users\\test\\Downloads')).toBe(false);
      expect(pathIsWithin('C:\\Libraries\\Foo', 'D:\\exports')).toBe(false);
      expect(pathIsWithin('E:\\Libraries\\Foo', 'E:\\Libraries\\Foo\\exports')).toBe(true);
      expect(pathIsWithin('E:\\Libraries\\Foo', 'e:\\libraries\\foo\\exports')).toBe(true);
    },
  );
});
