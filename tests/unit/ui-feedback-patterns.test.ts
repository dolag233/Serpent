import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';

import {
  Activity,
  Notice,
  StatusBadge,
} from '../../src/renderer/ui/patterns';

test('Notice exposes a tone, live-region semantics, message, and dismiss action', () => {
  const html = renderToStaticMarkup(createElement(Notice, {
    tone: 'warning',
    title: 'Import needs attention',
    message: 'One file was skipped.',
    dismissible: true,
    dismissLabel: 'Dismiss notice',
    onDismiss: () => undefined,
  }));

  expect(html).toContain('data-ui-pattern="notice"');
  expect(html).toContain('data-ui-tone="warning"');
  expect(html).toContain('data-ui-layer="600"');
  expect(html).toContain('role="alert"');
  expect(html).toContain('aria-live="assertive"');
  expect(html).toContain('Import needs attention');
  expect(html).toContain('One file was skipped.');
  expect(html).toContain('aria-label="Dismiss notice"');
  expect(html).toContain('type="button"');
});

test('Activity renders a status region with a determinate progressbar and message', () => {
  const html = renderToStaticMarkup(createElement(Activity, {
    tone: 'info',
    title: 'Importing assets',
    message: 'Reading files…',
    progress: 2,
    max: 4,
    valueText: '2 of 4',
  }));

  expect(html).toContain('data-ui-pattern="activity"');
  expect(html).toContain('data-ui-tone="info"');
  expect(html).toContain('data-ui-layer="500"');
  expect(html).toContain('role="status"');
  expect(html).toContain('aria-live="polite"');
  expect(html).toContain('role="progressbar"');
  expect(html).toContain('aria-valuenow="2"');
  expect(html).toContain('aria-valuemax="4"');
  expect(html).toContain('aria-valuetext="2 of 4"');
  expect(html).toContain('Reading files…');
});

test('Activity can expose an indeterminate progressbar without business state', () => {
  const html = renderToStaticMarkup(createElement(Activity, {
    title: 'Preparing preview',
    indeterminate: true,
    progressAriaLabel: 'Preview preparation progress',
  }));

  expect(html).toContain('role="progressbar"');
  expect(html).toContain('aria-label="Preview preparation progress"');
  expect(html).not.toContain('aria-valuenow=');
  expect(html).toContain('ui-progress--indeterminate');
});

test('StatusBadge shares tone semantics and exposes status role', () => {
  const html = renderToStaticMarkup(createElement(StatusBadge, {
    tone: 'success',
    label: 'Ready',
  }));

  expect(html).toContain('data-ui-pattern="status-badge"');
  expect(html).toContain('data-ui-tone="success"');
  expect(html).toContain('role="status"');
  expect(html).toContain('Ready');
});
