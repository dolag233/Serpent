import { describe, expect, it } from "vitest";

import { resolveImageSequenceImportPaths } from "../../src/main/image-sequence-import";
import type { ImageSequenceImportOffer } from "../../src/shared/protocol/responses";

const offer: ImageSequenceImportOffer = {
  defaultFps: 30,
  libraryId: "library-1",
  offerId: "offer-1",
  selectedPaths: ["/source/a_001.png", "/source/b_001.png", "/source/notes.png"],
  sequences: [
    {
      displayName: "a_001~003",
      extension: ".png",
      firstFrame: 1,
      frameCount: 3,
      framePaths: ["/source/a_001.png", "/source/a_002.png", "/source/a_003.png"],
      height: 2,
      lastFrame: 3,
      numberStyle: "trailing",
      numericWidth: 3,
      prefix: "a_",
      width: 2,
    },
    {
      displayName: "b_001~003",
      extension: ".png",
      firstFrame: 1,
      frameCount: 3,
      framePaths: ["/source/b_001.png", "/source/b_002.png", "/source/b_003.png"],
      height: 2,
      lastFrame: 3,
      numberStyle: "trailing",
      numericWidth: 3,
      prefix: "b_",
      width: 2,
    },
  ],
};

describe("resolveImageSequenceImportPaths", () => {
  it("keeps later candidates for the next dialog when apply-to-rest is off", () => {
    const decision = resolveImageSequenceImportPaths({
      action: "import-sequence",
      applyToRest: false,
      firstFrame: 1,
      lastFrame: 2,
      offer,
      sequenceIndex: 0,
    });

    expect(decision).toEqual({
      createImageSequence: true,
      nextSequenceIndex: 1,
      sourcePaths: ["/source/a_001.png", "/source/a_002.png"],
    });
  });

  it("imports the complete later frame sets when applying sequence settings", () => {
    const decision = resolveImageSequenceImportPaths({
      action: "import-sequence",
      applyToRest: true,
      firstFrame: 1,
      lastFrame: 3,
      offer,
      sequenceIndex: 0,
    });

    expect(decision.createImageSequence).toBe(true);
    expect(decision.nextSequenceIndex).toBeNull();
    expect(decision.sourcePaths).toEqual([
      "/source/a_001.png",
      "/source/a_002.png",
      "/source/a_003.png",
      "/source/b_001.png",
      "/source/b_002.png",
      "/source/b_003.png",
      "/source/notes.png",
    ]);
  });

  it("does not silently import another sequence when choosing normal assets", () => {
    const decision = resolveImageSequenceImportPaths({
      action: "import-selected",
      applyToRest: false,
      firstFrame: 1,
      lastFrame: 3,
      offer,
      sequenceIndex: 0,
    });

    expect(decision).toEqual({
      createImageSequence: false,
      nextSequenceIndex: 1,
      sourcePaths: ["/source/a_001.png"],
    });
  });

  it("adds ordinary selected files after the final candidate", () => {
    const decision = resolveImageSequenceImportPaths({
      action: "import-selected",
      applyToRest: false,
      firstFrame: 1,
      lastFrame: 3,
      offer,
      sequenceIndex: 1,
    });

    expect(decision.nextSequenceIndex).toBeNull();
    expect(decision.sourcePaths).toEqual(["/source/b_001.png", "/source/notes.png"]);
  });
});

