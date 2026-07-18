import { expect, test } from "vitest";

import {
  countTextLines,
  isTextFileName,
  textMimeForExtension,
} from "../../src/shared/text-media";

test("isTextFileName recognizes common text/code extensions", () => {
  expect(isTextFileName("notes.TXT")).toBe(true);
  expect(isTextFileName("readme.md")).toBe(true);
  expect(isTextFileName("data.json")).toBe(true);
  expect(isTextFileName("sheet.csv")).toBe(true);
  expect(isTextFileName("photo.png")).toBe(false);
  expect(isTextFileName("clip.mp3")).toBe(false);
});

test("textMimeForExtension and countTextLines", () => {
  expect(textMimeForExtension(".md")).toBe("text/markdown");
  expect(textMimeForExtension(".json")).toBe("application/json");
  expect(textMimeForExtension(".png")).toBeNull();
  expect(countTextLines("")).toBe(1);
  expect(countTextLines("a")).toBe(1);
  expect(countTextLines("a\nb")).toBe(2);
  expect(countTextLines("a\nb\n")).toBe(3);
});
