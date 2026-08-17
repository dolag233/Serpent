import { catalogs } from "./i18n/catalogs";
import { DEFAULT_LOCALE } from "./i18n/locale-preferences";
import { lookupMessage, type AppLocale } from "./i18n/types";

/** Map jobs.error_code / analyze-unsupported reason to localized text. */
export function messageForAiErrorCode(
  code: string,
  locale: AppLocale = DEFAULT_LOCALE,
): string {
  const key = `error.reason.${code}`;
  return (
    lookupMessage(catalogs[locale], key) ??
    (locale !== DEFAULT_LOCALE
      ? lookupMessage(catalogs[DEFAULT_LOCALE], key)
      : undefined) ??
    code
  );
}

export function summarizeAiFailureCodes(
  codes: readonly string[],
  locale: AppLocale,
): string {
  if (codes.length === 0) return "";
  return codes.map((code) => messageForAiErrorCode(code, locale)).join("；");
}
