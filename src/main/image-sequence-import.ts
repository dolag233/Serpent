import type { ImageSequenceImportOffer } from "../shared/protocol/responses";

export interface ImageSequenceImportPathDecision {
  createImageSequence: boolean;
  nextSequenceIndex: number | null;
  sourcePaths: string[];
}

function framePathsInRange(
  sequence: ImageSequenceImportOffer["sequences"][number],
  firstFrame: number,
  lastFrame: number,
): string[] {
  return (sequence.framePaths ?? []).filter((_, index) => {
    const frameNumber = sequence.firstFrame + index;
    return frameNumber >= firstFrame && frameNumber <= lastFrame;
  });
}

function selectedPathsForSequence(
  offer: ImageSequenceImportOffer,
  sequence: ImageSequenceImportOffer["sequences"][number],
): string[] {
  const sequencePaths = new Set(sequence.framePaths ?? []);
  return (offer.selectedPaths ?? []).filter((sourcePath) => sequencePaths.has(sourcePath));
}

function unsequencedSelectedPaths(offer: ImageSequenceImportOffer): string[] {
  const sequencePaths = new Set(
    offer.sequences.flatMap((sequence) => sequence.framePaths ?? []),
  );
  return (offer.selectedPaths ?? []).filter((sourcePath) => !sequencePaths.has(sourcePath));
}

/** Build the exact source set for one batch-dialog decision. */
export function resolveImageSequenceImportPaths(input: {
  action: "import-sequence" | "import-selected";
  applyToRest: boolean;
  firstFrame: number;
  lastFrame: number;
  offer: ImageSequenceImportOffer;
  sequenceIndex: number;
}): ImageSequenceImportPathDecision {
  const sequence = input.offer.sequences[input.sequenceIndex];
  if (!sequence) {
    return {
      createImageSequence: false,
      nextSequenceIndex: null,
      sourcePaths: [],
    };
  }
  const laterSequenceCount = Math.max(
    0,
    input.offer.sequences.length - input.sequenceIndex - 1,
  );
  const currentSelectedPaths = selectedPathsForSequence(input.offer, sequence);
  const fallbackSelectedPaths = currentSelectedPaths.length > 0
    ? currentSelectedPaths
    : input.offer.selectedPaths ?? [];
  const unsequencedPaths = unsequencedSelectedPaths(input.offer);
  const nextSequenceIndex =
    !input.applyToRest && laterSequenceCount > 0
      ? input.sequenceIndex + 1
      : null;

  if (input.action === "import-selected") {
    return {
      createImageSequence: false,
      nextSequenceIndex,
      sourcePaths: input.applyToRest
        ? input.offer.selectedPaths ?? []
        : [...fallbackSelectedPaths, ...(nextSequenceIndex === null ? unsequencedPaths : [])],
    };
  }

  if (!sequence.framePaths || sequence.framePaths.length < 3) {
    return {
      createImageSequence: false,
      nextSequenceIndex,
      sourcePaths: [...fallbackSelectedPaths, ...(nextSequenceIndex === null ? unsequencedPaths : [])],
    };
  }

  const rangedPaths = framePathsInRange(sequence, input.firstFrame, input.lastFrame);
  const laterSequencePaths = input.offer.sequences
    .slice(input.sequenceIndex + 1)
    .flatMap((candidate) => candidate.framePaths ?? []);
  return {
    createImageSequence: true,
    nextSequenceIndex,
    sourcePaths: input.applyToRest
      ? [...rangedPaths, ...laterSequencePaths, ...unsequencedPaths]
      : [...rangedPaths, ...(nextSequenceIndex === null ? unsequencedPaths : [])],
  };
}
