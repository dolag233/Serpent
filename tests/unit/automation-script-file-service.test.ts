import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { AutomationScriptFileService } from '../../src/main/automation-script-file-service';

const roots: string[] = [];
const scriptId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function root(): string {
  const value = mkdtempSync(path.join(tmpdir(), 'serpent-automation-script-file-'));
  roots.push(value);
  return value;
}

describe('AutomationScriptFileService', () => {
  it('opens a user-selected Serpent script without exposing its path and binds its handle to the sender and exact source', async () => {
    const directory = root();
    const filename = path.join(directory, 'rating.serpent.ts');
    const source = "return await serpent.assets.search({ query: 'name:Ser' });";
    writeFileSync(filename, source);
    const service = new AutomationScriptFileService({
      selectOpenScript: async () => filename,
      selectSaveScript: async () => undefined,
      newScriptId: () => scriptId,
    });

    await expect(service.open(17)).resolves.toEqual({
      ok: true,
      scriptId,
      displayName: 'rating.serpent.ts',
      source,
    });
    expect(service.resolveForExecution({ senderId: 17, scriptId, source })).toEqual({
      displayName: 'rating.serpent.ts',
      source,
    });
    expect(service.resolveForExecution({ senderId: 18, scriptId, source })).toBeUndefined();
    expect(service.resolveForExecution({ senderId: 17, scriptId, source: `${source}\n// changed` })).toBeUndefined();
  });

  it('saves only an allowed extension and returns a Main-issued handle for the exact written source', async () => {
    const directory = root();
    const filename = path.join(directory, 'rename.serpent.js');
    const source = "return await serpent.assets.renameFiles([{ assetId: 'a', newName: 'b' }]);";
    const service = new AutomationScriptFileService({
      selectOpenScript: async () => undefined,
      selectSaveScript: async () => filename,
      newScriptId: () => scriptId,
    });

    await expect(service.save({ senderId: 17, source })).resolves.toEqual({
      ok: true,
      scriptId,
      displayName: 'rename.serpent.js',
      source,
    });
    expect(readFileSync(filename, 'utf8')).toBe(source);
    expect(service.resolveForExecution({ senderId: 17, scriptId, source })).toEqual({
      displayName: 'rename.serpent.js',
      source,
    });
  });

  it('fails closed for unsupported files, over-limit text, and discarded dialogs', async () => {
    const directory = root();
    const unsupported = path.join(directory, 'untrusted.ts');
    writeFileSync(unsupported, 'return 1;');
    const tooLarge = path.join(directory, 'large.serpent.ts');
    writeFileSync(tooLarge, 'x'.repeat(64 * 1024 + 1));
    const service = new AutomationScriptFileService({
      selectOpenScript: async () => unsupported,
      selectSaveScript: async () => undefined,
      newScriptId: () => scriptId,
    });

    await expect(service.open(17)).resolves.toEqual({ ok: false, code: 'invalid-script-file' });
    await expect(service.save({ senderId: 17, source: 'return 1;' })).resolves.toEqual({ ok: false, code: 'cancelled' });
    const largeService = new AutomationScriptFileService({
      selectOpenScript: async () => tooLarge,
      selectSaveScript: async () => unsupported,
      newScriptId: () => scriptId,
    });
    await expect(largeService.open(17)).resolves.toEqual({ ok: false, code: 'source-too-large' });
    await expect(largeService.save({ senderId: 17, source: 'return 1;' })).resolves.toEqual({ ok: false, code: 'invalid-script-file' });
  });
});
