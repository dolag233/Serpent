import { describe, expect, it } from 'vitest';

import { automationCommandToast } from '../../src/renderer/automation-command-toast';
import type { CommandCompletedPayload } from '../../src/shared/command-completed';

const zh = 'zh-CN';
const en = 'en';

function payload(commandId: string, result: unknown): CommandCompletedPayload {
  return { commandId, result };
}

describe('automationCommandToast (Serpent-fmbr)', () => {
  it('shows the same import summary toast as a manual import', () => {
    const toast = automationCommandToast(payload('file.import', {
      status: 'completed',
      completion: { importedCount: 3, skippedCount: 1, replacedCount: 0, assetCount: 3, fileCount: 4, assets: [] },
    }), zh);
    expect(toast).not.toBeUndefined();
    expect(toast!.message).toContain('3');
    expect(toast!.message).toContain('跳过');
  });

  it('translates the import toast for English', () => {
    const toast = automationCommandToast(payload('file.import', {
      status: 'completed',
      completion: { importedCount: 2, skippedCount: 0, replacedCount: 1, assetCount: 2, fileCount: 2, assets: [] },
    }), en);
    expect(toast).not.toBeUndefined();
    expect(toast!.message).toContain('2');
    expect(toast!.message).toContain('replaced');
  });

  it('stays quiet when the import reported conflicts instead of completing', () => {
    expect(automationCommandToast(payload('file.import', {
      status: 'conflicts',
      plan: { conflicts: [] },
    }), zh)).toBeUndefined();
  });

  it('stays quiet for a malformed import result', () => {
    expect(automationCommandToast(payload('file.import', {
      status: 'completed',
      completion: { importedCount: 'many' },
    }), zh)).toBeUndefined();
  });

  it('maps asset.trash onto the manual trash toast', () => {
    const toast = automationCommandToast(payload('asset.trash', { trashedCount: 4, operationId: 'op-1' }), zh);
    expect(toast).not.toBeUndefined();
    expect(toast!.message).toContain('4');
    expect(toast!.message).toContain('回收站');
  });

  it('keeps the committed history id so the desktop undo action targets this MCP operation', () => {
    const toast = automationCommandToast(payload('asset.trash', {
      trashedCount: 1,
      historyEntryId: 'history-mcp-1',
    }), zh);
    expect(toast?.historyEntryId).toBe('history-mcp-1');
  });

  it('maps asset.delete-permanent onto the manual disk-delete toast', () => {
    const toast = automationCommandToast(payload('asset.delete-permanent', {
      deletedCount: 2,
      skippedCount: 0,
      skippedReasons: [],
    }), zh);
    expect(toast).not.toBeUndefined();
    expect(toast!.message).toContain('2');
    expect(toast!.message).toContain('硬盘');
  });

  it('maps asset.move onto the manual move toast', () => {
    const toast = automationCommandToast(payload('asset.move', { movedCount: 5, skippedCount: 0, operationId: null }), en);
    expect(toast).not.toBeUndefined();
    expect(toast!.message).toContain('5');
    expect(toast!.message).toContain('Moved');
  });

  it('maps asset.paths.copy onto the manual copy-path toast', () => {
    const toast = automationCommandToast(payload('asset.paths.copy', { copiedCount: 1 }), zh);
    expect(toast).not.toBeUndefined();
    expect(toast!.message).toContain('路径已复制');
  });

  it('maps tag.create onto the manual tag-created toast with the tag name', () => {
    const toast = automationCommandToast(payload('tag.create', { id: 't-1', name: '概念设计', assetCount: 0 }), zh);
    expect(toast).not.toBeUndefined();
    expect(toast!.message).toContain('概念设计');
  });

  it('maps tag.assign and tag.remove onto the manual tag toasts', () => {
    const assigned = automationCommandToast(payload('tag.assign', { assignedCount: 6, skipped: [] }), zh);
    expect(assigned!.message).toContain('6');
    const removed = automationCommandToast(payload('tag.remove', { removedCount: 1, skipped: [] }), zh);
    expect(removed!.message).toContain('标签已移除');
  });

  it('maps collection membership changes onto the manual collection toasts', () => {
    const added = automationCommandToast(payload('collection.assets.add', { collectionId: 'c-1' }), zh);
    expect(added!.message).toContain('合集');
    const removed = automationCommandToast(payload('collection.assets.remove', { collectionId: 'c-1' }), zh);
    expect(removed!.message).toContain('合集');
  });

  it('never shows a toast for a phase-1 two-phase challenge report', () => {
    expect(automationCommandToast(payload('asset.trash', {
      status: 'confirmation-required',
      challengeId: 'ch-1',
      operation: 'asset.trash',
    }), zh)).toBeUndefined();
  });

  it('never shows a toast for reads or unmapped commands', () => {
    expect(automationCommandToast(payload('asset.search', { total: 10, items: [] }), zh)).toBeUndefined();
    expect(automationCommandToast(payload('library.open', { libraryId: 'lib-1' }), zh)).toBeUndefined();
    expect(automationCommandToast(payload('unknown.command', {}), zh)).toBeUndefined();
  });

  it('never shows a toast for null or non-object results', () => {
    expect(automationCommandToast(payload('asset.trash', null), zh)).toBeUndefined();
    expect(automationCommandToast(payload('asset.trash', 'string'), zh)).toBeUndefined();
    expect(automationCommandToast(payload('asset.trash', [1, 2]), zh)).toBeUndefined();
  });
});
