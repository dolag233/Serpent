import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { hasPdfCompatibleIllustratorHeader } from '../../src/worker/illustrator-ai-format';

describe('Illustrator PDF compatibility probe', () => {
  it('finds a PDF header in the bounded Illustrator header area', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-ai-header-'));
    const filePath = path.join(root, 'compatible.ai');
    try {
      writeFileSync(filePath, Buffer.concat([
        Buffer.from('%!PS-Adobe-3.0\n'),
        Buffer.from('%PDF-1.7\n% Illustrator compatibility section\n'),
      ]));

      expect(hasPdfCompatibleIllustratorHeader(filePath)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects Illustrator files without a PDF-compatible representation', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-ai-header-'));
    const filePath = path.join(root, 'native-only.ai');
    try {
      writeFileSync(filePath, '%!PS-Adobe-3.0\n%%Creator: Adobe Illustrator\n');

      expect(hasPdfCompatibleIllustratorHeader(filePath)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a PDF header outside the bounded scan range', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-ai-header-'));
    const filePath = path.join(root, 'oversized-header.ai');
    try {
      writeFileSync(filePath, Buffer.concat([
        Buffer.alloc(1024, 0x20),
        Buffer.from('%PDF-1.7\n'),
      ]));

      expect(hasPdfCompatibleIllustratorHeader(filePath)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
