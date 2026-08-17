import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createArtifactResponse, parseByteRange } from '../../src/main/artifact-response';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('artifact protocol byte ranges', () => {
  it('parses bounded, open-ended and suffix ranges', () => {
    expect(parseByteRange('bytes=2-5', 10)).toEqual({ start: 2, end: 5 });
    expect(parseByteRange('bytes=7-', 10)).toEqual({ start: 7, end: 9 });
    expect(parseByteRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 });
  });

  it('rejects multi-ranges and unsatisfiable ranges', () => {
    expect(parseByteRange('bytes=0-1,4-5', 10)).toBeNull();
    expect(parseByteRange('bytes=10-', 10)).toBeNull();
    expect(parseByteRange('items=0-1', 10)).toBeNull();
  });

  it('returns a seekable partial response without exposing the source path', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-artifact-response-'));
    roots.push(root);
    const filePath = path.join(root, 'proxy.webm');
    writeFileSync(filePath, Buffer.from('0123456789'));

    const response = createArtifactResponse(filePath, 'video/webm', 'bytes=3-6');

    expect(response.status).toBe(206);
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(response.headers.get('content-range')).toBe('bytes 3-6/10');
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('3456');
    expect(JSON.stringify([...response.headers])).not.toContain(filePath);
  });

  it('returns 416 for an unsatisfiable range', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-artifact-response-'));
    roots.push(root);
    const filePath = path.join(root, 'proxy.webm');
    writeFileSync(filePath, Buffer.from('0123456789'));

    const response = createArtifactResponse(filePath, 'video/webm', 'bytes=99-');
    expect(response.status).toBe(416);
    expect(response.headers.get('content-range')).toBe('bytes */10');
  });

  it('refuses to open a symbolic-link artifact at the final read boundary', () => {
    if (process.platform === 'win32') return;
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-artifact-response-'));
    roots.push(root);
    const outsidePath = path.join(root, 'outside.txt');
    const linkPath = path.join(root, 'proxy.webm');
    writeFileSync(outsidePath, 'secret');
    symlinkSync(outsidePath, linkPath);

    expect(() => createArtifactResponse(linkPath, 'video/webm')).toThrow();
  });

  it('accepts an AbortSignal without treating cancel as a stream fault', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-artifact-response-'));
    roots.push(root);
    const filePath = path.join(root, 'proxy.webm');
    writeFileSync(filePath, Buffer.alloc(256 * 1024, 7));

    const controller = new AbortController();
    const streamErrors: Error[] = [];
    const response = createArtifactResponse(filePath, 'video/webm', {
      rangeHeader: 'bytes=0-65535',
      signal: controller.signal,
      onStreamError: (error) => {
        streamErrors.push(error);
      },
    });

    expect(response.status).toBe(206);
    controller.abort();
    // Consume may reject after abort; either outcome is fine as long as we
    // do not report a protocol stream fault for the cancel path.
    try {
      await response.arrayBuffer();
    } catch {
      // expected when the consumer is cancelled mid-read
    }
    expect(streamErrors).toEqual([]);
  });
});
