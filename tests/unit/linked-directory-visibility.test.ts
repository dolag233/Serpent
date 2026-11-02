import { expect, it } from 'vitest';

import { linkedDirectoryIgnored } from '../../src/worker/linked-directory-visibility';

it('matches whole directory ancestors literally, including percent and underscore', () => {
  const ignored = linkedDirectoryIgnored(['100%_done', 'Foliage'], () => false);
  expect(ignored('100%_done/nested')).toBe(true);
  expect(ignored('100XXdone')).toBe(false);
  expect(ignored('foliage/nested')).toBe(true);
  expect(ignored('FoliageExtra')).toBe(false);
});

it('includes root ignores and the existing ignore-file matcher', () => {
  expect(linkedDirectoryIgnored([''], () => false)('nested')).toBe(true);
  expect(linkedDirectoryIgnored([], (value) => value.startsWith('.'))('.hidden')).toBe(true);
});
