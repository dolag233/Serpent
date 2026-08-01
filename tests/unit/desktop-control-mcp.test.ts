import { describe, expect, it } from 'vitest';

import {
  desktopControlToolDefinitions,
  desktopControlToolInputSchemas,
} from '../../src/shared/desktop-control';
import { listSerpentMcpTools } from '../../src/mcp/tool-catalog';

describe('Desktop-only MCP tools', () => {
  it('defines the attached Desktop UI control surface', () => {
    expect(desktopControlToolDefinitions.map((tool) => tool.name)).toEqual([
      'serpent_desktop_focus',
      'serpent_desktop_select_assets',
      'serpent_desktop_get_state',
      'serpent_desktop_open_folder',
      'serpent_desktop_set_discovery',
      'serpent_desktop_reveal_asset',
      'serpent_desktop_open_viewer',
      'serpent_desktop_close_viewer',
      'serpent_desktop_navigate_viewer',
    ]);
    expect(
      desktopControlToolInputSchemas.serpent_desktop_select_assets.safeParse({
        assetIds: ['asset-1'],
        mode: 'replace',
      }).success,
    ).toBe(true);
    expect(
      desktopControlToolInputSchemas.serpent_desktop_navigate_viewer.safeParse({
        direction: 'next',
      }).success,
    ).toBe(true);
    expect(
      desktopControlToolInputSchemas.serpent_desktop_set_discovery.safeParse({
        favoriteFilter: 'yes',
        formatFilter: 'png',
        widthRange: { min: '64', max: '1024' },
      }).success,
    ).toBe(true);
  });

  it('does not expose Desktop-only tools through the headless Registry catalog', () => {
    const names = listSerpentMcpTools({ writeAccessGranted: true }).tools.map((tool) => tool.name);
    expect(names).not.toContain('serpent_desktop_focus');
    expect(names).not.toContain('serpent_desktop_select_assets');
    expect(names).not.toContain('serpent_desktop_navigate_viewer');
    expect(names).not.toContain('serpent_desktop_set_discovery');
  });
});
