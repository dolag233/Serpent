import { expect, test } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  Button,
  getFieldAriaProps,
  getFieldIds,
  getProgressPercentage,
  normalizeProgressMax,
  getSwitchDescriptionIds,
  isSelectValueAvailable,
  mergeAriaDescribedBy,
  normalizeProgressValue,
  Progress,
  Select,
  Slider,
  Switch,
  TextField,
  Tooltip,
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

test('primitives emit semantic control roles and accessible relationships', () => {
  const html = renderToStaticMarkup(createElement(
    'div',
    null,
    createElement(Button, { variant: 'primary' }, 'Save'),
    createElement(TextField, {
      id: 'asset-name',
      label: 'Asset name',
      description: 'Shown below the preview.',
      error: 'Name is required.',
      value: '',
      readOnly: true,
    }),
    createElement(Switch, {
      id: 'enabled',
      label: 'Enabled',
      checked: true,
      readOnly: true,
    }),
    createElement(Switch, {
      defaultChecked: true,
      id: 'uncontrolled-enabled',
      readOnly: true,
    }),
    createElement(Tooltip, {
      children: createElement(TextField, {
        id: 'tooltip-field',
        label: 'Tooltip field',
        value: '',
        readOnly: true,
      }),
      label: 'Helpful field description',
    }),
    createElement(Select, {
      id: 'mode',
      label: 'Mode',
      value: 'fast',
      options: [{ value: 'fast', label: 'Fast' }],
      onChange: () => undefined,
    }),
    createElement(Progress, {
      label: 'Import',
      value: 1,
      max: 2,
      showValue: true,
    }),
    createElement(Slider, {
      id: 'opacity',
      label: 'Opacity',
      min: 0,
      max: 100,
      value: 50,
      showValue: true,
      valueText: '50%',
    }),
  ));

  expect(html).toContain('type="button"');
  expect(html).toContain('aria-invalid="true"');
  expect(html).toContain('role="switch"');
  expect(html).toContain('aria-checked="true"');
  expect(html).toContain('id="uncontrolled-enabled"');
  expect(html).toContain('data-hover-tip="Helpful field description"');
  expect(html).toContain('role="progressbar"');
  expect(html).toContain('aria-valuenow="1"');
  expect(html).toContain('type="range"');
  expect(html).toContain('aria-valuetext="50%"');
  expect(html).toContain('<output');
});
