import { describe, expect, it } from 'vitest';

import {
  DEFAULT_INSPECTOR_PANEL_WIDTH,
  DEFAULT_NAV_PANEL_WIDTH,
  DEFAULT_SHELL_PREFERENCES,
  INSPECTOR_PANEL_WIDTH_MAX,
  INSPECTOR_PANEL_WIDTH_MIN,
  NAV_PANEL_WIDTH_MAX,
  NAV_PANEL_WIDTH_MIN,
  SHELL_PREF_KEY,
  clampInspectorPanelWidth,
  clampNavPanelWidth,
  loadShellPreferences,
  saveShellPreferences,
  type ShellPreferencesStorage,
} from '../../src/renderer/shell-preferences';
import { resolvePanelWidth } from '../../src/renderer/use-panel-resize';

function memoryStorage(initial?: Record<string, string>): ShellPreferencesStorage & {
  data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial ?? {}));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

describe('shell-preferences (REQ-SHELL-007)', () => {
  it('returns defaults when nothing is stored', () => {
    expect(loadShellPreferences(memoryStorage())).toEqual(DEFAULT_SHELL_PREFERENCES);
  });

  it('round-trips valid widths through storage', () => {
    const storage = memoryStorage();
    saveShellPreferences(
      { version: 1, navPanelWidth: 300, inspectorPanelWidth: 320 },
      storage,
    );
    expect(loadShellPreferences(storage)).toEqual({
      version: 1,
      navPanelWidth: 300,
      inspectorPanelWidth: 320,
    });
  });

  it('clamps widths to the panel ranges on save', () => {
    const storage = memoryStorage();
    saveShellPreferences(
      { version: 1, navPanelWidth: 10, inspectorPanelWidth: 9999 },
      storage,
    );
    expect(loadShellPreferences(storage)).toEqual({
      version: 1,
      navPanelWidth: NAV_PANEL_WIDTH_MIN,
      inspectorPanelWidth: INSPECTOR_PANEL_WIDTH_MAX,
    });
  });

  it('falls back to defaults on corrupt JSON', () => {
    const storage = memoryStorage({ [SHELL_PREF_KEY]: '{nope' });
    expect(loadShellPreferences(storage)).toEqual(DEFAULT_SHELL_PREFERENCES);
  });

  it('falls back to defaults on out-of-range or wrong-version stored values', () => {
    for (const bad of [
      JSON.stringify({ version: 2, navPanelWidth: 300, inspectorPanelWidth: 300 }),
      JSON.stringify({ version: 1, navPanelWidth: 1, inspectorPanelWidth: 300 }),
      JSON.stringify({ version: 1, navPanelWidth: 300 }),
      JSON.stringify('navPanelWidth'),
    ]) {
      expect(loadShellPreferences(memoryStorage({ [SHELL_PREF_KEY]: bad }))).toEqual(
        DEFAULT_SHELL_PREFERENCES,
      );
    }
  });

  it('clamp helpers bound both ranges', () => {
    expect(clampNavPanelWidth(0)).toBe(NAV_PANEL_WIDTH_MIN);
    expect(clampNavPanelWidth(9999)).toBe(NAV_PANEL_WIDTH_MAX);
    expect(clampNavPanelWidth(250.6)).toBe(251);
    expect(clampInspectorPanelWidth(0)).toBe(INSPECTOR_PANEL_WIDTH_MIN);
    expect(clampInspectorPanelWidth(9999)).toBe(INSPECTOR_PANEL_WIDTH_MAX);
  });

  // Serpent-y941: Inspector min matches nav so users can free canvas width.
  it('allows inspector widths down to 200px (same floor as nav)', () => {
    expect(INSPECTOR_PANEL_WIDTH_MIN).toBe(200);
    expect(clampInspectorPanelWidth(200)).toBe(200);
    expect(clampInspectorPanelWidth(199)).toBe(200);
    const storage = memoryStorage();
    saveShellPreferences(
      { version: 1, navPanelWidth: 224, inspectorPanelWidth: 200 },
      storage,
    );
    expect(loadShellPreferences(storage).inspectorPanelWidth).toBe(200);
  });
});

describe('resolvePanelWidth (REQ-SHELL-007 drag math)', () => {
  it('widens the nav pane when dragging right, narrows when dragging left', () => {
    expect(resolvePanelWidth('nav', DEFAULT_NAV_PANEL_WIDTH, 40)).toBe(
      DEFAULT_NAV_PANEL_WIDTH + 40,
    );
    expect(resolvePanelWidth('nav', DEFAULT_NAV_PANEL_WIDTH, -24)).toBe(
      DEFAULT_NAV_PANEL_WIDTH - 24,
    );
  });

  it('widens the inspector pane when dragging left (left-edge handle)', () => {
    expect(resolvePanelWidth('inspector', 400, -40)).toBe(440);
    expect(resolvePanelWidth('inspector', 400, 32)).toBe(368);
    expect(resolvePanelWidth('inspector', DEFAULT_INSPECTOR_PANEL_WIDTH, 80)).toBe(
      INSPECTOR_PANEL_WIDTH_MIN,
    );
  });

  it('clamps at both ends instead of following the pointer', () => {
    expect(resolvePanelWidth('nav', DEFAULT_NAV_PANEL_WIDTH, 9999)).toBe(NAV_PANEL_WIDTH_MAX);
    expect(resolvePanelWidth('nav', DEFAULT_NAV_PANEL_WIDTH, -9999)).toBe(NAV_PANEL_WIDTH_MIN);
    expect(resolvePanelWidth('inspector', DEFAULT_INSPECTOR_PANEL_WIDTH, -9999)).toBe(
      INSPECTOR_PANEL_WIDTH_MAX,
    );
    expect(resolvePanelWidth('inspector', DEFAULT_INSPECTOR_PANEL_WIDTH, 9999)).toBe(
      INSPECTOR_PANEL_WIDTH_MIN,
    );
  });
});
