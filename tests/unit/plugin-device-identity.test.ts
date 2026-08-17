import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  loadOrCreatePluginDeviceId,
  PLUGIN_DEVICE_ID_FILE_NAME,
} from '../../src/main/plugin-device-identity';

const roots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-plugin-device-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('plugin device identity', () => {
  it('creates a private stable UUID and replaces a malformed identity', async () => {
    const userData = temporaryRoot();
    const first = await loadOrCreatePluginDeviceId(userData);
    const second = await loadOrCreatePluginDeviceId(userData);
    expect(second).toBe(first);
    expect(readFileSync(path.join(userData, PLUGIN_DEVICE_ID_FILE_NAME), 'utf8')).toContain(first);

    writeFileSync(path.join(userData, PLUGIN_DEVICE_ID_FILE_NAME), 'not-a-device-id\n');
    const replacement = await loadOrCreatePluginDeviceId(userData);
    expect(replacement).not.toBe(first);
    expect(replacement).toMatch(/^[0-9a-f-]{36}$/u);
  });
});
