import { describe, expect, it } from 'vitest';

import { shouldEmitCommandCompleted } from '../../src/mcp/command-completed-filter';

describe('shouldEmitCommandCompleted (Serpent-fmbr)', () => {
  it('emits executed non-read commands', () => {
    expect(shouldEmitCommandCompleted('asset.trash', { trashedCount: 1, operationId: 'op' })).toBe(true);
    expect(shouldEmitCommandCompleted('file.import', { status: 'completed', completion: {} })).toBe(true);
    expect(shouldEmitCommandCompleted('tag.create', { id: 't', name: 'x', assetCount: 0 })).toBe(true);
  });

  it('never emits read-only commands', () => {
    expect(shouldEmitCommandCompleted('asset.search', { total: 0, items: [] })).toBe(false);
    expect(shouldEmitCommandCompleted('asset.list', { total: 0, items: [] })).toBe(false);
    expect(shouldEmitCommandCompleted('library.list-open', { libraries: [] })).toBe(false);
    expect(shouldEmitCommandCompleted('ui.notify', { shown: true, mode: 'toast', severity: 'info' })).toBe(false);
    expect(shouldEmitCommandCompleted('execution.status', { status: 'succeeded' })).toBe(false);
  });

  it('never emits unknown commands', () => {
    expect(shouldEmitCommandCompleted('unknown.command', {})).toBe(false);
  });

  it('never emits a phase-1 two-phase challenge report', () => {
    expect(shouldEmitCommandCompleted('asset.delete-permanent', {
      status: 'confirmation-required',
      challengeId: 'ch-1',
      operation: 'asset.delete-permanent',
    })).toBe(false);
  });
});
