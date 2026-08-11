import type { CommandCompletedPayload } from '../shared/command-completed';
import type { AppLocale } from './i18n';
import { translateForLocale } from './i18n';
import { importSummaryMessage } from './import-summary';

export interface AutomationCommandToast {
  message: string;
}

function info(
  locale: AppLocale,
  key: string,
  params?: Record<string, string | number>,
): AutomationCommandToast {
  return { message: translateForLocale(locale, key, params) };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function countOf(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' ? value : undefined;
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
  switch (commandId) {
    case 'file.import': {
      if (result.status !== 'completed' || !isPlainRecord(result.completion)) return undefined;
      const completion = result.completion;
      const importedCount = countOf(completion, 'importedCount');
      const skippedCount = countOf(completion, 'skippedCount');
      const replacedCount = countOf(completion, 'replacedCount');
      if (importedCount === undefined || skippedCount === undefined || replacedCount === undefined) {
        return undefined;
      }
      return { message: importSummaryMessage({ importedCount, skippedCount, replacedCount }, locale) };
    }
    case 'asset.trash': {
      const count = countOf(result, 'trashedCount');
      return count === undefined ? undefined : info(locale, 'toast.batchTrashed', { count });
    }
    case 'asset.delete-permanent': {
      const count = countOf(result, 'deletedCount');
      return count === undefined ? undefined : info(locale, 'toast.assetsDeletedFromDisk', { count });
    }
    case 'asset.move': {
      const count = countOf(result, 'movedCount');
      return count === undefined ? undefined : info(locale, 'toast.movedCount', { count });
    }
    case 'asset.paths.copy':
      return info(locale, 'toast.copyPathDone');
    case 'tag.create': {
      const name = result.name;
      return typeof name === 'string' && name.length > 0
        ? info(locale, 'toast.tagCreated', { name })
        : undefined;
    }
    case 'tag.assign': {
      const count = countOf(result, 'assignedCount');
      return count === undefined ? undefined : info(locale, 'toast.tagsAddedCount', { count });
    }
    case 'tag.remove':
      return info(locale, 'toast.tagRemoved');
    case 'collection.assets.add':
      return info(locale, 'toast.addedToCollection');
    case 'collection.assets.remove':
      return info(locale, 'toast.removedFromCollection');
    default:
      return undefined;
  }
}
