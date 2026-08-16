/**
 * Cancels an async proxy-fallback run when the viewer changes asset, starts a
 * manual retry, or unmounts. The polling body remains simple while stale
 * completions can be rejected without touching newer viewer state.
 */
export function createProxyFallbackRunGuard() {
  let generation = 0;

  return {
    begin(): () => boolean {
      const currentGeneration = ++generation;
      return () => currentGeneration === generation;
    },
    invalidate(): void {
      generation += 1;
    },
  };
}
