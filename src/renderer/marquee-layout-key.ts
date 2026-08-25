import type { CanvasPreferences } from "./canvas-preferences";

export interface MarqueeLayoutKeyInput {
  readonly viewMode: CanvasPreferences["viewMode"];
  readonly cardSize: number;
  readonly masonryGridWidth: number;
  readonly fields: CanvasPreferences["fields"];
  readonly assetIds: readonly string[];
  readonly folderIds: readonly string[];
}

/**
 * Identifies every renderer state that can change a card's marquee geometry
 * without changing the canvas element's own client dimensions.
 */
export function buildMarqueeLayoutKey(input: MarqueeLayoutKeyInput): string {
  return JSON.stringify([
    input.viewMode,
    input.cardSize,
    input.masonryGridWidth,
    input.fields.name,
    input.fields.size,
    input.fields.date,
    input.fields.dimensions,
    input.fields.badgeType,
    input.fields.badgeDuration,
    input.fields.badgeSource,
    input.fields.badgeExtension,
    input.assetIds,
    input.folderIds,
  ]);
}
