/**
 * Per-card caption band sizing (Serpent-b1b0f2).
 *
 * A card must only reserve the caption lines it really renders. A file whose
 * pixel size was never decoded (undecoded raw, documents, audio) shows
 * no resolution line, so reserving one always left an empty strip under such a
 * card - and in tiled rows it made the whole row taller.
 *
 * The band is derived from the same predicate the caption renderer uses
 * (`shouldShowGridDimensions`), so layout geometry and card content cannot
 * drift apart:
 *
 * - waterfall (masonry): every card carries its own band, so a card without
 *   resolution is genuinely shorter;
 * - tiled rows (justified): a row uses the tallest band of its own cards, so a
 *   row whose assets all lack resolution shrinks.
 */

import { shouldShowGridDimensions } from "./canvas-preferences";
import {
  resolveJustifiedCaptionBandPx,
  type JustifiedCaptionLines,
} from "./justified-caption-band";

/** Caption field toggles (the four that live under the card, not the badges). */
export type CardCaptionFields = {
  readonly name: boolean;
  readonly size: boolean;
  readonly date: boolean;
  readonly dimensions: boolean;
};

/**
 * The asset facts a caption band depends on. Kept structural (instead of
 * `BrowseLayoutEntry`) so geometry helpers can pass sparse entries.
 */
export type CaptionBandAsset = {
  readonly width?: number | null;
  readonly height?: number | null;
  readonly mediaType?: string | null;
  readonly relativeFilePath?: string | null;
};

/**
 * A fixed band (legacy callers) or one resolved per asset. Geometry builders
 * accept either so numeric caption bands keep working.
 */
export type CaptionBandSource = number | ((asset: CaptionBandAsset) => number);

export type CaptionBandMode = "masonry" | "justified";

export function cardCaptionShowsAnything(fields: CardCaptionFields): boolean {
  return fields.name || fields.size || fields.date || fields.dimensions;
}

/**
 * Caption lines this asset will actually render.
 *
 * `dimensions` follows the renderer exactly: it needs the toggle, a decoded
 * width/height, and a pixel media type (image / video / GIF). A search snippet
 * replaces the size/date row, so it still counts as one secondary line.
 *
 * An entry that says nothing about the media type is a geometry placeholder
 * (an index position whose summary has not arrived). It keeps reserving the
 * resolution line instead of shrinking: shrinking first and growing later would
 * change 100k-position scrollbar geometry page by page (CANVAS-038).
 */
export function resolveCardCaptionLines(
  fields: CardCaptionFields,
  asset: CaptionBandAsset = {},
  options: { snippetLine?: boolean } = {},
): JustifiedCaptionLines {
  const mediaKnown = asset.mediaType != null
    || (asset.relativeFilePath != null && asset.relativeFilePath.trim().length > 0);
  return {
    dimensions: fields.dimensions && (
      mediaKnown
        ? shouldShowGridDimensions(
            { dimensions: fields.dimensions },
            "grid",
            asset.width ?? null,
            asset.height ?? null,
            {
              mediaType: asset.mediaType ?? null,
              sourceName: asset.relativeFilePath ?? null,
            },
          )
        : true
    ),
    name: fields.name,
    secondary: fields.size || fields.date || options.snippetLine === true,
  };
}

/**
 * Masonry caption metrics, mirroring `.masonry-card-slot .asset-caption`:
 * 7px top + 4px bottom padding, an 11px name line, a 9px meta line and an 11px
 * resolution line at the default typography tier. A two-line band equals
 * `MASONRY_CAPTION_BAND_PX` (38) and a three-line band equals
 * `MASONRY_DIMENSIONS_CAPTION_BAND_PX` (52); a unit test locks that equality so
 * the constants cannot silently drift.
 */
export const MASONRY_CAPTION_PAD_PX = 11;
export const MASONRY_CAPTION_DIMENSIONS_LINE_PX = 14;
export const MASONRY_CAPTION_NAME_LINE_PX = 14;
export const MASONRY_CAPTION_SECONDARY_LINE_PX = 12;

export function resolveMasonryCaptionBandPx(
  lines: JustifiedCaptionLines,
  fontScale = 1,
): number {
  const scale = Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1;
  const heights: number[] = [];
  if (lines.dimensions) heights.push(MASONRY_CAPTION_DIMENSIONS_LINE_PX);
  if (lines.name) heights.push(MASONRY_CAPTION_NAME_LINE_PX);
  if (lines.secondary) heights.push(MASONRY_CAPTION_SECONDARY_LINE_PX);
  if (heights.length === 0) return 0;
  const content = heights.reduce((sum, height) => sum + height, 0);
  // Multi-line captions round up once, which is what the audited 42/56
  // constants encode.
  const rounding = heights.length > 1 ? 1 : 0;
  return Math.ceil((MASONRY_CAPTION_PAD_PX + content + rounding) * scale);
}

/** Caption band for one asset in the given view mode. */
export function resolveAssetCaptionBandPx(input: {
  mode: CaptionBandMode;
  fields: CardCaptionFields;
  asset?: CaptionBandAsset;
  fontScale?: number;
  snippetLine?: boolean;
}): number {
  const lines = resolveCardCaptionLines(input.fields, input.asset ?? {}, {
    snippetLine: input.snippetLine,
  });
  return input.mode === "masonry"
    ? resolveMasonryCaptionBandPx(lines, input.fontScale)
    : resolveJustifiedCaptionBandPx(lines, input.fontScale);
}

/** Caption-band resolver bound to one view mode and one field configuration. */
export function createCaptionBandResolver(input: {
  mode: CaptionBandMode;
  fields: CardCaptionFields;
  fontScale?: number;
  snippetLine?: boolean;
}): (asset: CaptionBandAsset) => number {
  return (asset) => {
    const band = resolveAssetCaptionBandPx({
      mode: input.mode,
      fields: input.fields,
      asset,
      fontScale: input.fontScale,
      snippetLine: input.snippetLine,
    });
    return Number.isFinite(band) && band > 0 ? band : 0;
  };
}

/** Band for one asset from a fixed number or a per-asset resolver. */
export function resolveCaptionBandSource(
  source: CaptionBandSource,
  asset: CaptionBandAsset,
): number {
  const band = typeof source === "function" ? source(asset) : source;
  return Number.isFinite(band) && band > 0 ? band : 0;
}
