export function shouldShowApplyToRest(
  sequenceIndex: number,
  sequenceCount: number,
): boolean {
  return sequenceCount > 1 && sequenceIndex >= 0 && sequenceIndex < sequenceCount - 1;
}
