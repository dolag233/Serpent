import { expect, test } from 'vitest';

import {
  getFieldAriaProps,
  getFieldIds,
  getProgressPercentage,
  normalizeProgressMax,
  getSwitchDescriptionIds,
  isSelectValueAvailable,
  mergeAriaDescribedBy,
  normalizeProgressValue,
} from '../../src/renderer/ui/primitives';

test('cx/ARIA helpers omit empty values and preserve description order', () => {
  expect(mergeAriaDescribedBy(undefined, 'description', '', 'error')).toBe('description error');
  expect(mergeAriaDescribedBy(undefined, '')).toBeUndefined();

  const ids = getFieldIds('asset-name');
  expect(ids).toEqual({
    controlId: 'asset-name',
    descriptionId: 'asset-name-description',
    errorId: 'asset-name-error',
  });
  expect(getFieldAriaProps(ids, { hasDescription: true, hasError: true })).toEqual({
    'aria-describedby': 'asset-name-description asset-name-error',
    'aria-errormessage': 'asset-name-error',
    'aria-invalid': true,
  });
});

test('switch description contract uses the same field ids as other controls', () => {
  expect(getSwitchDescriptionIds('enabled', { hasDescription: true, hasError: true }))
    .toBe('enabled-description enabled-error');
  expect(getSwitchDescriptionIds('enabled', {})).toBeUndefined();
});

test('progress values are bounded and indeterminate values have no percentage', () => {
  expect(normalizeProgressValue(-2, 10)).toBe(0);
  expect(normalizeProgressValue(12, 10)).toBe(10);
  expect(normalizeProgressValue(undefined, 10)).toBeUndefined();
  expect(normalizeProgressMax(0)).toBe(100);
  expect(normalizeProgressMax(20)).toBe(20);
  expect(getProgressPercentage(1, 3)).toBe(33);
  expect(getProgressPercentage(100, 0)).toBeUndefined();
});

test('select availability excludes disabled options', () => {
  const options = [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark', disabled: true },
  ] as const;
  expect(isSelectValueAvailable('light', options)).toBe(true);
  expect(isSelectValueAvailable('dark', options)).toBe(false);
  expect(isSelectValueAvailable('system', options)).toBe(false);
});
