import type { AppLocale } from "./i18n";

// Serpent-4bdd26 收编 codex/large-library-performance@3f56d3df：Intl.DateTimeFormat
// 构造昂贵，而资产卡片每次渲染都会格式化日期。按 locale 缓存 formatter。
const shortDateFormatters = new Map<AppLocale, Intl.DateTimeFormat>();

function shortDateFormatter(locale: AppLocale): Intl.DateTimeFormat {
  const cached = shortDateFormatters.get(locale);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
  });
  shortDateFormatters.set(locale, formatter);
  return formatter;
}

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
    : shortDateFormatter(locale).format(date);
}
