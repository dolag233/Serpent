import type { AppLocale } from "./i18n";
import { translateForLocale } from "./i18n";

export function importSummaryMessage(
  value: {
    importedCount: number;
    /** Logical asset units: a detected image sequence counts as 1 (Serpent-1y9r). */
    assetCount?: number;
    skippedCount: number;
    replacedCount: number;
  },
  locale: AppLocale,
): string {
  const imported = value.assetCount ?? value.importedCount;
  return (
    translateForLocale(locale, "toast.importComplete", {
      imported,
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
