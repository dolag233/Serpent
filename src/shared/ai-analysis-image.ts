/**
 * Longest-edge cap for images sent to cloud AI analysis (Serpent-3eoo).
 * Worker resizes proportionally with withoutEnlargement before upload.
 */
export const AI_ANALYSIS_IMAGE_EDGE_MIN = 512;
export const AI_ANALYSIS_IMAGE_EDGE_MAX = 4096;
export const DEFAULT_AI_ANALYSIS_IMAGE_EDGE_PX = 2048;

/** Normalize the persisted/UI setting without consulting process state. */
export function normalizeAiAnalysisImageEdgePx(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') {
    return DEFAULT_AI_ANALYSIS_IMAGE_EDGE_PX;
  }
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_AI_ANALYSIS_IMAGE_EDGE_PX;
  return Math.min(
    AI_ANALYSIS_IMAGE_EDGE_MAX,
    Math.max(AI_ANALYSIS_IMAGE_EDGE_MIN, Math.round(parsed)),
  );
}
