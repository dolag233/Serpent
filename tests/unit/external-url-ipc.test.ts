import { expect, test } from 'vitest';

import {
  parseOpenExternalUrlResult,
  resolveOpenExternalUrlTarget,
  toOpenableExternalUrl,
} from '../../src/shared/external-url';
import { tryParseActiveContext } from '../../src/shared/protocol/requests';

test('toOpenableExternalUrl accepts bare http(s) without credentials', () => {
  expect(toOpenableExternalUrl('https://example.com/path')).toBe('https://example.com/path');
  expect(toOpenableExternalUrl('http://example.com')).toBe('http://example.com/');
});

test('toOpenableExternalUrl rejects credentials, non-http, and junk', () => {
  expect(toOpenableExternalUrl('https://user:pass@example.com')).toBeNull();
  expect(toOpenableExternalUrl('file:///tmp/x')).toBeNull();
  expect(toOpenableExternalUrl(' javascript:alert(1)')).toBeNull();
  expect(toOpenableExternalUrl('')).toBeNull();
});

test('resolveOpenExternalUrlTarget distinguishes malformed vs rejected', () => {
  expect(resolveOpenExternalUrlTarget(null)).toEqual({ ok: false, code: 'malformed_request' });
  expect(resolveOpenExternalUrlTarget({ url: '' })).toEqual({
    ok: false,
    code: 'malformed_request',
  });
  expect(resolveOpenExternalUrlTarget({ url: 'ftp://example.com' })).toEqual({
    ok: false,
    code: 'rejected_url',
  });
  expect(resolveOpenExternalUrlTarget({ url: 'https://user:secret@host/' })).toEqual({
    ok: false,
    code: 'rejected_url',
  });
  expect(resolveOpenExternalUrlTarget({ url: 'https://example.com/a' })).toEqual({
    ok: true,
    url: 'https://example.com/a',
  });
});

test('parseOpenExternalUrlResult accepts structured results and legacy booleans', () => {
  expect(parseOpenExternalUrlResult({ ok: true })).toEqual({ ok: true });
  expect(parseOpenExternalUrlResult({ ok: false, code: 'rejected_url' })).toEqual({
    ok: false,
    code: 'rejected_url',
  });
  expect(parseOpenExternalUrlResult(true)).toEqual({ ok: true });
  expect(parseOpenExternalUrlResult(false)).toEqual({ ok: false, code: 'shell_failure' });
  expect(parseOpenExternalUrlResult({ ok: false, code: 'not-a-code' })).toEqual({
    ok: false,
    code: 'shell_failure',
  });
});

test('tryParseActiveContext reports issue paths without echoing payload values', () => {
  expect(tryParseActiveContext({ libraryId: 'lib-1', selectedFolderId: undefined })).toEqual({
    ok: true,
    context: { libraryId: 'lib-1' },
  });

  const failed = tryParseActiveContext({
    libraryId: 42,
    selectedFolderId: '../escape',
    extra: 'drop-me',
  });
  expect(failed.ok).toBe(false);
  if (failed.ok) throw new Error('expected malformed');
  expect(failed.code).toBe('malformed');
  expect(failed.issuePaths.length).toBeGreaterThan(0);
  expect(JSON.stringify(failed)).not.toContain('../escape');
  expect(JSON.stringify(failed)).not.toContain('drop-me');
});
