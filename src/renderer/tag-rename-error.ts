import type { AppLocale } from './i18n';
import { translateForLocale } from './i18n';
import { LibraryOperationError, toMessage } from './error-utils';

export function tagRenameError(error: unknown, locale: AppLocale): string {
  if (error instanceof LibraryOperationError && error.code === 'FOLDER_ALREADY_EXISTS') {
    return translateForLocale(locale, 'toast.tagNameConflict');
  }
  return toMessage(error, translateForLocale(locale, 'toast.renameTagFailed'), locale);
}
