import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  executeAutomationReadOnlyWorkerCommand,
  isAutomationReadOnlyWorkerCommand,
} from '../../src/worker/automation-readonly-command-executor';
import { dispatchAutomationReadOnlyRequest } from '../../src/worker/automation-readonly-dispatch';
import { LibraryService } from '../../src/worker/library-service';

const roots: string[] = [];
const services: LibraryService[] = [];

afterEach(() => {
  for (const service of services.splice(0)) service.closeAll();
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function digest(filename: string): string {
  return createHash('sha256').update(readFileSync(filename)).digest('hex');
}

describe('Automation read-only Worker dispatch', () => {
  it('does not admit mutating Worker commands', () => {
    expect(isAutomationReadOnlyWorkerCommand({
      type: 'tag.create',
      libraryId: 'library-1',
      name: 'new-tag',
    })).toBe(false);
  });

  it('fails closed at the actual automation dispatch boundary instead of falling through to desktop writes', () => {
    let createTagCalls = 0;
    const service = {
      createTag: () => {
        createTagCalls++;
        return { tagId: 'forbidden', name: 'forbidden', assetCount: 0 };
      },
    } as unknown as LibraryService;

    const result = dispatchAutomationReadOnlyRequest(service, {
      requestId: 'automation-write-rejected',
      dispatch: 'automation-readonly',
      command: { type: 'tag.create', libraryId: 'library-1', name: 'forbidden' },
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Serpent could not complete the request.',
      },
    });
    expect(createTagCalls).toBe(0);
  });

  it('uses the existing LibraryService read path without changing library bytes', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-automation-readonly-'));
    roots.push(root);
    const service = new LibraryService();
    services.push(service);
    const library = service.createLibrary({
      displayName: 'Automation read only',
      selectedParentPath: root,
    });
    const databasePath = path.join(library.libraryPath, '.serpent', 'library.db');
    const before = digest(databasePath);

    const result = executeAutomationReadOnlyWorkerCommand(service, {
      type: 'tag.list',
      libraryId: library.libraryId,
    });

    expect(result).toEqual({ ok: true, type: 'tag.list', tags: [] });
    expect(digest(databasePath)).toBe(before);
  });

  it('serves automation file-operation previews only through the readonly dispatcher', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-automation-plan-'));
    roots.push(root);
    const service = new LibraryService();
    services.push(service);
    const library = service.createLibrary({
      displayName: 'Automation plan',
      selectedParentPath: root,
    });
    const databasePath = path.join(library.libraryPath, '.serpent', 'library.db');
    const before = digest(databasePath);

    const result = dispatchAutomationReadOnlyRequest(service, {
      requestId: 'automation-plan',
      dispatch: 'automation-readonly',
      command: {
        type: 'automation.file-operation-plan',
        libraryId: library.libraryId,
        operation: 'trash',
        assetIds: ['missing-asset'],
      },
    });

    expect(result).toMatchObject({
      ok: true,
      type: 'automation.file-operation-planned',
      targetCount: 1,
      executableCount: 0,
      blockedCount: 1,
      undoSupported: true,
    });
    expect(digest(databasePath)).toBe(before);
  });

  it('reads the current AI layer without mutating the library', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-automation-ai-readonly-'));
    roots.push(root);
    const sourcePath = path.join(root, 'asset.txt');
    writeFileSync(sourcePath, 'AI result fixture');
    const service = new LibraryService();
    services.push(service);
    const library = service.createLibrary({
      displayName: 'Automation AI read only',
      selectedParentPath: root,
    });
    const imported = service.prepareOrExecuteImport({
      libraryId: library.libraryId,
      sourceKind: 'files',
      sourcePaths: [sourcePath],
    });
    if (!('assets' in imported) || imported.assets.length !== 1) {
      throw new Error('Expected one imported asset.');
    }
    const assetId = imported.assets[0]!.assetId;
    service.writeAiAnalysisResult({
      libraryId: library.libraryId,
      assetId,
      description: 'AI generated description',
      tags: ['cloud', 'cumulus'],
      rating: 4,
      modelId: 'test-model',
      modelVersion: 'test-model-v1',
      enabledFields: { description: true, tags: true, rating: true },
    });

    const databasePath = path.join(library.libraryPath, '.serpent', 'library.db');
    const before = digest(databasePath);
    const result = executeAutomationReadOnlyWorkerCommand(service, {
      type: 'ai.content.get',
      libraryId: library.libraryId,
      assetId,
    });

    expect(result).toEqual({
      ok: true,
      type: 'ai.content.got',
      assetId,
      description: 'AI generated description',
      tags: ['cloud', 'cumulus'],
      rating: 4,
      modelVersion: 'test-model-v1',
    });
    expect(digest(databasePath)).toBe(before);
  });
});
