// ---------------------------------------------------------------------------
// Trash caption original-location label (Wave-3 audit P3)
//
// Trash cards show where an asset lived before trashing. The raw
// trashedFromPath duplicates the file name for root-level assets (two
// identical lines on one card), so the caption renders the parent directory
// instead; the full path stays available in the row's title tooltip.
// ---------------------------------------------------------------------------

/**
 * Human-readable original location for a trashed asset:
 * the parent portion of the stored path, or 资源库根目录 for root-level files.
 */
export function trashedFromLabel(trashedFromPath: string): string {
  const normalized = trashedFromPath.replace(/\\/g, '/');
  const cut = normalized.lastIndexOf('/');
  if (cut <= 0) return '资源库根目录';
  return normalized.slice(0, cut);
}
