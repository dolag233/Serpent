import { describe, expect, it } from "vitest";

import {
  detectImageSequences,
  findImageSequenceContaining,
} from "../../src/shared/image-sequence";

describe("detectImageSequences", () => {
  it("splits gaps into independent runs of at least three frames", () => {
    const sequences = detectImageSequences([
      "img_7.png",
      "img_1.png",
      "img_6.png",
      "img_3.png",
      "img_5.png",
      "img_2.png",
    ]);

    expect(sequences.map((sequence) =>
      sequence.frames.map((frame) => frame.frameNumber),
    )).toEqual([[1, 2, 3], [5, 6, 7]]);
  });

  it("rejects short, extension-mismatched, and prefix-mismatched runs", () => {
    expect(detectImageSequences([
      "img_1.png",
      "img_2.png",
      "img_3.jpg",
      "other_3.png",
    ])).toEqual([]);
  });

  it("keeps padded and unpadded numbering separate", () => {
    const sequences = detectImageSequences([
      "shot_1.webp",
      "shot_2.webp",
      "shot_3.webp",
      "shot_001.webp",
      "shot_002.webp",
      "shot_003.webp",
    ]);

    expect(sequences).toHaveLength(2);
    expect(sequences.map((sequence) => sequence.frames[0]!.numericWidth)).toEqual([3, 1]);
  });

  it("only considers supported images with a trailing numeric suffix", () => {
    expect(detectImageSequences([
      "clip_1.mp4",
      "clip_2.mp4",
      "clip_3.mp4",
      "1.png",
      "2.png",
      "3.png",
      "img_1_final.png",
    ])).toMatchObject([
      {
        prefix: "",
        frames: [
          { frameNumber: 1 },
          { frameNumber: 2 },
          { frameNumber: 3 },
        ],
      },
    ]);
  });
});

describe("findImageSequenceContaining", () => {
  it("expands only the continuous run containing the selected file", () => {
    const siblings = [
      "/source/img_1.png",
      "/source/img_2.png",
      "/source/img_3.png",
      "/source/img_5.png",
      "/source/img_6.png",
      "/source/img_7.png",
    ];

    expect(
      findImageSequenceContaining("/source/img_6.png", siblings)?.frames.map(
        (frame) => frame.value,
      ),
    ).toEqual([
      "/source/img_5.png",
      "/source/img_6.png",
      "/source/img_7.png",
    ]);
  });
});
