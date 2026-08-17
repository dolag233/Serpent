import { describe, expect, it } from 'vitest';

import {
  clearImportConflictPreferences,
  DEFAULT_IMPORT_CONFLICT_PREFERENCES,
  hasRememberedImportConflictPreferences,
  IMPORT_CONFLICT_PREF_KEY,
  loadImportConflictPreferences,
  rememberDuplicateDecision,
  rememberNameConflictDecision,
  type ImportConflictPreferencesStorage,
} from '../../src/renderer/import-conflict-preferences';
import {
  nextImportConflictPhaseAfterName,
  resolveImportConflictPresentation,
} from '../../src/renderer/import-conflict-flow';
import type { ImportConflictPlan } from '../../src/shared/protocol/responses';

function memoryStorage(
  initial: Record<string, string> = {},
): ImportConflictPreferencesStorage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

function plan(partial: Partial<ImportConflictPlan> = {}): ImportConflictPlan {
  return {
    importId: 'imp_test',
    fileCount: 1,
    totalBytes: 0,
    suspectedDuplicateCount: 0,
    libraryDuplicateCount: 0,
    nameConflictCount: 0,
    examples: [],
    ...partial,
  };
}

describe('import-conflict-preferences', () => {
  it('defaults to always asking', () => {
    const storage = memoryStorage();
    expect(loadImportConflictPreferences(storage)).toEqual(
      DEFAULT_IMPORT_CONFLICT_PREFERENCES,
    );
    expect(hasRememberedImportConflictPreferences(storage)).toBe(false);
  });

  it('remembers name and duplicate decisions independently', () => {
    const storage = memoryStorage();
    rememberNameConflictDecision('replace', storage);
    expect(loadImportConflictPreferences(storage).nameConflict).toBe('replace');
    expect(loadImportConflictPreferences(storage).duplicate).toBeNull();
    rememberDuplicateDecision('merge', storage);
    expect(loadImportConflictPreferences(storage)).toEqual({
      version: 1,
      nameConflict: 'replace',
      duplicate: 'create-copy',
    });
    expect(storage.getItem(IMPORT_CONFLICT_PREF_KEY)).toContain('"create-copy"');
  });

  it('migrates stored merge preference to create-copy on load (Serpent-9h01)', () => {
    const storage = memoryStorage({
      [IMPORT_CONFLICT_PREF_KEY]: JSON.stringify({
        version: 1,
        nameConflict: null,
        duplicate: 'merge',
      }),
    });
    expect(loadImportConflictPreferences(storage).duplicate).toBe('create-copy');
  });

  it('clears remembered decisions (Serpent-gf8n)', () => {
    const storage = memoryStorage();
    rememberNameConflictDecision('skip', storage);
    rememberDuplicateDecision('create-copy', storage);
    clearImportConflictPreferences(storage);
    expect(loadImportConflictPreferences(storage)).toEqual(
      DEFAULT_IMPORT_CONFLICT_PREFERENCES,
    );
    expect(hasRememberedImportConflictPreferences(storage)).toBe(false);
  });

  it('falls back to defaults on corrupt storage', () => {
    const storage = memoryStorage({
      [IMPORT_CONFLICT_PREF_KEY]: '{not-json',
    });
    expect(loadImportConflictPreferences(storage)).toEqual(
      DEFAULT_IMPORT_CONFLICT_PREFERENCES,
    );
  });
});

describe('import-conflict-flow', () => {
  it('defaults name phase to keep-both (auto-rename) and duplicate to skip', () => {
    const presentation = resolveImportConflictPresentation(
      plan({ nameConflictCount: 1 }),
      DEFAULT_IMPORT_CONFLICT_PREFERENCES,
    );
    expect(presentation).toEqual({
      nameDecision: 'keep-both',
      duplicateDecision: 'skip',
      phase: 'name',
    });
  });

  it('shows duplicate dialog when only content duplicates need a decision', () => {
    const presentation = resolveImportConflictPresentation(
      plan({ suspectedDuplicateCount: 2, libraryDuplicateCount: 1 }),
      DEFAULT_IMPORT_CONFLICT_PREFERENCES,
    );
    expect(presentation.phase).toBe('duplicate');
  });

  it('auto-resolves when both decisions are remembered (Serpent-gf8n)', () => {
    const presentation = resolveImportConflictPresentation(
      plan({ nameConflictCount: 1, suspectedDuplicateCount: 1 }),
      { version: 1, nameConflict: 'replace', duplicate: 'merge' },
    );
    expect(presentation).toEqual({
      nameDecision: 'replace',
      duplicateDecision: 'merge',
      phase: null,
    });
  });

  it('asks name first when both conflict classes are present', () => {
    const presentation = resolveImportConflictPresentation(
      plan({ nameConflictCount: 1, suspectedDuplicateCount: 1 }),
      DEFAULT_IMPORT_CONFLICT_PREFERENCES,
    );
    expect(presentation.phase).toBe('name');
    expect(
      nextImportConflictPhaseAfterName(
        plan({ nameConflictCount: 1, suspectedDuplicateCount: 1 }),
        DEFAULT_IMPORT_CONFLICT_PREFERENCES,
      ),
    ).toBe('duplicate');
  });

  it('skips duplicate phase when duplicate preference is remembered', () => {
    expect(
      nextImportConflictPhaseAfterName(
        plan({ suspectedDuplicateCount: 1 }),
        { version: 1, nameConflict: null, duplicate: 'skip' },
      ),
    ).toBeNull();
  });
});
