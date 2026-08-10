import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { McpSettingsStore } from '../../src/main/mcp-settings-store';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('MCP settings store', () => {
  it('does not expose the removed device-level skip-approval preference', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-mcp-settings-'));
    roots.push(root);
    const store = new McpSettingsStore(root);

    expect(store.preferences).toEqual({ enabled: false, autoStart: false, port: 47342 });
  });

  it('migrates a pre-toggle settings file without resetting existing preferences', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-mcp-settings-'));
    roots.push(root);
    mkdirSync(root, { recursive: true });
    writeFileSync(path.join(root, 'mcp-settings.json'), JSON.stringify({
      version: 1,
      preferences: { enabled: true, autoStart: true, skipApproval: true, port: 47342 },
    }));

    const store = new McpSettingsStore(root);
    expect(store.preferences).toEqual({
      enabled: true,
      autoStart: true,
      port: 47342,
    });
  });
});
