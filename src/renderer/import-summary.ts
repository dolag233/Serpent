import type { AppLocale } from "./i18n";
import { translateForLocale } from "./i18n";

export function importSummaryMessage(
  value: {
    importedCount: number;
    skippedCount: number;
    replacedCount: number;
  },
  locale: AppLocale,
): string {
  return (
    translateForLocale(locale, "toast.importComplete", {
      imported: value.importedCount,
      replaced: value.replacedCount
        ? translateForLocale(locale, "toast.importReplaced", {
            count: value.replacedCount,
          })
        : "",
    }) +
    (value.skippedCount
      ? translateForLocale(locale, "toast.skippedSuffix", {
          count: value.skippedCount,
        })
      : "") +
    translateForLocale(locale, "common.sentenceEnd")
  );
}
