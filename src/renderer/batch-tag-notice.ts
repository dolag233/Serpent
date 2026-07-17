import type {
  TagOperationSkip,
  TagOperationSkipReason,
} from "../shared/protocol/responses";
import {
  DEFAULT_LOCALE,
  translateForLocale,
  type AppLocale,
} from "./i18n";

/**
 * Notice text for batch tag assign/remove and batch rating (REQ-MENU-007).
 *
 * The worker applies the operation to the eligible assets and reports every
 * skipped id with a stable reason code; this module turns that result into
 * the single-line notice shown after a batch operation. Reason codes map to
 * catalog keys under `batch.*` so locale switching stays consistent.
 */

export type BatchTagAction = "assign" | "remove";

function skipReasonPhrase(reason: string, locale: AppLocale): string {
  if (reason === ("asset_not_found" satisfies TagOperationSkipReason)) {
    return translateForLocale(locale, "batch.assetNotFound");
  }
  return reason;
}

function summarizeSkipped(
  skipped: TagOperationSkip[],
  locale: AppLocale,
): string {
  const countByReason = new Map<string, number>();
  for (const item of skipped) {
    countByReason.set(item.reason, (countByReason.get(item.reason) ?? 0) + 1);
  }
  const join = translateForLocale(locale, "batch.skipJoin");
  return [...countByReason.entries()]
    .map(([reason, count]) =>
      translateForLocale(locale, "batch.skipReasonCount", {
        count,
        reason: skipReasonPhrase(reason, locale),
      }),
    )
    .join(join);
}

function formatBatchNotice(
  actionPhrase: string,
  succeededCount: number,
  skipped: TagOperationSkip[],
  locale: AppLocale,
): string {
  if (skipped.length === 0) {
    return translateForLocale(locale, "batch.success", {
      count: succeededCount,
      action: actionPhrase,
    });
  }
  const skippedSummary = summarizeSkipped(skipped, locale);
  if (succeededCount === 0) {
    return translateForLocale(locale, "batch.noneSucceeded", {
      action: actionPhrase,
      skipped: skippedSummary,
    });
  }
  return translateForLocale(locale, "batch.partial", {
    count: succeededCount,
    action: actionPhrase,
    skipped: skippedSummary,
  });
}

export function formatBatchTagNotice(
  action: BatchTagAction,
  succeededCount: number,
  skipped: TagOperationSkip[],
  locale: AppLocale = DEFAULT_LOCALE,
): string {
  const actionPhrase = translateForLocale(
    locale,
    action === "assign" ? "batch.assignTag" : "batch.removeTag",
  );
  return formatBatchNotice(actionPhrase, succeededCount, skipped, locale);
}

/**
 * Notice text for the batch rating command (REQ-MENU-007). The tag notice's
 * static per-action phrases cannot express "set rating to X 分" vs "clear
 * rating", so rating gets a sibling formatter; sentence scaffolding and skip
 * reason mapping stay shared with the tag notices.
 */
export function formatBatchRatingNotice(
  rating: number,
  succeededCount: number,
  skipped: TagOperationSkip[],
  locale: AppLocale = DEFAULT_LOCALE,
): string {
  const actionPhrase =
    rating > 0
      ? translateForLocale(locale, "batch.setRating", { rating })
      : translateForLocale(locale, "batch.clearRating");
  return formatBatchNotice(actionPhrase, succeededCount, skipped, locale);
}
