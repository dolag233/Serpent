import type { AppLocale } from "./i18n";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function formatShortDate(
  value: string,
  locale: AppLocale,
  unknownLabel: string,
): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? unknownLabel
    : new Intl.DateTimeFormat(locale, {
        month: "2-digit",
        day: "2-digit",
      }).format(date);
}
