import { describe, expect, it } from "vitest";

import {
  detectImageSequences,
  findImageSequenceContaining,
  formatImageSequenceDisplayName,
  parseImageSequenceFileName,
} from "../../src/shared/image-sequence";

describe("parseImageSequenceFileName", () => {
  it("parses trailing, zero-padded, and parentheses styles", () => {
    expect(parseImageSequenceFileName("Scaning Block Particles_00010.png")).toEqual({
      extension: ".png",
      frameNumber: 10,
      numberStyle: "trailing",
      numericWidth: 5,
      prefix: "Scaning Block Particles_",
    });
    expect(parseImageSequenceFileName("clip_0.png")).toMatchObject({
      frameNumber: 0,
      numberStyle: "trailing",
      numericWidth: 0,
      prefix: "clip_",
    });
    expect(parseImageSequenceFileName("final_comp_v01.0001.exr")).toMatchObject({
      frameNumber: 1,
      numberStyle: "trailing",
      numericWidth: 4,
      prefix: "final_comp_v01.",
    });
    expect(parseImageSequenceFileName("photo (12).jpg")).toMatchObject({
      frameNumber: 12,
      numberStyle: "parens",
      numericWidth: 0,
      prefix: "photo ",
    });
    expect(parseImageSequenceFileName("shot_(001).png")).toMatchObject({
      frameNumber: 1,
      numberStyle: "parens",
      numericWidth: 3,
      prefix: "shot_",
    });
  });
});

describe("formatImageSequenceDisplayName", () => {
  it("formats padded, unpadded, and parentheses ranges without extension", () => {
    expect(
      formatImageSequenceDisplayName({
        prefix: "Scaning Block Particles_",
        firstFrame: 0,
        lastFrame: 150,
        numberStyle: "trailing",
        numericWidth: 5,
      }),
    ).toBe("Scaning Block Particles_00000~00150");
    expect(
      formatImageSequenceDisplayName({
        prefix: "clip_",
        firstFrame: 0,
        lastFrame: 35,
        numberStyle: "trailing",
        numericWidth: 0,
      }),
    ).toBe("clip_0~35");
    expect(
      formatImageSequenceDisplayName({
        prefix: "shot",
        firstFrame: 1,
        lastFrame: 365,
        numberStyle: "parens",
        numericWidth: 0,
      }),
    ).toBe("shot(1)~(365)");
  });
});

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

  it("keeps zero-padded and unpadded numbering separate", () => {
    const sequences = detectImageSequences([
      "shot_1.webp",
      "shot_2.webp",
      "shot_3.webp",
      "shot_001.webp",
      "shot_002.webp",
      "shot_003.webp",
    ]);

    expect(sequences).toHaveLength(2);
    expect(sequences.map((sequence) => sequence.numericWidth).sort()).toEqual([0, 3]);
  });

  it("groups unpadded runs even when digit width grows (_0 … _35)", () => {
    const values = Array.from({ length: 36 }, (_, index) => `clip_${index}.png`);
    const sequences = detectImageSequences(values);
    expect(sequences).toHaveLength(1);
    expect(sequences[0]).toMatchObject({
      prefix: "clip_",
      numberStyle: "trailing",
      numericWidth: 0,
    });
    expect(sequences[0]!.frames).toHaveLength(36);
    expect(sequences[0]!.frames.at(-1)!.frameNumber).toBe(35);
  });

  it("detects parentheses numbering without merging into trailing style", () => {
    const sequences = detectImageSequences([
      "shot(1).png",
      "shot(2).png",
      "shot(3).png",
      "shot_1.png",
      "shot_2.png",
      "shot_3.png",
    ]);
    expect(sequences).toHaveLength(2);
    expect(sequences.map((sequence) => sequence.numberStyle).sort()).toEqual([
      "parens",
      "trailing",
    ]);
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

  it("does not merge same basename pattern across directories", () => {
    expect(detectImageSequences([
      "file1.jpg",
      "sub/file2.jpg",
      "other/file3.jpg",
      "deep/file1.jpg",
      "deep/file2.jpg",
      "deep/file3.jpg",
    ])).toMatchObject([
      {
        prefix: "file",
        frames: [
          { frameNumber: 1, value: "deep/file1.jpg" },
          { frameNumber: 2, value: "deep/file2.jpg" },
          { frameNumber: 3, value: "deep/file3.jpg" },
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
