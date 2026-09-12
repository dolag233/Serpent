import { catalogs } from "./i18n/catalogs";
import { DEFAULT_LOCALE } from "./i18n/locale-preferences";
import { lookupMessage, type AppLocale } from "./i18n/types";

/** Map jobs.error_code / analyze-unsupported reason to localized text. */
export function messageForAiErrorCode(
  code: string,
  locale: AppLocale = DEFAULT_LOCALE,
): string {
  const lookup = (key: string) =>
    lookupMessage(catalogs[locale], key) ??
    (locale !== DEFAULT_LOCALE
      ? lookupMessage(catalogs[DEFAULT_LOCALE], key)
      : undefined);
  // jobs.error_code can hold a public error code (for example when the Worker
  // refuses a thumbnail for an unsupported media type), which has no
  // error.reason.* entry — fall back to the code's own copy instead of showing
  // the bare identifier.
  return lookup(`error.reason.${code}`) ?? lookup(`error.code.${code}`) ?? code;
}

export function summarizeAiFailureCodes(
  codes: readonly string[],
  locale: AppLocale,
): string {
  if (codes.length === 0) return "";
  return codes.map((code) => messageForAiErrorCode(code, locale)).join("；");
}
