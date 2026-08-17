import { describe, expect, it } from 'vitest';

import { isPluginSidebarViewsEnabled } from '../../src/renderer/plugin-sidebar-views';

describe('plugin sidebar view availability', () => {
  it('keeps plugin navigation entries available while a folder switch is loading', () => {
    expect(isPluginSidebarViewsEnabled('library-1')).toBe(true);
  });

  it('does not expose plugin navigation entries without an open library', () => {
    expect(isPluginSidebarViewsEnabled(undefined)).toBe(false);
  });
});
