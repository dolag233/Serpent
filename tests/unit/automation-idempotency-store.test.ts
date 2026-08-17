import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createJsonFileAutomationIdempotencyStore } from '../../src/main/automation-idempotency-store';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Automation idempotency store', () => {
  it('reopens completed results from the local durable file', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-idempotency-'));
    roots.push(root);
    const filename = path.join(root, 'idempotency.json');
    const record = {
      fingerprint: 'a'.repeat(64),
      result: { ok: true, commandId: 'tag.create', result: { id: 'tag-1' } },
      completedAt: '2026-08-12T00:00:00.000Z',
    };

    createJsonFileAutomationIdempotencyStore(filename).put('credential\u0000library\u0000tag.create\u0001key', record);
    const reopened = createJsonFileAutomationIdempotencyStore(filename);

    expect(reopened.get('credential\u0000library\u0000tag.create\u0001key')).toEqual(record);
  });

  it('drops malformed local state instead of preventing the MCP service from starting', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-idempotency-invalid-'));
    roots.push(root);
    const filename = path.join(root, 'idempotency.json');
    writeFileSync(filename, '{not-json');

    expect(createJsonFileAutomationIdempotencyStore(filename).get('missing')).toBeUndefined();
  });
});
