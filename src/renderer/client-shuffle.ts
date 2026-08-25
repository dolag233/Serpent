/**
 * Client-side Fisher–Yates shuffle with a deterministic seed (Serpent-hm28).
 * Used for browse「乱序」— no SQLite RANDOM() / protocol seed persistence.
 */

export function shuffleArray<T>(items: readonly T[], seed: number): T[] {
  const out = items.slice();
  if (out.length < 2) return out;
  let state = seed >>> 0;
  if (state === 0) state = 0x9e3779b9;
  for (let i = out.length - 1; i > 0; i -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1);
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

/**
 * Apply the browse shuffle consistently to both loaded summaries and the
 * full-scope geometry index. The latter is what masonry/justified views use
 * to decide card order, including when discovery filters are active.
 */
export function shuffleBrowseItems<T>(
  items: readonly T[],
  seed: number | null,
  enabled = true,
): T[] {
  if (!enabled || seed === null) return items.slice();
  return shuffleArray(items, seed);
}
