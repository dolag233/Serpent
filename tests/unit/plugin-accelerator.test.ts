import { describe, expect, it } from 'vitest';

import {
  findReservedAcceleratorConflict,
  parseElectronAccelerator,
} from '../../src/shared/plugin-accelerator';

describe('plugin-accelerator', () => {
  it('parses function keys without modifiers', () => {
    expect(parseElectronAccelerator('F9', 'mac')).toMatchObject({ key: 'F9' });
    expect(parseElectronAccelerator('F9', 'windows')).toMatchObject({ key: 'F9' });
  });

  it('maps CmdOrCtrl to platform modifiers', () => {
    expect(parseElectronAccelerator('CmdOrCtrl+Shift+K', 'mac')).toMatchObject({
      key: 'k',
      metaKey: true,
      shiftKey: true,
    });
    expect(parseElectronAccelerator('CmdOrCtrl+Shift+K', 'windows')).toMatchObject({
      key: 'k',
      ctrlKey: true,
      shiftKey: true,
    });
  });

  it('detects collisions with core Serpent shortcuts', () => {
    expect(findReservedAcceleratorConflict('CmdOrCtrl+F')).toBe('workspace.focus-search');
    expect(findReservedAcceleratorConflict('F9')).toBeNull();
  });
});
