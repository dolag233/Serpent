import { describe, expect, it } from "vitest";

import {
  gitignoreMatchesPath,
  parseGitignore,
} from "../../src/worker/gitignore";

describe("library ignore-file matching", () => {
  it("matches extension rules at every folder depth", () => {
    const rules = parseGitignore("*.zip\n");

    expect(gitignoreMatchesPath(rules, "archive.zip", "asset")).toBe(true);
    expect(gitignoreMatchesPath(rules, "exports/archive.zip", "asset")).toBe(true);
    expect(gitignoreMatchesPath(rules, "exports/archive.png", "asset")).toBe(false);
  });

  it("keeps a trailing-slash rule directory-only", () => {
    const rules = parseGitignore(".*/\n");

    expect(gitignoreMatchesPath(rules, ".cache", "folder")).toBe(true);
    expect(gitignoreMatchesPath(rules, "build/.cache", "folder")).toBe(true);
    expect(gitignoreMatchesPath(rules, ".cache/file.bin", "asset")).toBe(true);
    expect(gitignoreMatchesPath(rules, ".cache-file", "asset")).toBe(false);
    expect(gitignoreMatchesPath(rules, ".cache-file", "folder")).toBe(true);
    expect(gitignoreMatchesPath(rules, "cache-file", "folder")).toBe(false);
    expect(gitignoreMatchesPath(rules, ".cache.txt", "asset")).toBe(false);
  });

  it("supports recursive globs, character classes, comments, and negation", () => {
    const rules = parseGitignore([
      "# generated previews",
      "renders/**/*.png",
      "[Tt]emp/",
      "!renders/keep.png",
    ].join("\n"));

    expect(gitignoreMatchesPath(rules, "renders/day/preview.png", "asset")).toBe(true);
    expect(gitignoreMatchesPath(rules, "renders/keep.png", "asset")).toBe(false);
    expect(gitignoreMatchesPath(rules, "Temp", "folder")).toBe(true);
    expect(gitignoreMatchesPath(rules, "temp/cache.bin", "asset")).toBe(true);
    expect(gitignoreMatchesPath(rules, "template/cache.bin", "asset")).toBe(false);
  });

  it("applies the latest matching rule across Assets-qualified and relative spellings", () => {
    const rules = parseGitignore([
      "*.zip",
      "!Assets/keep.zip",
      "Assets/private/*",
      "!private/keep.zip",
    ].join("\n"));

    expect(gitignoreMatchesPath(rules, "keep.zip", "asset")).toBe(false);
    expect(gitignoreMatchesPath(rules, "other.zip", "asset")).toBe(true);
    expect(gitignoreMatchesPath(rules, "private/keep.zip", "asset")).toBe(false);
    expect(gitignoreMatchesPath(rules, "private/other.zip", "asset")).toBe(true);
  });

  it("keeps valid rules when an individual malformed line is present", () => {
    const rules = parseGitignore("*.png\n[unterminated\n");

    expect(gitignoreMatchesPath(rules, "icon.png", "asset")).toBe(true);
    expect(gitignoreMatchesPath(rules, "icon.jpg", "asset")).toBe(false);
  });
});
