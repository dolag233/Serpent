import { describe, expect, it } from 'vitest';

import {
  desktopControlToolDefinitions,
  desktopControlToolInputSchemas,
} from '../../src/shared/desktop-control';
import { listSerpentMcpTools } from '../../src/mcp/tool-catalog';

describe('Desktop-only MCP tools', () => {
  it('defines only the two narrow attached UI controls', () => {
    expect(desktopControlToolDefinitions.map((tool) => tool.name)).toEqual([
      'serpent_desktop_focus',
      'serpent_desktop_select_assets',
    ]);
    expect(
      desktopControlToolInputSchemas.serpent_desktop_select_assets.safeParse({
        assetIds: ['asset-1'],
        mode: 'replace',
      }).success,
    ).toBe(true);
  });

  it('does not expose Desktop-only tools through the headless Registry catalog', () => {
    const names = listSerpentMcpTools({ writeAccessGranted: true }).tools.map((tool) => tool.name);
    expect(names).not.toContain('serpent_desktop_focus');
    expect(names).not.toContain('serpent_desktop_select_assets');
  });
});
