export type MasonryCardCenter = {
  readonly id: string;
  readonly x: number;
  readonly y: number;
};

/**
 * Select cards whose centers fall inside the rectangle spanned by the two
 * clicked cards. The returned order is the supplied browse order so the
 * result is stable even though masonry DOM nodes are grouped by column.
 */
export function resolveMasonryCenterRange(input: {
  readonly items: readonly MasonryCardCenter[];
  readonly browseOrder: readonly string[];
  readonly anchorId: string;
  readonly targetId: string;
}): string[] {
  const anchor = input.items.find((item) => item.id === input.anchorId);
  const target = input.items.find((item) => item.id === input.targetId);
  if (!anchor || !target) return [];

  const left = Math.min(anchor.x, target.x);
  const right = Math.max(anchor.x, target.x);
  const top = Math.min(anchor.y, target.y);
  const bottom = Math.max(anchor.y, target.y);
  const selected = new Set(
    input.items
      .filter(
        (item) =>
          item.x >= left &&
          item.x <= right &&
          item.y >= top &&
          item.y <= bottom,
      )
      .map((item) => item.id),
  );
  return input.browseOrder.filter((id) => selected.has(id));
}
