import { describe, expect, it } from 'vitest';

import { RelinkPreviewStore } from '../../src/main/relink-preview-store';

describe('RelinkPreviewStore', () => {
  it('consumes a matching preview exactly once', () => {
    const store = new RelinkPreviewStore(() => 'preview-01');

    expect(store.create('library-01', '/private/root')).toBe('preview-01');
    expect(store.consume('library-01', 'wrong-preview')).toBeUndefined();
    expect(store.consume('library-01', 'preview-01')).toBe('/private/root');
    expect(store.consume('library-01', 'preview-01')).toBeUndefined();
  });

  it('replaces an older preview for the same library', () => {
    const ids = ['preview-01', 'preview-02'];
    const store = new RelinkPreviewStore(() => ids.shift() ?? 'unexpected');

    store.create('library-01', '/private/old-root');
    store.create('library-01', '/private/new-root');

    expect(store.consume('library-01', 'preview-01')).toBeUndefined();
    expect(store.consume('library-01', 'preview-02')).toBe('/private/new-root');
  });

  it('invalidates previews on explicit cancel or library close', () => {
    const ids = ['preview-01', 'preview-02'];
    const store = new RelinkPreviewStore(() => ids.shift() ?? 'unexpected');

    store.create('library-01', '/private/root');
    expect(store.cancel('library-01', 'preview-01')).toBe(true);
    expect(store.cancel('library-01', 'preview-01')).toBe(false);

    store.create('library-01', '/private/root');
    store.clearLibrary('library-01');
    expect(store.consume('library-01', 'preview-02')).toBeUndefined();
  });
});
