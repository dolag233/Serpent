import type { CommandCompletedPayload } from '../shared/command-completed';
import type { AppLocale } from './i18n';
import { translateForLocale } from './i18n';
import { importSummaryMessage } from './import-summary';

export interface AutomationCommandToast {
  message: string;
  /** The Worker history entry that produced this toast, if reversible. */
  historyEntryId?: string;
}

function withHistory(message: string, historyEntryId: string | undefined): AutomationCommandToast {
  return historyEntryId === undefined ? { message } : { message, historyEntryId };
}

function info(
  locale: AppLocale,
  key: string,
  params?: Record<string, string | number>,
  historyEntryId?: string,
): AutomationCommandToast {
  return withHistory(translateForLocale(locale, key, params), historyEntryId);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function countOf(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' ? value : undefined;
}

function historyEntryIdOf(record: Record<string, unknown>): string | undefined {
  const value = record.historyEntryId;
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/**
 * Maps one completed automation (MCP) command onto the SAME human-facing
 * toast a manual operation would show (Serpent-fmbr). Commands without a
 * manual toast — reads, metadata writes, library navigation — produce none,
 * and a phase-1 two-phase challenge report is an ok result that executed
 * nothing, so it stays quiet too. There is deliberately no separate MCP
 * notification wording anywhere in this module.
 */
export function automationCommandToast(
  payload: CommandCompletedPayload,
  locale: AppLocale,
): AutomationCommandToast | undefined {
  const { commandId, result } = payload;
  if (!isPlainRecord(result)) return undefined;
  if (result.status === 'confirmation-required') return undefined;
  const historyEntryId = historyEntryIdOf(result);
  switch (commandId) {
    case 'file.import': {
      if (result.status !== 'completed' || !isPlainRecord(result.completion)) return undefined;
      const completion = result.completion;
      const importedCount = countOf(completion, 'importedCount');
      const assetCount = countOf(completion, 'assetCount');
      const skippedCount = countOf(completion, 'skippedCount');
      const replacedCount = countOf(completion, 'replacedCount');
      if (importedCount === undefined || skippedCount === undefined || replacedCount === undefined) {
        return undefined;
      }
      return withHistory(
        importSummaryMessage({
          importedCount,
          // Serpent-1y9r: prefer logical asset units (a detected image
          // sequence counts as 1) when the completion carries them.
          ...(assetCount !== undefined ? { assetCount } : {}),
          skippedCount,
          replacedCount,
        }, locale),
        historyEntryId,
      );
    }
    case 'asset.trash': {
      const count = countOf(result, 'trashedCount');
      return count === undefined ? undefined : info(locale, 'toast.batchTrashed', { count }, historyEntryId);
    }
    case 'asset.delete-permanent': {
      const count = countOf(result, 'deletedCount');
      return count === undefined ? undefined : info(locale, 'toast.assetsDeletedFromDisk', { count }, historyEntryId);
    }
    case 'asset.move': {
      const count = countOf(result, 'movedCount');
      return count === undefined ? undefined : info(locale, 'toast.movedCount', { count }, historyEntryId);
    }
    case 'asset.paths.copy':
      return info(locale, 'toast.copyPathDone', undefined, historyEntryId);
    case 'tag.create': {
      const name = result.name;
      return typeof name === 'string' && name.length > 0
        ? info(locale, 'toast.tagCreated', { name }, historyEntryId)
        : undefined;
    }
    case 'tag.assign': {
      const count = countOf(result, 'assignedCount');
      return count === undefined ? undefined : info(locale, 'toast.tagsAddedCount', { count }, historyEntryId);
    }
    case 'tag.remove':
      return info(locale, 'toast.tagRemoved', undefined, historyEntryId);
    case 'collection.assets.add':
      return info(locale, 'toast.addedToCollection', undefined, historyEntryId);
    case 'collection.assets.remove':
      return info(locale, 'toast.removedFromCollection', undefined, historyEntryId);
    default:
      return undefined;
  }
}
