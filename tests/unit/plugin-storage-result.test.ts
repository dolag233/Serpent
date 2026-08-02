import { describe, expect, it } from 'vitest';

import { projectPluginStorageResult } from '../../src/scripting/plugin-storage-result';

describe('plugin Guest storage result projection', () => {
  it('unwraps storage protocol envelopes at the public API boundary', () => {
    expect(projectPluginStorageResult('get', { value: { selected: true } })).toEqual({ selected: true });
    expect(projectPluginStorageResult('get', { value: null })).toBeNull();
    expect(projectPluginStorageResult('set', { ok: true })).toBeUndefined();
    expect(projectPluginStorageResult('delete', { deleted: true })).toBe(true);
    expect(projectPluginStorageResult('list', { keys: ['selected'] })).toEqual(['selected']);
  });

  it('keeps the data directory response structured', () => {
    expect(projectPluginStorageResult('get-directory', {
      path: '/plugin-files/example',
      scope: 'library',
    })).toEqual({ path: '/plugin-files/example', scope: 'library' });
  });
});
