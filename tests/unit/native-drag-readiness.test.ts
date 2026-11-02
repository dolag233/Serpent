import { expect, test } from 'vitest';

import { applyNativeDragReadiness } from '../../src/renderer/use-native-drag-readiness';
import { parseNativeDragReadinessEvent } from '../../src/shared/native-drag-readiness';

test('only Main-validated ids become draggable, and closing a library clears them', () => {
  const empty = new Map<string, ReadonlySet<string>>();
  const one = applyNativeDragReadiness(empty, { type: 'ready', libraryId: 'lib-1', assetIds: ['a'] });
  expect(one.get('lib-1')?.has('a')).toBe(true);
  expect(one.get('lib-1')?.has('b')).toBe(false);
  const two = applyNativeDragReadiness(one, { type: 'ready', libraryId: 'lib-1', assetIds: ['b'] });
  expect([...two.get('lib-1') ?? []]).toEqual(['a', 'b']);
  expect(two.get('lib-1')?.has('a') && two.get('lib-1')?.has('b')).toBe(true);
  expect(applyNativeDragReadiness(two, { type: 'clear', libraryId: 'lib-1' }).get('lib-1')).toBeUndefined();
});

test('drag readiness IPC validates data without accepting paths', () => {
  expect(parseNativeDragReadinessEvent({
    type: 'ready', libraryId: 'lib-1', assetIds: ['a'],
  })).toEqual({ type: 'ready', libraryId: 'lib-1', assetIds: ['a'] });
  expect(() => parseNativeDragReadinessEvent({
    type: 'ready', libraryId: 'lib-1', assetIds: ['a'], absolutePath: 'unexpected',
  })).toThrow();
});
