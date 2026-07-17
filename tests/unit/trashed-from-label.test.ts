import { describe, expect, it } from 'vitest';

import { trashedFromLabel } from '../../src/renderer/trashed-from-label';

describe('trashedFromLabel (Wave-3 audit P3)', () => {
  it('shows 资源库根目录 for root-level assets instead of duplicating the file name', () => {
    expect(trashedFromLabel('small-gray.png')).toBe('资源库根目录');
  });

  it('shows the parent directory for nested assets', () => {
    expect(trashedFromLabel('素材/角色/hero.png')).toBe('素材/角色');
    expect(trashedFromLabel('素材/hero.png')).toBe('素材');
  });

  it('tolerates Windows separators and edge cases', () => {
    expect(trashedFromLabel('素材\\角色\\hero.png')).toBe('素材/角色');
    expect(trashedFromLabel('/hero.png')).toBe('资源库根目录');
  });
});
