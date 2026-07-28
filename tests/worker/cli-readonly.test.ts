import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeCliInvocation } from '../../src/cli/run';
import type { WorkerCommand } from '../../src/shared/protocol/requests';
import { LibraryService } from '../../src/worker/library-service';
import { publicErrorForWorkerFailure } from '../../src/worker/public-error';
import {
  executeReadOnlyWorkerCommand,
  isReadOnlyWorkerCommand,
} from '../../src/worker/read-only-command-executor';
import { importNoConflict } from './import-no-conflict';

const roots: string[] = [];
const services: LibraryService[] = [];

afterEach(() => {
  for (const service of services.splice(0)) service.closeAll();
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function digest(filename: string): string {
  return createHash('sha256').update(readFileSync(filename)).digest('hex');
}

describe('read-only CLI Worker path', () => {
  it('does not admit mutating Worker commands', () => {
    expect(isReadOnlyWorkerCommand({
      type: 'tag.create',
      libraryId: 'library-id',
      name: 'new-tag',
    })).toBe(false);
  });

  it('uses the shared Worker executor and leaves library bytes unchanged', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-cli-readonly-'));
    roots.push(root);
    const setup = new LibraryService();
    services.push(setup);
    const library = setup.createLibrary({
      displayName: 'CLI Read Only',
      selectedParentPath: root,
    });
    const source = path.join(root, 'retro-poster.png');
    writeFileSync(source, 'fixture');
    importNoConflict(setup, library.libraryId, source);
    setup.closeAll();
    services.splice(services.indexOf(setup), 1);

    const database = path.join(library.libraryPath, '.serpent', 'library.db');
    const beforeDigest = digest(database);
    const beforeEntries = readdirSync(path.join(library.libraryPath, '.serpent')).sort();

    const reader = new LibraryService();
    services.push(reader);
    const request = async (command: WorkerCommand) => {
      try {
        const result = await executeReadOnlyWorkerCommand(reader, command);
        if (!result) throw new Error(`Rejected command ${command.type}.`);
        return result;
      } catch (error) {
        return { ok: false as const, error: publicErrorForWorkerFailure(error) };
      }
    };
    const value = await executeCliInvocation({
      commandId: 'search',
      input: {
        json: true,
        libraryPath: library.libraryPath,
        query: 'retro',
        limit: 50,
        offset: 0,
      },
    }, { version: '0.1.0-test', request });

    expect(value).toMatchObject({
      total: 1,
      items: [{ relativeFilePath: 'retro-poster.png' }],
    });
    expect(digest(database)).toBe(beforeDigest);
    const afterEntries = readdirSync(path.join(library.libraryPath, '.serpent'))
      .filter((entry) => !entry.endsWith('-wal') && !entry.endsWith('-shm'))
      .sort();
    expect(afterEntries).toEqual(beforeEntries);
  });

  it('rejects an invalid library with the existing stable Worker error', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-cli-invalid-'));
    roots.push(root);
    const reader = new LibraryService();
    services.push(reader);

    const result = await executeReadOnlyWorkerCommand(reader, {
      type: 'library.open-readonly',
      selectedLibraryPath: root,
    }).catch((error: unknown) => ({
      ok: false as const,
      error: publicErrorForWorkerFailure(error),
    }));

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'NOT_A_LIBRARY',
        message: 'The selected folder is not a Serpent library.',
      },
    });
  });
});
