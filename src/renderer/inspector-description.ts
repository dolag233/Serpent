/**
 * Inspector description field resolution: prefer human text, else AI.
 * Pure helper shared by single-asset load and AI analyze paths.
 */

export function resolveInspectorDescription(
  human: string | null | undefined,
  ai: string | undefined,
): { value: string; fromAi: boolean } {
  if ((human ?? "").trim()) return { value: human ?? "", fromAi: false };
  if ((ai ?? "").trim()) return { value: ai ?? "", fromAi: true };
  return { value: "", fromAi: false };
}
