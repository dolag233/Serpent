import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  UI_CSS_VAR,
  UI_LAYER,
  cssVar,
  layerCssVar,
} from '../../src/renderer/ui/foundation';

describe('UI foundation contract', () => {
  it('defines the same semantic token contract for dark and light themes', () => {
    const tokens = readFileSync(new URL('../../src/renderer/ui/tokens.css', import.meta.url), 'utf8');
    expect(tokens).toContain(':root[data-theme="dark"]');
    expect(tokens).toContain('[data-theme="light"]');
    expect(tokens).toContain('--ui-action-accent: var(--accent, #3b82f6);');
    expect(tokens).toContain('--ui-layer-tooltip: 900;');
  });

  it('uses stable semantic layer values', () => {
    expect(UI_LAYER.base).toBe(0);
    expect(UI_LAYER.modalBackdrop).toBeLessThan(UI_LAYER.modal);
    expect(UI_LAYER.modal).toBeLessThan(UI_LAYER.tooltip);
  });

  it('resolves semantic CSS variable names without page-local values', () => {
    expect(cssVar(UI_CSS_VAR.content.primary)).toBe('var(--ui-content-primary)');
    expect(cssVar(UI_CSS_VAR.geometry.controlMd, '32px')).toBe(
      'var(--ui-size-control-md, 32px)',
    );
    expect(layerCssVar('notice')).toBe('var(--ui-layer-notice)');
  });
});
