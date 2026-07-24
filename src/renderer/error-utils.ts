import type {
  PublicError,
  PublicErrorCode,
  PublicErrorReason,
} from "../shared/protocol/errors";
import { catalogs } from "./i18n/catalogs";
import { zhCN } from "./i18n/catalogs/zh-CN";
import { DEFAULT_LOCALE } from "./i18n/locale-preferences";
import { translateForLocale } from "./i18n/LocaleProvider";
import { lookupMessage, type AppLocale } from "./i18n/types";

export class LibraryOperationError extends Error {
  readonly code: PublicError["code"];
  readonly reason?: PublicErrorReason;
  constructor(error: PublicError) {
    super(error.message);
    this.code = error.code;
    this.reason = error.reason;
  }
}

/** zh-CN table kept for call sites that index by code before locale threading. */
export const PUBLIC_ERROR_MESSAGES_ZH: Partial<
  Record<PublicErrorCode, string>
> = zhCN.error.code;

export const PUBLIC_ERROR_REASONS_ZH: Record<PublicErrorReason, string> =
  zhCN.error.reason;

function messageForCode(
  code: PublicErrorCode,
  locale: AppLocale,
): string | undefined {
  return (
    lookupMessage(catalogs[locale], `error.code.${code}`) ??
    (locale !== DEFAULT_LOCALE
      ? lookupMessage(catalogs[DEFAULT_LOCALE], `error.code.${code}`)
      : undefined)
  );
}

function reasonForCode(
  reason: PublicErrorReason,
  locale: AppLocale,
): string | undefined {
  return (
    lookupMessage(catalogs[locale], `error.reason.${reason}`) ??
    (locale !== DEFAULT_LOCALE
      ? lookupMessage(catalogs[DEFAULT_LOCALE], `error.reason.${reason}`)
      : undefined)
  );
}

export function messageForPublicError(
  error: PublicError,
  locale: AppLocale = DEFAULT_LOCALE,
  fallback?: string,
): string {
  const message =
    messageForCode(error.code, locale) ?? fallback ?? error.message;
  const reason = error.reason
    ? reasonForCode(error.reason, locale)
    : undefined;
  return reason
    ? translateForLocale(locale, "error.withReason", { message, reason })
    : message;
}

export function toMessage(
  error: unknown,
  fallback: string,
  locale: AppLocale = DEFAULT_LOCALE,
) {
  if (error instanceof LibraryOperationError) {
    const message = messageForCode(error.code, locale) ?? fallback;
    const reason = error.reason
      ? reasonForCode(error.reason, locale)
      : undefined;
    return reason
      ? translateForLocale(locale, "error.withReason", { message, reason })
      : message;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}
