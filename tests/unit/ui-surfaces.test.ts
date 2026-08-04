// @vitest-environment happy-dom

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  CardSurface,
  PaneSurface,
  ShellSurface,
  ViewerSurface,
} from '../../src/renderer/ui/surfaces';

describe('UI surfaces', () => {
  it('provides a semantic shell marker without owning content', () => {
    const html = renderToStaticMarkup(
      createElement(ShellSurface, { className: 'app-shell', 'data-ui-surface-variant': 'workspace' }, 'Shell'),
    );

    expect(html).toContain('<div');
    expect(html).toContain('data-ui-surface="shell"');
    expect(html).toContain('data-ui-surface-variant="workspace"');
    expect(html).toContain('class="ui-surface-shell app-shell"');
  });

  it('keeps pane semantics and caller-owned classes together', () => {
    const html = renderToStaticMarkup(
      createElement(PaneSurface, { 'aria-label': 'Inspector', className: 'inspector-pane' }, 'Pane'),
    );

    expect(html).toContain('<aside');
    expect(html).toContain('data-ui-surface="pane"');
    expect(html).toContain('class="ui-surface-pane inspector-pane"');
  });

  it('supports both non-interactive and button card semantics', () => {
    const divHtml = renderToStaticMarkup(
      createElement(CardSurface, { variant: 'raised' }, 'Card'),
    );
    const buttonHtml = renderToStaticMarkup(
      createElement(CardSurface, { as: 'button', type: 'button', 'aria-pressed': true }, 'Folder'),
    );

    expect(divHtml).toContain('<div');
    expect(divHtml).toContain('data-ui-surface="card"');
    expect(divHtml).toContain('data-ui-surface-variant="raised"');
    expect(buttonHtml).toContain('<button');
    expect(buttonHtml).toContain('aria-pressed="true"');
    expect(buttonHtml).toContain('data-ui-surface="card"');
  });

  it('keeps the viewer as a region while exposing a structural marker', () => {
    const html = renderToStaticMarkup(
      createElement(ViewerSurface, { 'aria-label': 'Preview', role: 'region' }, 'Media'),
    );

    expect(html).toContain('<section');
    expect(html).toContain('data-ui-surface="viewer"');
    expect(html).toContain('role="region"');
  });
});
