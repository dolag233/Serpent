import { describe, expect, it } from 'vitest';

import { normalizeWebDAVBaseUrl } from '../../src/shared/sync-paths';
import { RemoteStorageError } from '../../src/worker/sync/remote-storage';
import { publicErrorForWorkerFailure } from '../../src/worker/public-error';

describe('normalizeWebDAVBaseUrl (Serpent-fatf)', () => {
  it('keeps valid http/https URLs unchanged', () => {
    expect(normalizeWebDAVBaseUrl('http://10.96.192.48:5005/Share/Serpent')).toEqual({
      ok: true,
      value: 'http://10.96.192.48:5005/Share/Serpent',
    });
    expect(normalizeWebDAVBaseUrl('https://nas.local/dav/share/')).toEqual({
      ok: true,
      value: 'https://nas.local/dav/share/',
    });
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeWebDAVBaseUrl('  http://10.0.0.1/dav/  ')).toEqual({
      ok: true,
      value: 'http://10.0.0.1/dav/',
    });
  });

  it('auto-prepends http:// when the protocol is missing (browser-style input)', () => {
    expect(normalizeWebDAVBaseUrl('10.96.192.48:5005/Share/Serpent')).toEqual({
      ok: true,
      value: 'http://10.96.192.48:5005/Share/Serpent',
    });
    expect(normalizeWebDAVBaseUrl('nas.local/dav/')).toEqual({
      ok: true,
      value: 'http://nas.local/dav/',
    });
  });

  it('rejects empty input', () => {
    expect(normalizeWebDAVBaseUrl('').ok).toBe(false);
    expect(normalizeWebDAVBaseUrl('   ').ok).toBe(false);
  });

  it('rejects unparseable input with a readable error', () => {
    const result = normalizeWebDAVBaseUrl('http：//10.96.192.48:5005');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('http://');
  });

  it('rejects non-http(s) protocols', () => {
    const result = normalizeWebDAVBaseUrl('ftp://nas.local/dav/');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('http');
  });
});

describe('publicErrorForWorkerFailure INVALID_URL mapping (Serpent-fatf)', () => {
  it('maps RemoteStorageError INVALID_URL to SYNC_CONNECTION_FAILED with a SYNC_INVALID_URL reason', () => {
    const error = new RemoteStorageError('INVALID_URL', '服务器地址无效，请以 http:// 或 https:// 开头。');
    const publicError = publicErrorForWorkerFailure(error);
    expect(publicError.code).toBe('SYNC_CONNECTION_FAILED');
    expect(publicError.reason).toBe('SYNC_INVALID_URL');
  });

  it('keeps other RemoteStorageError codes on SYNC_CONNECTION_FAILED + reason', () => {
    const error = new RemoteStorageError('DNS_ERROR', '无法解析服务器地址。');
    const publicError = publicErrorForWorkerFailure(error);
    expect(publicError.code).toBe('SYNC_CONNECTION_FAILED');
    expect(publicError.reason).toBe('SYNC_DNS');
  });
});

describe('publicErrorForWorkerFailure ENOSPC mapping (Serpent-xxx)', () => {
  it('maps a bare ENOSPC write failure to the actionable DISK_FULL code', () => {
    // 打开同步资源库下载内容写盘时磁盘满，Worker 抛裸 fs Error(ENOSPC)。
    const error = Object.assign(new Error('no space left on device, write'), { code: 'ENOSPC' });
    const publicError = publicErrorForWorkerFailure(error);
    expect(publicError.code).toBe('DISK_FULL');
  });

  it('maps EDQUOT to DISK_FULL as well', () => {
    const error = Object.assign(new Error('disk quota exceeded'), { code: 'EDQUOT' });
    const publicError = publicErrorForWorkerFailure(error);
    expect(publicError.code).toBe('DISK_FULL');
  });

  it('still falls back to INTERNAL_ERROR for unrelated bare errors', () => {
    const error = Object.assign(new Error('something exploded'), { code: 'EUNKNOWN' });
    const publicError = publicErrorForWorkerFailure(error);
    expect(publicError.code).toBe('INTERNAL_ERROR');
  });
});
