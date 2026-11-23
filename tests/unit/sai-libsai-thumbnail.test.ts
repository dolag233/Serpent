import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  defaultSaiLibsaiTools,
  extractSaiThumbnailWithLibsai,
} from '../../src/worker/sai-libsai-thumbnail';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('extractSaiThumbnailWithLibsai', () => {
  const tools = defaultSaiLibsaiTools();

  it('finds the built libsai thumbnail tools', () => {
    expect(existsSync(tools.sai1)).toBe(true);
    expect(existsSync(tools.sai2)).toBe(true);
  });

  it('returns null for a file that is not a SAI document', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-sai-'));
    temporaryRoots.push(root);
    const filePath = path.join(root, 'notes.bin');
    writeFileSync(filePath, Buffer.from('not a sai document'));

    expect(extractSaiThumbnailWithLibsai(filePath, tools)).toBeNull();
  });

  it('selects the SAI2 tool from the canvas header and still returns null for a truncated file', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-sai2-'));
    temporaryRoots.push(root);
    const filePath = path.join(root, 'truncated.sai2');
    writeFileSync(filePath, Buffer.from('SAI-CANVAS-TYPE0'));

    expect(extractSaiThumbnailWithLibsai(filePath, tools)).toBeNull();
  });
});
