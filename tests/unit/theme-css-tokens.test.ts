import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(
  resolve(__dirname, '../../src/renderer/styles.css'),
  'utf8',
);

describe('theme CSS tokens (REQ-THEME-002)', () => {
  it('defines light overrides for core and status tokens', () => {
    expect(css).toContain('[data-theme="light"]');
    for (const token of [
      '--canvas',
      '--pane',
      '--text',
      '--accent',
      '--danger',
      '--success',
      '--warning-fg',
      '--ink',
      '--accent-soft-fg',
      '--rating-star',
    ]) {
      expect(css).toContain(token);
    }
  });

  it('keeps no raw hex colors outside token definition blocks', () => {
    const lines = css.split('\n');
    const hard: string[] = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i] ?? '';
      const trimmed = line.trimStart();
      if (trimmed.startsWith(':root') || trimmed.startsWith('[data-theme=')) {
        let depth = 0;
        while (i < lines.length) {
          const cur = lines[i] ?? '';
          depth += (cur.match(/\{/g) ?? []).length;
          depth -= (cur.match(/\}/g) ?? []).length;
          i += 1;
          if (depth <= 0) break;
        }
        continue;
      }
      if (/#[0-9a-fA-F]{3,8}\b/.test(line)) {
        hard.push(`${i + 1}: ${line.trim()}`);
      }
      i += 1;
    }
    expect(hard, hard.join('\n')).toEqual([]);
  });
});
