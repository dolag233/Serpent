import { describe, expect, it } from "vitest";
import {
  normalizeForSnippetCompare,
  plainSnippetText,
  resolveSearchSnippetCaption,
} from "../../src/renderer/search-snippet-caption";

describe("plainSnippetText", () => {
  it("strips highlight markers and ellipsis", () => {
    expect(plainSnippetText("...<b>wide</b> red png...")).toBe("wide red png");
    expect(plainSnippetText("<B>hero</B>.png")).toBe("hero.png");
  });
});

describe("normalizeForSnippetCompare", () => {
  it("collapses separators so filenames match tokenized FTS text", () => {
    expect(normalizeForSnippetCompare("wide-red.png")).toBe("wide red png");
    expect(normalizeForSnippetCompare("wide red png")).toBe("wide red png");
    expect(normalizeForSnippetCompare("Hero.PNG")).toBe("hero png");
  });
});

describe("resolveSearchSnippetCaption", () => {
  it("hides snippets that only repeat the display name (exact or tokenized)", () => {
    expect(
      resolveSearchSnippetCaption("<b>wide</b>-red.png", "wide-red.png"),
    ).toBeNull();
    expect(
      resolveSearchSnippetCaption("<b>wide</b> red png", "wide-red.png"),
    ).toBeNull();
    expect(resolveSearchSnippetCaption("hero.png", "hero.png")).toBeNull();
  });

  it("keeps snippets that add non-name context", () => {
    expect(
      resolveSearchSnippetCaption("标签 <b>字体</b> 设计", "asset-.jpg"),
    ).toBe("标签 <b>字体</b> 设计");
    expect(
      resolveSearchSnippetCaption("...<b>concept</b> sketch notes...", "shot-01.png"),
    ).toBe("...<b>concept</b> sketch notes...");
  });

  it("returns null for empty or marker-only snippets", () => {
    expect(resolveSearchSnippetCaption("", "a.png")).toBeNull();
    expect(resolveSearchSnippetCaption("   ", "a.png")).toBeNull();
    expect(resolveSearchSnippetCaption("<b></b>", "a.png")).toBeNull();
    expect(resolveSearchSnippetCaption(null, "a.png")).toBeNull();
    expect(resolveSearchSnippetCaption(undefined, "a.png")).toBeNull();
  });
});
