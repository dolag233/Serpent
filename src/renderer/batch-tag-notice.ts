import type {
  TagOperationSkip,
  TagOperationSkipReason,
} from "../shared/protocol/responses";

/**
 * Notice text for batch tag assign/remove and batch rating (REQ-MENU-007).
 *
 * The worker applies the operation to the eligible assets and reports every
 * skipped id with a stable reason code; this module turns that result into
 * the single-line notice shown after a batch operation. Reason codes are
 * mapped to display phrases in exactly one place (SKIP_REASON_PHRASES) so a
 * future reason only needs one new entry here.
 */

export type BatchTagAction = "assign" | "remove";

const ACTION_PHRASES: Record<BatchTagAction, string> = {
  assign: "添加标签",
  remove: "移除标签",
};

const SKIP_REASON_PHRASES: Record<TagOperationSkipReason, string> = {
  asset_not_found: "资产不存在",
};

function skipReasonPhrase(reason: string): string {
  return SKIP_REASON_PHRASES[reason as TagOperationSkipReason] ?? reason;
}

function summarizeSkipped(skipped: TagOperationSkip[]): string {
  const countByReason = new Map<string, number>();
  for (const item of skipped) {
    countByReason.set(item.reason, (countByReason.get(item.reason) ?? 0) + 1);
  }
  return [...countByReason.entries()]
    .map(([reason, count]) => `${count} 项（${skipReasonPhrase(reason)}）`)
    .join("、");
}

function formatBatchNotice(
  actionPhrase: string,
  succeededCount: number,
  skipped: TagOperationSkip[],
): string {
  if (skipped.length === 0) {
    return `已为 ${succeededCount} 项资产${actionPhrase}。`;
  }
  const skippedSummary = summarizeSkipped(skipped);
  if (succeededCount === 0) {
    return `未能为任何资产${actionPhrase}；跳过 ${skippedSummary}。`;
  }
  return `已为 ${succeededCount} 项资产${actionPhrase}；跳过 ${skippedSummary}。`;
}

export function formatBatchTagNotice(
  action: BatchTagAction,
  succeededCount: number,
  skipped: TagOperationSkip[],
): string {
  return formatBatchNotice(ACTION_PHRASES[action], succeededCount, skipped);
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
): string {
  const actionPhrase = rating > 0 ? `设置评分 ${rating} 分` : "清除评分";
  return formatBatchNotice(actionPhrase, succeededCount, skipped);
}
