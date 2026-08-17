import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';

describe('plugin derived-field materialization', () => {
  const roots: string[] = [];

  afterEach(() => {
    while (roots.length > 0) {
      const root = roots.pop();
      if (root !== undefined) rmSync(root, { recursive: true, force: true });
    }
  });

  it('writes namespaced values and queries only the current package version', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-plugin-derived-fields-'));
    roots.push(root);
    const service = new LibraryService();
    const library = service.createLibrary({
      displayName: 'Derived Fields',
      selectedParentPath: root,
    });
    const source = path.join(root, 'sample.png');
    writeFileSync(source, 'asset');
    const imported = service.prepareOrExecuteImport({
      libraryId: library.libraryId,
      sourceKind: 'files',
      sourcePaths: [source],
    });
    if ('importId' in imported) throw new Error('Unexpected import conflict.');
    const assetId = imported.assets[0]!.assetId;

    const first = service.materializePluginDerivedFields({
      libraryId: library.libraryId,
      pluginId: 'com.serpent.derived-probe',
      packageHash: 'a'.repeat(64),
      fieldId: 'extUpper',
      fieldType: 'string',
      values: [{ assetId, value: 'PNG' }],
    });
    expect(first.writtenCount).toBe(1);

    expect(service.queryPluginDerivedFields({
      libraryId: library.libraryId,
      pluginId: 'com.serpent.derived-probe',
      packageHash: 'a'.repeat(64),
      fieldId: 'extUpper',
      operator: 'equals',
      value: 'PNG',
    })).toEqual({ assetIds: [assetId], total: 1 });

    expect(service.queryPluginDerivedFields({
      libraryId: library.libraryId,
      pluginId: 'com.serpent.derived-probe',
      packageHash: 'b'.repeat(64),
      fieldId: 'extUpper',
      operator: 'equals',
      value: 'PNG',
    })).toEqual({ assetIds: [], total: 0 });

    service.closeLibrary(library.libraryId);
  });
});
