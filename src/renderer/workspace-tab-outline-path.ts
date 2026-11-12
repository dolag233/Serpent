/**
 * Open SVG path for the active workspace-tab chrome stroke (no bottom edge).
 *
 * Coordinate system: tab border-box, origin = top-left outer corner.
 * Scoop feet match CSS `--workspace-tab-scoop` / `--workspace-tab-curve`.
 *
 * `strokeInset` (typically half the 1px stroke) pulls the path inward so a
 * centered SVG stroke’s OUTER edge lands on that CSS silhouette.
 *
 * Path is OPEN along the baseline between scoop tips so stroke does not draw
 * a divider under the tab. Pair with `workspaceTabOutlineFillPath` whose
 * closed bottom sits 1px below the tips to cover the panel border row.
 */
export function workspaceTabOutlinePath(
  width: number,
  height: number,
  scoop: number,
  radius: number,
  strokeInset = 0,
): string {
  const W = Math.max(width, 1);
  const H = Math.max(height, scoop + 1);
  const S = Math.max(scoop, 1);
  const R = Math.min(Math.max(radius, 0), W / 2, Math.max(H - S, 0));
  const i = Math.max(0, Math.min(strokeInset, S - 0.5, W / 2));

  const x0 = i;
  const x1 = W - i;
  const yTop = i;
  const s = S - i;
  const r = Math.max(R - i, 0);
  const yJoin = H - s;

  return [
    `M ${-S + i} ${H}`,
    `A ${s} ${s} 0 0 0 ${x0} ${yJoin}`,
    `L ${x0} ${r > 0 ? r : yTop}`,
    r > 0 ? `A ${r} ${r} 0 0 1 ${r} ${yTop}` : "",
    `L ${W - (r > 0 ? r : i)} ${yTop}`,
    r > 0 ? `A ${r} ${r} 0 0 1 ${x1} ${r}` : "",
    `L ${x1} ${yJoin}`,
    `A ${s} ${s} 0 0 0 ${W + S - i} ${H}`,
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Closed fill silhouette: same outer edge as the stroke path, but the bottom
 * closes `bottomExtra` below the scoop tips so opaque fill covers the panel’s
 * top border row (avoids AA blend “divider” under the tab).
 */
export function workspaceTabOutlineFillPath(
  width: number,
  height: number,
  scoop: number,
  radius: number,
  strokeInset = 0,
  bottomExtra = 1,
): string {
  const W = Math.max(width, 1);
  const H = Math.max(height, scoop + 1);
  const S = Math.max(scoop, 1);
  const R = Math.min(Math.max(radius, 0), W / 2, Math.max(H - S, 0));
  const i = Math.max(0, Math.min(strokeInset, S - 0.5, W / 2));
  const extra = Math.max(0, bottomExtra);

  const x0 = i;
  const x1 = W - i;
  const yTop = i;
  const s = S - i;
  const r = Math.max(R - i, 0);
  const yJoin = H - s;
  const yBot = H + extra;
  const leftTip = -S + i;
  const rightTip = W + S - i;

  return [
    `M ${leftTip} ${yBot}`,
    `L ${leftTip} ${H}`,
    `A ${s} ${s} 0 0 0 ${x0} ${yJoin}`,
    `L ${x0} ${r > 0 ? r : yTop}`,
    r > 0 ? `A ${r} ${r} 0 0 1 ${r} ${yTop}` : "",
    `L ${W - (r > 0 ? r : i)} ${yTop}`,
    r > 0 ? `A ${r} ${r} 0 0 1 ${x1} ${r}` : "",
    `L ${x1} ${yJoin}`,
    `A ${s} ${s} 0 0 0 ${rightTip} ${H}`,
    `L ${rightTip} ${yBot}`,
    `Z`,
  ]
    .filter(Boolean)
    .join(" ");
}
