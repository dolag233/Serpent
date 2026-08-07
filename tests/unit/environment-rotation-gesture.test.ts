import { describe, expect, it } from 'vitest';

import {
  environmentYawDelta,
  startsEnvironmentRotation,
} from '../../src/renderer/3d-viewer/environment-rotation-gesture';

describe('HDRI environment rotation gesture', () => {
  it('accepts right-drag and Ctrl+left-drag', () => {
    expect(startsEnvironmentRotation({ button: 2, ctrlKey: false })).toBe(true);
    expect(startsEnvironmentRotation({ button: 0, ctrlKey: true })).toBe(true);
  });

  it('does not take over an ordinary left drag', () => {
    expect(startsEnvironmentRotation({ button: 0, ctrlKey: false })).toBe(false);
  });

  it('converts horizontal movement into environment yaw', () => {
    expect(environmentYawDelta(200, 240)).toBeCloseTo(-0.2);
    expect(environmentYawDelta(240, 200)).toBeCloseTo(0.2);
  });
});
