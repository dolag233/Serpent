import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  readAtomicJsonFile,
  recoverAtomicJsonFile,
  writeAtomicJsonFile,
} from '../../src/main/atomic-json-file';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('atomic JSON file persistence', () => {
  it('writes and reads the latest document', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-atomic-json-'));
    roots.push(root);
    const filename = path.join(root, 'settings.json');

    writeAtomicJsonFile(filename, '{"version":1}');
    expect(readAtomicJsonFile(filename)).toBe('{"version":1}');

    writeAtomicJsonFile(filename, '{"version":2}');
    expect(readAtomicJsonFile(filename)).toBe('{"version":2}');
  });

  it('recovers a destination moved to the crash-recovery backup', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-atomic-json-'));
    roots.push(root);
    const filename = path.join(root, 'journal.json');
    writeAtomicJsonFile(filename, '{"state":"durable"}');
    renameSync(filename, `${filename}.bak`);

    expect(readAtomicJsonFile(filename)).toBe('{"state":"durable"}');
    expect(readAtomicJsonFile(`${filename}.bak`)).toBeUndefined();
  });

  it('removes a stale backup when the destination is already present', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-atomic-json-'));
    roots.push(root);
    const filename = path.join(root, 'credentials.json');
    writeAtomicJsonFile(filename, '{"state":"latest"}');
    writeFileSync(`${filename}.bak`, '{"state":"stale"}');
    recoverAtomicJsonFile(filename);

    expect(readAtomicJsonFile(filename)).toBe('{"state":"latest"}');
    expect(readAtomicJsonFile(`${filename}.bak`)).toBeUndefined();
  });
});
